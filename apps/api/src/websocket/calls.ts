import { db } from "@/lib/db";
import {
  type CallPeer,
  type CallSummary,
  type GroupCallState,
  MAX_MESH_PARTICIPANTS,
  type MediaState,
  type UserSummary,
} from "@app/shared/realtime-events";
import { ensureGroupConversation } from "@/server/group-chat";
import { notify } from "@/server/notify";
import { rateLimit } from "@/server/rate-limit";
import { dbFor } from "@/server/session";
import {
  type Conn,
  clearRoom,
  emitTo,
  emitToConn,
  emitToRoom,
  emitToUsers,
  onGroupMembershipEnded,
  rooms,
} from "./hub";

/**
 * Call lifecycle + WebRTC signaling relay (mesh). Authorization uses the policy client
 * (`dbFor(user)`); state writes use the unscoped client after those checks.
 * Live peers are kept in memory: a call is bound to one server process.
 */

const RING_TIMEOUT_MS = 45_000;

/** callId → socketId → peer */
const live = new Map<string, Map<string, CallPeer>>();
/** callIds that had at least two people at some point (otherwise "missed") */
const answered = new Set<string>();
/**
 * Group drop-in calls (calls on a group's chat): nobody rings, members see the live state in the
 * group and join at will. `messageId` is the call's log entry in the chat, updated when it ends.
 */
const groupCalls = new Map<string, { groupId: string; messageId: string }>();
/** socketId → connection, to remove a user's sockets from a call (group membership ended) */
const conns = new Map<string, Conn>();

const callSelect = {
  id: true,
  conversationId: true,
  eventId: true,
  type: true,
  startedById: true,
  status: true,
  startedAt: true,
  conversation: { select: { groupId: true } },
} as const;

function summary(
  call: Omit<CallSummary, "groupId"> & { conversation: { groupId: string | null } | null },
): CallSummary {
  const { id, conversationId, eventId, type, startedById } = call;
  const groupId = call.conversation?.groupId ?? null;
  return { id, conversationId, eventId, groupId, type, startedById };
}

function groupCallState(groupId: string): GroupCallState {
  for (const [callId, meta] of groupCalls) {
    if (meta.groupId !== groupId) continue;
    const peers = [...(live.get(callId)?.values() ?? [])];
    const participants = [...new Map(peers.map((p) => [p.user.id, p.user])).values()];
    return { groupId, call: callState.get(callId) ?? null, participants };
  }
  return { groupId, call: null, participants: [] };
}

/** callId → the `call` part of GroupCallState */
const callState = new Map<string, NonNullable<GroupCallState["call"]>>();

function emitGroupCall(groupId: string) {
  emitToRoom(rooms.group(groupId), "group:call", groupCallState(groupId));
}

async function callTitle(
  call: { conversationId: string | null; eventId: string | null },
  forUserId: string,
) {
  if (call.eventId) {
    const event = await db.event.findUnique({
      where: { id: call.eventId },
      select: { title: true },
    });
    return event?.title ?? "Meeting";
  }
  if (call.conversationId) {
    const convo = await db.conversation.findUnique({
      where: { id: call.conversationId },
      select: {
        title: true,
        group: { select: { name: true } },
        members: { select: { user: { select: { id: true, name: true } } } },
      },
    });
    if (convo?.group) return convo.group.name;
    if (convo?.title) return convo.title;
    const others = convo?.members.map((m) => m.user).filter((u) => u.id !== forUserId) ?? [];
    return others.map((u) => u.name).join(", ") || "Call";
  }
  return "Call";
}

/** Everyone who should ring for this call (excluding the caller). */
async function invitees(
  call: { conversationId: string | null; eventId: string | null },
  callerId: string,
) {
  if (call.conversationId) {
    const rows = await db.conversationMember.findMany({
      where: { conversationId: call.conversationId },
      select: { userId: true },
    });
    return rows.map((r) => r.userId).filter((id) => id !== callerId);
  }
  if (call.eventId) {
    const event = await db.event.findUnique({
      where: { id: call.eventId },
      select: {
        creatorId: true,
        attendees: {
          where: { rsvp: { not: "DECLINED" } },
          select: { userId: true },
        },
      },
    });
    if (!event) return [];
    return [...new Set([event.creatorId, ...event.attendees.map((a) => a.userId)])].filter(
      (id) => id !== callerId,
    );
  }
  return [];
}

async function endCall(callId: string) {
  const call = await db.call.findUnique({
    where: { id: callId },
    select: callSelect,
  });
  live.delete(callId);
  const group = groupCalls.get(callId);
  groupCalls.delete(callId);
  callState.delete(callId);
  if (group) emitGroupCall(group.groupId);
  if (!call || call.status === "ENDED") return;
  const endedAt = new Date();
  await db.call.update({
    where: { id: callId },
    data: { status: "ENDED", endedAt },
  });
  await db.callParticipant.updateMany({
    where: { callId, leftAt: null },
    data: { leftAt: endedAt },
  });
  // group calls never ring: only the people in the call need to hear it ended
  const isGroupCall = Boolean(group || call.conversation?.groupId);
  const ringing = isGroupCall ? [] : await invitees(call, call.startedById);
  emitTo([rooms.call(callId), ...ringing.map(rooms.user)], "call:ended", { callId });
  clearRoom(rooms.call(callId));

  const wasAnswered = answered.delete(callId);
  const durationSec = Math.round((endedAt.getTime() - call.startedAt.getTime()) / 1000);
  if (group) {
    // the "live" entry posted when the call started becomes its log entry
    await db.message.update({
      where: { id: group.messageId },
      data: {
        content: "Call ended",
        data: {
          callId,
          callType: call.type,
          groupCall: true,
          live: false,
          durationSec,
          answered: wasAnswered,
        },
      },
    });
    return;
  }
  // a group call left over from a previous process: close it quietly
  if (isGroupCall) return;
  if (call.conversationId) {
    // the call log entry in the conversation (MessageType CALL is server-only)
    await db.message.create({
      data: {
        conversationId: call.conversationId,
        senderId: call.startedById,
        type: "CALL",
        content: wasAnswered ? "Call ended" : "Missed call",
        data: {
          callId,
          callType: call.type,
          durationSec: wasAnswered ? durationSec : 0,
          answered: wasAnswered,
        },
      },
    });
  }
  if (!wasAnswered) {
    await notify(
      ringing.map((userId) => ({
        userId,
        actorId: call.startedById,
        type: "MISSED_CALL" as const,
        conversationId: call.conversationId,
        eventId: call.eventId,
        callId,
      })),
    );
  }
}

async function leave(socket: Conn, callId: string) {
  socket.calls.delete(callId);
  socket.leave(rooms.call(callId));
  const peers = live.get(callId);
  if (!peers?.delete(socket.id)) return;
  const userId = socket.user.id;
  emitToRoom(rooms.call(callId), "call:peer-left", { callId, socketId: socket.id, userId });
  // the user may still be in the call from another tab
  if (![...peers.values()].some((p) => p.user.id === userId)) {
    await db.callParticipant.updateMany({
      where: { callId, userId, leftAt: null },
      data: { leftAt: new Date() },
    });
  }
  if (peers.size === 0) await endCall(callId);
  else {
    const group = groupCalls.get(callId);
    if (group) emitGroupCall(group.groupId);
  }
}

// a user removed from a group (or whose membership is no longer active) leaves its live call
onGroupMembershipEnded((groupId, userId) => {
  for (const [callId, meta] of groupCalls) {
    if (meta.groupId !== groupId) continue;
    // snapshot: `leave` deletes from the live map while we iterate
    for (const peer of Array.from(live.get(callId)?.values() ?? [])) {
      if (peer.user.id !== userId) continue;
      emitToConn(peer.socketId, "call:ended", { callId });
      const conn = conns.get(peer.socketId);
      if (conn) leave(conn, callId).catch(logError("kick"));
    }
  }
});

export function registerCalls(socket: Conn) {
  const { user } = socket;
  const me: UserSummary = { id: user.id, name: user.name, image: user.image };
  const fail = (error: string) => ({ ok: false as const, error });
  conns.set(socket.id, socket);

  socket.on("group:call:get", async ({ groupId }, ack) => {
    const membership = await dbFor(user).groupMember.findFirst({
      where: { groupId: String(groupId), userId: user.id, status: "ACTIVE" },
      select: { id: true },
    });
    if (!membership) return ack(fail("Not a member of this group"));
    ack({ ok: true, data: groupCallState(String(groupId)) });
  });

  socket.on("call:start", async ({ conversationId: requested, eventId, groupId, type }, ack) => {
    try {
      if (!rateLimit(`call:start:${user.id}`, 5, 60_000))
        return ack(fail("Too many calls, slow down"));
      if (type !== "AUDIO" && type !== "VIDEO") return ack(fail("Invalid call type"));
      const scoped = dbFor(user);
      let conversationId = requested;
      if (groupId) {
        const membership = await scoped.groupMember.findFirst({
          where: { groupId: String(groupId), userId: user.id, status: "ACTIVE" },
          select: { id: true },
        });
        if (!membership) return ack(fail("Only group members can start a call"));
        conversationId = (await ensureGroupConversation(String(groupId))) ?? undefined;
      }
      let callGroupId: string | null = null;
      if (conversationId) {
        const convo = await scoped.conversation.findUnique({
          where: { id: conversationId },
          select: { groupId: true },
        });
        if (!convo) return ack(fail("Conversation not found"));
        callGroupId = convo.groupId;
      } else if (eventId) {
        const event = await scoped.event.findUnique({
          where: { id: eventId },
          select: { hasVideoCall: true },
        });
        if (!event?.hasVideoCall) return ack(fail("Event has no video call"));
      } else {
        return ack(fail("conversationId or eventId is required"));
      }

      // one live call per conversation/event: join it instead of starting another
      const existing = await db.call.findFirst({
        where: {
          status: { not: "ENDED" },
          ...(conversationId ? { conversationId } : { eventId }),
        },
        select: { id: true },
      });
      // `live` holds the call from creation until it ends, even while the caller is still in the lobby
      if (existing && live.has(existing.id))
        return ack({ ok: true, data: { callId: existing.id } });
      if (existing) await endCall(existing.id);

      const call = await db.call.create({
        data: {
          conversationId,
          eventId,
          type,
          startedById: user.id,
        },
        select: callSelect,
      });
      live.set(call.id, new Map());

      if (callGroupId && call.conversationId) {
        const message = await db.message.create({
          data: {
            conversationId: call.conversationId,
            senderId: user.id,
            type: "CALL",
            content: type === "VIDEO" ? "Started a video call" : "Started an audio call",
            data: { callId: call.id, callType: type, groupCall: true, live: true },
          },
          select: { id: true },
        });
        groupCalls.set(call.id, {
          groupId: callGroupId,
          messageId: message.id,
        });
        callState.set(call.id, {
          id: call.id,
          conversationId: call.conversationId,
          type,
          startedAt: call.startedAt,
        });
        ack({ ok: true, data: { callId: call.id } });
        emitGroupCall(callGroupId);
        // a drop-in room nobody entered (the starter closed the lobby) does not linger
        setTimeout(() => {
          if (live.get(call.id)?.size === 0) endCall(call.id).catch(logError("empty room"));
        }, RING_TIMEOUT_MS);
        return;
      }

      ack({ ok: true, data: { callId: call.id } });

      for (const userId of await invitees(call, user.id)) {
        emitToUsers([userId], "call:incoming", {
          call: summary(call),
          from: me,
          title: await callTitle(call, userId),
        });
      }
      setTimeout(() => {
        if (!answered.has(call.id) && live.has(call.id))
          endCall(call.id).catch(logError("ring timeout"));
      }, RING_TIMEOUT_MS);
    } catch (err) {
      console.error("[calls] start", err);
      ack(fail("Could not start the call"));
    }
  });

  socket.on("call:join", async ({ callId, media }, ack) => {
    try {
      const call = await dbFor(user).call.findUnique({
        where: { id: String(callId) },
        select: callSelect,
      });
      if (!call || call.status === "ENDED") return ack(fail("This call has ended"));
      const peers = live.get(call.id) ?? new Map<string, CallPeer>();
      live.set(call.id, peers);
      const distinctUsers = new Set([...peers.values()].map((p) => p.user.id));
      if (!distinctUsers.has(user.id) && distinctUsers.size >= MAX_MESH_PARTICIPANTS) {
        return ack(fail(`Calls are limited to ${MAX_MESH_PARTICIPANTS} people`));
      }

      const self: CallPeer = {
        socketId: socket.id,
        user: me,
        media: sanitizeMedia(media),
      };
      const existing = [...peers.values()];
      peers.set(socket.id, self);
      socket.calls.add(call.id);
      socket.join(rooms.call(call.id));

      await db.callParticipant.upsert({
        where: { callId_userId: { callId: call.id, userId: user.id } },
        create: { callId: call.id, userId: user.id },
        update: { leftAt: null },
      });
      if (new Set([...peers.values()].map((p) => p.user.id)).size >= 2) {
        answered.add(call.id);
        if (call.status === "RINGING")
          await db.call.update({
            where: { id: call.id },
            data: { status: "ACTIVE" },
          });
      }

      ack({
        ok: true,
        data: {
          call: summary(call),
          peers: existing,
          title: await callTitle(call, user.id),
        },
      });
      socket.broadcast(rooms.call(call.id), "call:peer-joined", { ...self, callId: call.id });
      emitToUsers([user.id], "call:answered", { callId: call.id });
      const group = groupCalls.get(call.id);
      if (group) emitGroupCall(group.groupId);
    } catch (err) {
      console.error("[calls] join", err);
      ack(fail("Could not join the call"));
    }
  });

  socket.on("call:leave", ({ callId }) => {
    leave(socket, String(callId)).catch(logError("leave"));
  });

  socket.on("call:decline", ({ callId }) => {
    (async () => {
      const call = await dbFor(user).call.findUnique({
        where: { id: String(callId) },
        select: callSelect,
      });
      if (!call || call.status === "ENDED") return;
      emitTo([rooms.call(call.id), rooms.user(call.startedById)], "call:declined", {
        callId: call.id,
        user: me,
      });
      // a declined 1:1 call is over
      if (call.conversationId) {
        const convo = await db.conversation.findUnique({
          where: { id: call.conversationId },
          select: { type: true },
        });
        if (convo?.type === "DIRECT" && !answered.has(call.id)) await endCall(call.id);
      }
    })().catch(logError("decline"));
  });

  socket.on("call:media", ({ callId, media }) => {
    const peer = live.get(String(callId))?.get(socket.id);
    if (!peer) return;
    peer.media = sanitizeMedia(media);
    socket.broadcast(rooms.call(String(callId)), "call:peer-media", {
      callId: String(callId),
      socketId: socket.id,
      media: peer.media,
    });
  });

  socket.on("rtc:signal", ({ callId, to, data }) => {
    const peers = live.get(String(callId));
    // relay only between two sockets of the same call
    if (!peers?.has(socket.id) || !peers.has(String(to))) return;
    emitToConn(String(to), "rtc:signal", {
      callId: String(callId),
      from: socket.id,
      data,
    });
  });

  socket.onClose(() => {
    conns.delete(socket.id);
    for (const callId of socket.calls) leave(socket, callId).catch(logError("disconnect"));
  });
}

const logError = (what: string) => (err: unknown) => console.error(`[calls] ${what}`, err);

function sanitizeMedia(media: MediaState | undefined): MediaState {
  return {
    audio: Boolean(media?.audio),
    video: Boolean(media?.video),
    screen: Boolean(media?.screen),
  };
}
