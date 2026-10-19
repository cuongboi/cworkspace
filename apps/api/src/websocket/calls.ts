import { env } from "@/env";
import { db } from "@/lib/db";
import {
  CAPTION_PAIR,
  type ServerPayload,
  type CallPeer,
  type CallSummary,
  type CaptionPrefs,
  isCaptionLang,
  type GroupCallState,
  MAX_GLOSSARY_TERM_CHARS,
  MAX_GLOSSARY_TERMS,
  MAX_MESH_PARTICIPANTS,
  type MediaState,
  type TranscriptEntry,
  type UserSummary,
} from "@app/shared/realtime-events";
import { ensureGroupConversation } from "@/server/group-chat";
import { notify } from "@/server/notify";
import { sendPush } from "@/server/push";
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

/**
 * Calls still ringing, so a device that connects mid-ring (opened from the push notification)
 * shows the incoming-call card too.
 */
const ringing = new Map<
  string,
  { startedAt: number; invites: Map<string, ServerPayload<"call:incoming">> }
>();

function stopRinging(callId: string, userIds: string[]) {
  ringing.delete(callId);
  // closes the ringing notification on devices that never opened the app
  void sendPush(userIds, { title: "", body: "", url: "/", tag: `call:${callId}`, kind: "dismiss" });
}
const MAX_CAPTION_CHARS = 500;
const MAX_TRANSCRIPT = 2_000;
/** utterance start times kept for ordering; older ones fall back to "now" */
const MAX_OPEN_UTTERANCES = 200;

/**
 * Live caption state of a call, in memory only: the transcript is gone when the call ends.
 * The server orders finals by when the utterance started (its `start` mark), so a late final
 * never jumps ahead of what was said after it.
 */
type CallCaptions = {
  seq: number;
  entries: TranscriptEntry[];
  /** `${userId}:${utteranceId}` → start (server clock) */
  starts: Map<string, number>;
  /** finals already recorded (a speaker resends finals after a reconnect) */
  seen: Set<string>;
  glossary: string[];
};
const captionState = new Map<string, CallCaptions>();

function captionsOf(callId: string): CallCaptions {
  let state = captionState.get(callId);
  if (!state) {
    state = { seq: 0, entries: [], starts: new Map(), seen: new Set(), glossary: [] };
    captionState.set(callId, state);
  }
  return state;
}

/** The call's shared glossary (biases the transcriber; locked into its tokens). */
export function callGlossary(callId: string): string[] {
  return captionState.get(callId)?.glossary ?? [];
}

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
  captionState.delete(callId);
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
  stopRinging(callId, ringing);
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

/** Declines a ringing call (socket, or the push notification's Decline button). */
export async function declineCall(
  user: { id: string; name: string; image?: string | null },
  userDb: ReturnType<typeof dbFor>,
  callId: string,
) {
  const call = await userDb.call.findUnique({
    where: { id: callId },
    select: callSelect,
  });
  if (!call || call.status === "ENDED") return;
  const me: UserSummary = { id: user.id, name: user.name, image: user.image ?? null };
  ringing.get(call.id)?.invites.delete(user.id);
  void sendPush([user.id], {
    title: "",
    body: "",
    url: "/",
    tag: `call:${call.id}`,
    kind: "dismiss",
  });
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
}

export function registerCalls(socket: Conn) {
  const { user } = socket;
  const me: UserSummary = { id: user.id, name: user.name, image: user.image };
  const fail = (error: string) => ({ ok: false as const, error });
  conns.set(socket.id, socket);

  for (const [callId, ring] of ringing) {
    const invite = ring.invites.get(user.id);
    if (!invite || answered.has(callId)) continue;
    if (Date.now() - ring.startedAt > RING_TIMEOUT_MS) ringing.delete(callId);
    else emitToConn(socket.id, "call:incoming", invite);
  }

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

      const invites = new Map<string, ServerPayload<"call:incoming">>();
      ringing.set(call.id, { startedAt: Date.now(), invites });
      for (const userId of await invitees(call, user.id)) {
        const title = await callTitle(call, userId);
        const payload = { call: summary(call), from: me, title };
        invites.set(userId, payload);
        emitToUsers([userId], "call:incoming", payload);
        void sendPush([userId], {
          title: `Incoming ${type === "VIDEO" ? "video" : "audio"} call`,
          body: title || me.name,
          url: call.conversationId
            ? `/chat/${call.conversationId}`
            : call.eventId
              ? `/calendar?event=${call.eventId}`
              : "/chat",
          tag: `call:${call.id}`,
          kind: "call",
          callId: call.id,
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

  socket.on("call:join", async ({ callId, media, captions }, ack) => {
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
        captions: sanitizeCaptions(captions),
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
          captions: Boolean(env.GEMINI_API_KEY),
          transcript: captionState.get(call.id)?.entries ?? [],
          glossary: callGlossary(call.id),
        },
      });
      socket.broadcast(rooms.call(call.id), "call:peer-joined", { ...self, callId: call.id });
      emitToUsers([user.id], "call:answered", { callId: call.id });
      if (answered.has(call.id)) ringing.delete(call.id);
      // stop ringing on this user's other devices
      void sendPush([user.id], {
        title: "",
        body: "",
        url: "/",
        tag: `call:${call.id}`,
        kind: "dismiss",
      });
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
    declineCall(user, dbFor(user), String(callId)).catch(logError("decline"));
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

  socket.on("call:captions", ({ callId, captions }) => {
    const peer = live.get(String(callId))?.get(socket.id);
    if (!peer) return;
    peer.captions = sanitizeCaptions(captions);
    socket.broadcast(rooms.call(String(callId)), "call:peer-captions", {
      callId: String(callId),
      socketId: socket.id,
      captions: peer.captions,
    });
  });

  // Utterance boundaries of a speaker: the start orders the transcript.
  socket.on("call:caption-mark", ({ callId, utteranceId, lang, state }) => {
    const id = String(callId);
    const peers = live.get(id);
    const self = peers?.get(socket.id);
    if (!peers || !self || !isCaptionLang(lang)) return;
    if (state !== "start" && state !== "end") return;
    if (!rateLimit(`call:caption-mark:${socket.id}`, 20, 2_000)) return;
    const uid = String(utteranceId).slice(0, 64);
    if (state === "start") {
      const { starts } = captionsOf(id);
      starts.set(`${user.id}:${uid}`, Date.now());
      if (starts.size > MAX_OPEN_UTTERANCES) starts.delete(starts.keys().next().value!);
    }
  });

  // The original text of an utterance, transcribed in the speaker's browser. It goes to every
  // reader (the speaker included, so everyone shares the server's order); finals are kept.
  socket.on("call:caption", ({ callId, utteranceId, lang, text, final }) => {
    const id = String(callId);
    const peers = live.get(id);
    const self = peers?.get(socket.id);
    if (!peers || !self || typeof text !== "string" || !isCaptionLang(lang)) return;
    if (!rateLimit(`call:caption:${socket.id}`, 30, 2_000)) return;
    const uid = String(utteranceId).slice(0, 64);
    // by user, not socket: a speaker resends its finals from a new socket after a reconnect
    const key = `${user.id}:${uid}`;
    const state = captionsOf(id);
    const ts = state.starts.get(key) ?? Date.now();
    const body = text.slice(0, MAX_CAPTION_CHARS);
    let seq: number | null = null;
    if (final) {
      if (state.seen.has(key)) return;
      state.seen.add(key);
      if (state.seen.size > MAX_TRANSCRIPT) state.seen.delete(state.seen.values().next().value!);
      state.starts.delete(key);
      seq = ++state.seq;
      const entry: TranscriptEntry = {
        seq,
        socketId: socket.id,
        user: self.user,
        utteranceId: uid,
        lang,
        text: body,
        ts,
      };
      // insert by start time: finals of overlapping speakers arrive out of order
      let i = state.entries.length;
      while (i > 0 && state.entries[i - 1]!.ts > ts) i--;
      state.entries.splice(i, 0, entry);
      if (state.entries.length > MAX_TRANSCRIPT) state.entries.shift();
    }
    const segment = {
      callId: id,
      from: socket.id,
      userId: user.id,
      name: user.name,
      utteranceId: uid,
      lang,
      text: body,
      final: Boolean(final),
      ts,
      seq,
    };
    for (const peer of peers.values()) {
      if (peer.captions.enabled || peer.socketId === socket.id)
        emitToConn(peer.socketId, "call:caption", segment);
    }
  });

  socket.on("call:glossary", ({ callId, terms }) => {
    const id = String(callId);
    if (!live.get(id)?.has(socket.id) || !Array.isArray(terms)) return;
    if (!rateLimit(`call:glossary:${socket.id}`, 5, 10_000)) return;
    const glossary = [
      ...new Set(
        terms
          .filter((t): t is string => typeof t === "string")
          .map((t) => t.trim().slice(0, MAX_GLOSSARY_TERM_CHARS))
          .filter(Boolean),
      ),
    ].slice(0, MAX_GLOSSARY_TERMS);
    captionsOf(id).glossary = glossary;
    emitToRoom(rooms.call(id), "call:glossary", { callId: id, terms: glossary });
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

function sanitizeCaptions(captions: CaptionPrefs | undefined): CaptionPrefs {
  return {
    enabled: Boolean(captions?.enabled),
    lang: isCaptionLang(captions?.lang) ? captions.lang : CAPTION_PAIR[0],
  };
}

/** True while the user has a socket in the live call (captions are for people in the call). */
export function isInLiveCall(callId: string, userId: string) {
  for (const peer of live.get(callId)?.values() ?? []) if (peer.user.id === userId) return true;
  return false;
}
