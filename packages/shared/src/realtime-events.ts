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
  organizationId: string;
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
  organizationId: string;
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

export type CallPeer = {
  socketId: string;
  user: UserSummary;
  media: MediaState;
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
    p: { callId: string; media: MediaState },
    ack: Ack<{ call: CallSummary; peers: CallPeer[]; title: string }>,
  ) => void;
  "call:leave": (p: { callId: string }) => void;
  "call:decline": (p: { callId: string }) => void;
  "call:media": (p: { callId: string; media: MediaState }) => void;
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
