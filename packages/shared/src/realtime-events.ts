/**
 * Realtime event contract shared by the API (`apps/api/src/websocket/*`, realtime plugin) and the
 * web client (`useSocketEvent`). Carried over a plain WebSocket at `/ws` (see "Wire protocol"). Most events are "something changed" signals carrying ids: clients
 * invalidate the matching React Query keys. Chat messages and notifications carry the row so the
 * UI updates instantly.
 */

export type MutationAction = "create" | "update" | "delete";

export type UserSummary = { id: string; name: string; image: string | null };

export type ChatMessagePayload = {
  id: string;
  conversationId: string;
  senderId: string;
  content: string;
  type: "TEXT" | "SYSTEM" | "CALL";
  data: unknown;
  replyToId: string | null;
  editedAt: Date | null;
  deletedAt: Date | null;
  createdAt: Date;
  sender: UserSummary;
};

export type NotificationPayload = {
  id: string;
  type: string;
  actor: UserSummary | null;
  groupId: string | null;
  postId: string | null;
  commentId: string | null;
  eventId: string | null;
  conversationId: string | null;
  callId: string | null;
  data: unknown;
  createdAt: Date;
};

export type CallKind = "AUDIO" | "VIDEO";

export type CallSummary = {
  id: string;
  conversationId: string | null;
  eventId: string | null;
  /** set for a group's drop-in call (its conversation is the group chat) */
  groupId: string | null;
  type: CallKind;
  startedById: string;
};

/** Live drop-in call of a group, pushed to the group room on every change. */
export type GroupCallState = {
  groupId: string;
  call: {
    id: string;
    conversationId: string;
    type: CallKind;
    startedAt: Date;
  } | null;
  /** distinct users currently in the call */
  participants: UserSummary[];
};

export type MediaState = { audio: boolean; video: boolean; screen: boolean };

/** Languages offered for live captions (BCP-47); also the speaker's spoken language. */
/**
 * The one language pair captions support (exactly two entries; change it here). Live Translate
 * takes no source language: within a pair, speech that isn't the reader's is the other one.
 */
export const CAPTION_LANGUAGES = {
  vi: "Tiếng Việt",
  ja: "日本語",
} as const;
export type CaptionLang = keyof typeof CAPTION_LANGUAGES;
export const CAPTION_PAIR = Object.keys(CAPTION_LANGUAGES) as [CaptionLang, CaptionLang];
export const otherCaptionLang = (lang: CaptionLang): CaptionLang =>
  lang === CAPTION_PAIR[0] ? CAPTION_PAIR[1] : CAPTION_PAIR[0];
export const isCaptionLang = (v: unknown): v is CaptionLang =>
  typeof v === "string" && Object.hasOwn(CAPTION_LANGUAGES, v);

/** `lang` is both what the peer speaks and the language they read captions in. */
export type CaptionPrefs = { enabled: boolean; lang: CaptionLang };

/**
 * Live captions: every speaker transcribes their own microphone (Transcribe Live) and sends the
 * original over `/ws`; every reader translates each remote speaker's audio into their own
 * language (Live Translate) in their browser. Translations never go through the server.
 */

/** Original text of one utterance. Partial updates replace `text` until `final`. */
export type CaptionSegment = {
  utteranceId: string;
  /** the speaker's language */
  lang: CaptionLang;
  text: string;
  final: boolean;
};

/**
 * Utterance boundaries from the speaker's voice detection (speaker → server only): the start
 * time orders the transcript.
 */
export type CaptionMark = {
  utteranceId: string;
  lang: CaptionLang;
  state: "start" | "end";
};

/** A final original kept by the server while the call lasts (never stored), in order. */
export type TranscriptEntry = {
  seq: number;
  socketId: string;
  user: UserSummary;
  utteranceId: string;
  lang: CaptionLang;
  text: string;
  /** when the utterance started (server clock): the transcript is ordered by it */
  ts: number;
};

/** Words the transcriber should recognise (names, product terms); shared by the call. */
export const MAX_GLOSSARY_TERMS = 100;
export const MAX_GLOSSARY_TERM_CHARS = 60;

export type CallPeer = {
  socketId: string;
  user: UserSummary;
  media: MediaState;
  captions: CaptionPrefs;
};

/** WebRTC signaling payload relayed verbatim between two sockets of the same call. */
export type RtcSignal =
  | {
    description: {
      type: "offer" | "answer" | "pranswer" | "rollback";
      sdp?: string;
    };
  }
  | {
    candidate: {
      candidate?: string;
      sdpMid?: string | null;
      sdpMLineIndex?: number | null;
    } | null;
  };

/** Server → client */
export interface ServerToClientEvents {
  // feed
  "post:changed": (p: {
    groupId: string;
    postId: string;
    action: MutationAction;
  }) => void;
  "comment:changed": (p: {
    groupId: string;
    postId: string;
    commentId: string;
    action: MutationAction;
  }) => void;
  "reaction:changed": (p: {
    groupId: string;
    postId: string;
    commentId: string | null;
  }) => void;
  "poll:changed": (p: {
    groupId: string;
    postId: string;
    pollId: string;
  }) => void;
  "group:changed": (p: { groupId: string }) => void;
  "group:call": (p: GroupCallState) => void;
  "wiki:changed": (p: { groupId: string; pageId: string; action: MutationAction }) => void;
  // chat
  "message:new": (p: ChatMessagePayload) => void;
  "message:changed": (p: { conversationId: string; messageId: string }) => void;
  "conversation:changed": (p: { conversationId: string }) => void;
  "conversation:read": (p: {
    conversationId: string;
    userId: string;
    lastReadAt: Date;
  }) => void;
  typing: (p: { conversationId: string; user: UserSummary }) => void;
  // presence
  "presence:snapshot": (p: { online: string[] }) => void;
  presence: (p: { userId: string; online: boolean }) => void;
  // notifications & calendar
  "notification:new": (p: NotificationPayload) => void;
  "event:changed": (p: { eventId: string }) => void;
  // calls
  "call:incoming": (p: {
    call: CallSummary;
    from: UserSummary;
    title: string;
  }) => void;
  "call:peer-joined": (p: CallPeer & { callId: string }) => void;
  "call:peer-left": (p: {
    callId: string;
    socketId: string;
    userId: string;
  }) => void;
  "call:peer-media": (p: {
    callId: string;
    socketId: string;
    media: MediaState;
  }) => void;
  /** the user answered on another tab/device: stop ringing there */
  "call:answered": (p: { callId: string }) => void;
  "call:declined": (p: { callId: string; user: UserSummary }) => void;
  "call:ended": (p: { callId: string }) => void;
  "call:peer-captions": (p: { callId: string; socketId: string; captions: CaptionPrefs }) => void;
  /** to everyone in the call reading captions; `seq` is set on finals */
  "call:caption": (
    p: CaptionSegment & {
      callId: string;
      from: string;
      userId: string;
      name: string;
      ts: number;
      seq: number | null;
    },
  ) => void;
  /** to the other readers of the call */
  "call:glossary": (p: { callId: string; terms: string[] }) => void;
  "rtc:signal": (p: { callId: string; from: string; data: RtcSignal }) => void;
}

export type Ack<T> = (
  res: { ok: true; data: T } | { ok: false; error: string },
) => void;

/** Client → server */
export interface ClientToServerEvents {
  typing: (p: { conversationId: string }) => void;
  "call:start": (
    p: { conversationId?: string; eventId?: string; groupId?: string; type: CallKind },
    ack: Ack<{ callId: string }>,
  ) => void;
  "group:call:get": (p: { groupId: string }, ack: Ack<GroupCallState>) => void;
  "call:join": (
    p: { callId: string; media: MediaState; captions?: CaptionPrefs },
    ack: Ack<{
      call: CallSummary;
      peers: CallPeer[];
      title: string;
      /** false without a Gemini key: live captions are off for the deployment */
      captions: boolean;
      /** finals said so far in this call (late joiners catch up), ordered */
      transcript: TranscriptEntry[];
      glossary: string[];
    }>,
  ) => void;
  "call:leave": (p: { callId: string }) => void;
  "call:decline": (p: { callId: string }) => void;
  "call:media": (p: { callId: string; media: MediaState }) => void;
  "call:captions": (p: { callId: string; captions: CaptionPrefs }) => void;
  "call:caption": (p: CaptionSegment & { callId: string }) => void;
  "call:caption-mark": (p: CaptionMark & { callId: string }) => void;
  "call:glossary": (p: { callId: string; terms: string[] }) => void;
  "rtc:signal": (p: { callId: string; to: string; data: RtcSignal }) => void;
}

/** Max participants of a mesh (P2P) call; enforced by the server. */
export const MAX_MESH_PARTICIPANTS = 6;

/** Payload type of a server → client event. */
export type ServerEvent = keyof ServerToClientEvents;
export type ServerPayload<E extends ServerEvent> = Parameters<ServerToClientEvents[E]>[0];

/** Client → server events that are fire-and-forget vs. request/response (acked). */
export type ClientEvent = keyof ClientToServerEvents;
export type ClientPayload<E extends ClientEvent> = Parameters<ClientToServerEvents[E]>[0];
type AckOf<F> = F extends (p: never, ack: Ack<infer T>) => void ? T : never;
export type ClientRequest = {
  [E in ClientEvent]: Parameters<ClientToServerEvents[E]>["length"] extends 2 ? E : never;
}[ClientEvent];
export type ClientAckData<E extends ClientRequest> = AckOf<ClientToServerEvents[E]>;
export type AckResult<T> = { ok: true; data: T } | { ok: false; error: string };

/**
 * Wire protocol (JSON text frames). `socketId` in the contract is the per-connection id the server
 * assigns on connect (sent in `hello`); it addresses WebRTC signaling and orders polite peers.
 *   server → client  { e: "hello", d: { socketId } }
 *                    { e: <ServerEvent>, d: payload }
 *                    { ack: <id>, res: AckResult }          reply to a client request
 *   client → server  { e: <ClientEvent>, d: payload }        fire-and-forget
 *                    { e: <ClientRequest>, d: payload, id }  expects an `ack` frame with that id
 */
export type ServerFrame =
  | { e: "hello"; d: { socketId: string } }
  | { e: ServerEvent; d: unknown }
  | { ack: number; res: AckResult<unknown> };
export type ClientFrame = { e: ClientEvent; d: unknown; id?: number };
