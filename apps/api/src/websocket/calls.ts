import { db } from "@/lib/db";
import {
  type CallPeer,
  type CallSummary,
  MAX_MESH_PARTICIPANTS,
  type MediaState,
  type UserSummary,
} from "@app/shared/realtime-events";
import { notify } from "@/server/notify";
import { rateLimit } from "@/server/rate-limit";
import { dbFor } from "@/server/session";
import { type Conn, clearRoom, emitTo, emitToConn, emitToRoom, emitToUsers, rooms } from "./hub";

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

const callSelect = {
  id: true,
  organizationId: true,
  conversationId: true,
  eventId: true,
  type: true,
  startedById: true,
  status: true,
  startedAt: true,
} as const;

function summary(call: CallSummary): CallSummary {
  const { id, organizationId, conversationId, eventId, type, startedById } = call;
  return { id, organizationId, conversationId, eventId, type, startedById };
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
        members: { select: { user: { select: { id: true, name: true } } } },
      },
    });
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
  const ringing = await invitees(call, call.startedById);
  emitTo([rooms.call(callId), ...ringing.map(rooms.user)], "call:ended", { callId });
  clearRoom(rooms.call(callId));

  const wasAnswered = answered.delete(callId);
  const durationSec = Math.round((endedAt.getTime() - call.startedAt.getTime()) / 1000);
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
        organizationId: call.organizationId,
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
}

export function registerCalls(socket: Conn) {
  const { user } = socket;
  const me: UserSummary = { id: user.id, name: user.name, image: user.image };
  const fail = (error: string) => ({ ok: false as const, error });

  socket.on("call:start", async ({ conversationId, eventId, type }, ack) => {
    try {
      if (!rateLimit(`call:start:${user.id}`, 5, 60_000))
        return ack(fail("Too many calls, slow down"));
      if (type !== "AUDIO" && type !== "VIDEO") return ack(fail("Invalid call type"));
      const scoped = dbFor(user);
      let organizationId: string;
      if (conversationId) {
        const convo = await scoped.conversation.findUnique({
          where: { id: conversationId },
          select: { organizationId: true },
        });
        if (!convo) return ack(fail("Conversation not found"));
        organizationId = convo.organizationId;
      } else if (eventId) {
        const event = await scoped.event.findUnique({
          where: { id: eventId },
          select: { organizationId: true, hasVideoCall: true },
        });
        if (!event?.hasVideoCall) return ack(fail("Event has no video call"));
        organizationId = event.organizationId;
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
          organizationId,
          conversationId,
          eventId,
          type,
          startedById: user.id,
        },
        select: callSelect,
      });
      live.set(call.id, new Map());
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
