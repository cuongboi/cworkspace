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
  type RtcSignal,
  type TranscriptEntry,
  type UserSummary,
} from "@app/shared/realtime-events";
import {
  type CaptionOutput,
  callCaptions,
  captionsAvailable,
  closeCallCaptions,
  peekCallCaptions,
} from "@/server/captions";
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
/** a 100 ms PCM16 chunk at 16 kHz is 3200 bytes; anything much larger is not our client */
const MAX_AUDIO_BYTES = 16_000;
/**
 * Caption audio per user, across all their sockets: ~10 frames/s of 100 ms, with headroom.
 * Bounds what one account can make the server send to a provider billed by the hour.
 */
const AUDIO_FRAMES_PER_USER = 60;
const AUDIO_WINDOW_MS = 2_000;
/** PCM16 RMS below this (about -55 dBFS) is silence: not sent, so it neither bills nor holds the floor */
const MIN_AUDIO_RMS = 60;
/** Hard cap on captioning one call, from its first forwarded audio; then captions stop */
const CAPTION_BUDGET_MS = 4 * 60 * 60 * 1000;
/** Largest relayed WebRTC signal (an SDP offer with many tracks stays well under this) */
const MAX_SIGNAL_BYTES = 64 * 1024;

/**
 * Live caption state of a call, in memory only: the transcript is gone when the call ends.
 * Finals are ordered by when the utterance started, so a late final never jumps ahead of what
 * was said after it.
 */
type CallCaptionState = {
  seq: number;
  entries: TranscriptEntry[];
  glossary: string[];
  /** when audio was first forwarded to a provider (budget start) */
  startedAt: number | null;
  /** the budget ran out: no more audio for this call */
  exhausted: boolean;
};
const captionState = new Map<string, CallCaptionState>();

function captionsOf(callId: string): CallCaptionState {
  let state = captionState.get(callId);
  if (!state) {
    state = { seq: 0, entries: [], glossary: [], startedAt: null, exhausted: false };
    captionState.set(callId, state);
  }
  return state;
}

/** The call's shared glossary (biases the transcriber). */
function callGlossary(callId: string): string[] {
  return captionState.get(callId)?.glossary ?? [];
}

/** The server-side caption pipeline of a call (`server/captions`), wired to this call's peers. */
function pipelineOf(callId: string) {
  return callCaptions(callId, {
    glossary: () => callGlossary(callId),
    publish: (out) => publishCaption(callId, out),
    status: (status, error) =>
      emitToRoom(rooms.call(callId), "call:caption-status", { callId, status, error }),
  });
}

/** A caption from the provider: kept in the transcript when final, sent to every reader. */
function publishCaption(callId: string, out: CaptionOutput) {
  const peers = live.get(callId);
  const speaker = peers?.get(out.speaker.socketId);
  if (!peers || !speaker) return;
  const text = out.text.slice(0, MAX_CAPTION_CHARS);
  const translation = out.translation
    ? { lang: out.translation.lang, text: out.translation.text.slice(0, MAX_CAPTION_CHARS) }
    : null;
  let seq: number | null = null;
  if (out.final) {
    const state = captionsOf(callId);
    seq = ++state.seq;
    const entry: TranscriptEntry = {
      seq,
      socketId: speaker.socketId,
      user: speaker.user,
      utteranceId: out.utteranceId,
      lang: out.lang,
      text,
      translation,
      ts: out.ts,
    };
    let i = state.entries.length;
    while (i > 0 && state.entries[i - 1]!.ts > out.ts) i--;
    state.entries.splice(i, 0, entry);
    if (state.entries.length > MAX_TRANSCRIPT) state.entries.shift();
  }
  const segment = {
    callId,
    from: speaker.socketId,
    userId: speaker.user.id,
    name: speaker.user.name,
    utteranceId: out.utteranceId,
    lang: out.lang,
    text,
    translation,
    final: out.final,
    ts: out.ts,
    seq,
  };
  for (const peer of peers.values()) {
    if (peer.captions.enabled || peer.socketId === speaker.socketId)
      emitToConn(peer.socketId, "call:caption", segment);
  }
}

/**
 * Microphone audio of a speaker (binary `/ws` frame, see `websocket/index.ts`). Only forwarded
 * while the speaker is in the call, unmuted, and someone in the call reads captions.
 */
export function onCallAudio(socket: Conn, callId: string, pcm: Uint8Array) {
  const peers = live.get(callId);
  const self = peers?.get(socket.id);
  if (!peers || !self || !self.media.audio) return;
  if (pcm.byteLength === 0 || pcm.byteLength > MAX_AUDIO_BYTES || pcm.byteLength % 2) return;
  if (!rateLimit(`call:audio:${socket.id}`, 40, 2_000)) return;
  if (!rateLimit(`call:audio-user:${socket.user.id}`, AUDIO_FRAMES_PER_USER, AUDIO_WINDOW_MS))
    return;
  // a provider session for one person talking to themselves (or their own second tab) is waste
  if (new Set([...peers.values()].map((p) => p.user.id)).size < 2) return;
  if (![...peers.values()].some((p) => p.captions.enabled)) return;
  if (!captionsAvailable()) return;
  if (rms(pcm) < MIN_AUDIO_RMS) return;
  const state = captionsOf(callId);
  if (state.exhausted) return;
  const now = Date.now();
  state.startedAt ??= now;
  if (now - state.startedAt > CAPTION_BUDGET_MS) {
    state.exhausted = true;
    closeCallCaptions(callId);
    emitToRoom(rooms.call(callId), "call:caption-status", {
      callId,
      status: "off",
      error: "Caption time limit for this call reached",
    });
    return;
  }
  pipelineOf(callId).push(
    { socketId: socket.id, userId: socket.user.id, lang: self.captions.lang },
    pcm,
  );
}

/** Root mean square of little-endian PCM16 samples. */
function rms(pcm: Uint8Array) {
  const view = new DataView(pcm.buffer, pcm.byteOffset, pcm.byteLength);
  let sum = 0;
  for (let i = 0; i < pcm.byteLength; i += 2) {
    const s = view.getInt16(i, true);
    sum += s * s;
  }
  return Math.sqrt(sum / (pcm.byteLength / 2));
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
/** callId → the user who started it (the host: edits the caption glossary) */
const hosts = new Map<string, string>();
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
  hosts.delete(callId);
  captionState.delete(callId);
  closeCallCaptions(callId);
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
  peekCallCaptions(callId)?.release(socket.id);
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
      hosts.set(call.id, call.startedById);

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
      if (!hosts.has(call.id)) hosts.set(call.id, call.startedById);
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
          captions: captionsAvailable(),
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
    if (!peer.media.audio) peekCallCaptions(String(callId))?.release(socket.id);
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

  // the speaker muted: their utterance ends now rather than after the silence timeout
  socket.on("call:audio-end", ({ callId }) => {
    peekCallCaptions(String(callId))?.release(socket.id);
  });

  socket.on("call:glossary", ({ callId, terms }) => {
    const id = String(callId);
    const peers = live.get(id);
    if (!peers?.has(socket.id) || !Array.isArray(terms)) return;
    // the host edits the glossary (it steers the provider for everyone); while the host is not
    // in the call, any participant may
    const host = hosts.get(id);
    const hostPresent = [...peers.values()].some((p) => p.user.id === host);
    if (hostPresent && user.id !== host) return;
    if (!rateLimit(`call:glossary:${socket.id}`, 5, 10_000)) return;
    const glossary = sanitizeGlossary(terms);
    captionsOf(id).glossary = glossary;
    peekCallCaptions(id)?.glossaryChanged();
    emitToRoom(rooms.call(id), "call:glossary", { callId: id, terms: glossary });
  });

  socket.on("rtc:signal", ({ callId, to, data }) => {
    const peers = live.get(String(callId));
    // relay only between two sockets of the same call
    if (!peers?.has(socket.id) || !peers.has(String(to))) return;
    if (!rateLimit(`call:signal:${socket.id}`, 200, 10_000)) return;
    const signal = sanitizeSignal(data);
    if (!signal) return;
    emitToConn(String(to), "rtc:signal", {
      callId: String(callId),
      from: socket.id,
      data: signal,
    });
  });

  socket.onClose(() => {
    conns.delete(socket.id);
    for (const callId of socket.calls) leave(socket, callId).catch(logError("disconnect"));
  });
}

const logError = (what: string) => (err: unknown) => console.error(`[calls] ${what}`, err);

/** Glossary terms are fed to the caption provider: letters, digits, space, `_` and `-` only. */
const GLOSSARY_TERM_MAX = Math.min(40, MAX_GLOSSARY_TERM_CHARS);
export function sanitizeGlossary(terms: unknown[]): string[] {
  return [
    ...new Set(
      terms
        .filter((t): t is string => typeof t === "string")
        .map((t) =>
          t
            .normalize("NFKC")
            .replace(/[^\p{L}\p{N} _-]/gu, "")
            .replace(/\s+/g, " ")
            .trim()
            .slice(0, GLOSSARY_TERM_MAX)
            .trim(),
        )
        .filter(Boolean),
    ),
  ].slice(0, MAX_GLOSSARY_TERMS);
}

const SDP_TYPES = new Set(["offer", "answer", "pranswer", "rollback"]);

/**
 * Only the two shapes the web client sends (`lib/rtc/mesh-transport.ts`) are relayed, rebuilt
 * field by field so nothing else rides along, and capped in size.
 */
function sanitizeSignal(data: unknown): RtcSignal | null {
  if (!data || typeof data !== "object") return null;
  const d = data as Record<string, unknown>;
  let signal: RtcSignal;
  if ("description" in d) {
    const desc = d.description as Record<string, unknown> | null;
    if (!desc || typeof desc !== "object" || !SDP_TYPES.has(desc.type as string)) return null;
    if (desc.sdp !== undefined && typeof desc.sdp !== "string") return null;
    signal = {
      description: {
        type: desc.type as "offer" | "answer" | "pranswer" | "rollback",
        ...(typeof desc.sdp === "string" ? { sdp: desc.sdp } : {}),
      },
    };
  } else if ("candidate" in d) {
    const c = d.candidate as Record<string, unknown> | null;
    if (c === null) signal = { candidate: null };
    else {
      if (typeof c !== "object") return null;
      const { candidate, sdpMid, sdpMLineIndex, usernameFragment } = c;
      if (candidate !== undefined && typeof candidate !== "string") return null;
      if (sdpMid != null && typeof sdpMid !== "string") return null;
      if (sdpMLineIndex != null && !Number.isInteger(sdpMLineIndex)) return null;
      if (usernameFragment != null && typeof usernameFragment !== "string") return null;
      signal = {
        candidate: {
          ...(typeof candidate === "string" ? { candidate } : {}),
          sdpMid: (sdpMid as string | null | undefined) ?? null,
          sdpMLineIndex: (sdpMLineIndex as number | null | undefined) ?? null,
          ...(typeof usernameFragment === "string" ? { usernameFragment } : {}),
        },
      };
    }
  } else return null;
  return JSON.stringify(signal).length <= MAX_SIGNAL_BYTES ? signal : null;
}

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
