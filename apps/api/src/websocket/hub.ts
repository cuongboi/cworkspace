import type {
  AckResult,
  ClientEvent,
  ClientToServerEvents,
  ServerEvent,
  ServerFrame,
  ServerPayload,
} from "@app/shared/realtime-events";
import type { SessionUser } from "../server/session";

/**
 * In-process realtime hub over Bun WebSockets: the only way server code pushes events.
 * Rooms are tracked here (not with Bun topics) so a socket in several target rooms gets an event
 * once, broadcasts can exclude the sender, and all sockets of a user can join/leave a room — the
 * Socket.IO semantics the feature code was written against. State is per process: run one
 * instance, or bridge `deliver` through Redis pub/sub before scaling out.
 */

/** Minimal surface of Bun's `ServerWebSocket` we rely on. */
export type RawSocket = {
  send(data: string): unknown;
  close(code?: number, reason?: string): void;
};

type Handler = (payload: never, ack: (res: AckResult<never>) => void) => unknown;

export const rooms = {
  user: (userId: string) => `user:${userId}`,
  org: (organizationId: string) => `org:${organizationId}`,
  group: (groupId: string) => `group:${groupId}`,
  call: (callId: string) => `call:${callId}`,
};

const members = new Map<string, Set<Conn>>(); // room → connections

/** One authenticated WebSocket connection. `id` is the client's `socketId`. */
export class Conn {
  readonly id = crypto.randomUUID();
  readonly rooms = new Set<string>();
  /** callIds this connection joined (left automatically on close) */
  readonly calls = new Set<string>();
  private readonly handlers = new Map<string, Handler>();
  private readonly closeHandlers: (() => void)[] = [];

  readonly raw: RawSocket;
  readonly user: SessionUser;

  constructor(raw: RawSocket, user: SessionUser) {
    this.raw = raw;
    this.user = user;
  }

  /** Payloads come from the client: handlers must validate every field they use. */
  on<E extends ClientEvent>(event: E, handler: ClientToServerEvents[E]) {
    this.handlers.set(event, handler as unknown as Handler);
  }

  onClose(handler: () => void) {
    this.closeHandlers.push(handler);
  }

  send(frame: ServerFrame) {
    try {
      this.raw.send(JSON.stringify(frame));
    } catch {
      // socket already closing; `close` cleans up
    }
  }

  emit<E extends ServerEvent>(event: E, payload: ServerPayload<E>) {
    this.send({ e: event, d: payload });
  }

  join(room: string) {
    this.rooms.add(room);
    let set = members.get(room);
    if (!set) members.set(room, (set = new Set()));
    set.add(this);
  }

  leave(room: string) {
    this.rooms.delete(room);
    const set = members.get(room);
    set?.delete(this);
    if (set?.size === 0) members.delete(room);
  }

  /** Emits to everyone in `room` except this connection (Socket.IO's `socket.to(room)`). */
  broadcast<E extends ServerEvent>(room: string, event: E, payload: ServerPayload<E>) {
    emitTo([room], event, payload, this.id);
  }

  /** Dispatches a parsed client frame; request frames (with `id`) always get an `ack`. */
  dispatch(event: string, payload: unknown, reqId?: number) {
    const handler = this.handlers.get(event);
    const ack = (res: AckResult<unknown>) => {
      if (typeof reqId === "number") this.send({ ack: reqId, res });
    };
    if (!handler) return ack({ ok: false, error: `Unknown event ${event}` });
    // handlers destructure their payload: never hand them a non-object
    const data = payload && typeof payload === "object" ? payload : {};
    try {
      const result = handler(data as never, ack as never);
      if (result instanceof Promise)
        result.catch((err) => {
          console.error(`[ws] ${event}`, err);
          ack({ ok: false, error: "Internal error" });
        });
    } catch (err) {
      console.error(`[ws] ${event}`, err);
      ack({ ok: false, error: "Internal error" });
    }
  }

  /** Called once when the socket closes. */
  dispose() {
    for (const handler of this.closeHandlers) {
      try {
        handler();
      } catch (err) {
        console.error("[ws] close handler", err);
      }
    }
    for (const room of this.rooms) this.leave(room);
  }
}

/** Emits to every connection in any of `targets`, once per connection. */
export function emitTo<E extends ServerEvent>(
  targets: Iterable<string>,
  event: E,
  payload: ServerPayload<E>,
  exceptConnId?: string,
) {
  const seen = new Set<Conn>();
  for (const room of targets) {
    for (const conn of members.get(room) ?? []) {
      if (conn.id !== exceptConnId) seen.add(conn);
    }
  }
  if (seen.size === 0) return;
  const frame = JSON.stringify({ e: event, d: payload });
  for (const conn of seen) {
    try {
      conn.raw.send(frame);
    } catch {
      // closing socket
    }
  }
}

/** Emits to every connection of the given users. */
export function emitToUsers<E extends ServerEvent>(
  userIds: Iterable<string>,
  event: E,
  payload: ServerPayload<E>,
) {
  emitTo([...new Set(userIds)].map(rooms.user), event, payload);
}

export function emitToRoom<E extends ServerEvent>(
  room: string,
  event: E,
  payload: ServerPayload<E>,
) {
  emitTo([room], event, payload);
}

/** Emits to one connection by id (WebRTC signaling). */
export function emitToConn<E extends ServerEvent>(
  connId: string,
  event: E,
  payload: ServerPayload<E>,
) {
  for (const conn of members.get(rooms.user(connOwner.get(connId) ?? "")) ?? []) {
    if (conn.id === connId) return conn.emit(event, payload);
  }
}

const connOwner = new Map<string, string>(); // connId → userId

export function register(conn: Conn) {
  connOwner.set(conn.id, conn.user.id);
  conn.join(rooms.user(conn.user.id));
}

export function unregister(conn: Conn) {
  connOwner.delete(conn.id);
  conn.dispose();
}

/** Subscribes / unsubscribes all of a user's connections to a room (e.g. after joining a group). */
export function joinUserToRoom(userId: string, room: string) {
  for (const conn of members.get(rooms.user(userId)) ?? []) conn.join(room);
}

export function removeUserFromRoom(userId: string, room: string) {
  for (const conn of members.get(rooms.user(userId)) ?? []) conn.leave(room);
}

/** Removes every connection from a room (Socket.IO's `io.in(room).socketsLeave(room)`). */
export function clearRoom(room: string) {
  for (const conn of members.get(room) ?? []) conn.leave(room);
}

/** Number of open connections of a user (presence). */
export function connectionCount(userId: string) {
  return members.get(rooms.user(userId))?.size ?? 0;
}

/** Users with at least one open connection. */
export function onlineUserIds() {
  return new Set(connOwner.values());
}
