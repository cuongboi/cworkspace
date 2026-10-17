import type { ClientFrame } from "@app/shared/realtime-events";
import Elysia from "elysia";
import { authMacro } from "@/plugins/auth";
import { toSessionUser } from "@/server/session";
import { registerCalls } from "./calls";
import { Conn, type RawSocket, register, unregister } from "./hub";
import { announceOffline, registerPresence, registerTyping } from "./presence";

/** The raw Bun socket is stable across Elysia's per-event `ws` wrappers. */
const conns = new WeakMap<object, Conn>();

function parseFrame(message: unknown): ClientFrame | null {
  let frame: unknown = message;
  if (typeof message === "string") {
    try {
      frame = JSON.parse(message);
    } catch {
      return null;
    }
  }
  if (!frame || typeof frame !== "object") return null;
  const { e, d, id } = frame as Record<string, unknown>;
  if (typeof e !== "string" || e.length > 64) return null;
  return { e: e as ClientFrame["e"], d, id: typeof id === "number" ? id : undefined };
}

/**
 * `/ws`: authenticated from the better-auth session cookie (`auth: true` rejects the upgrade).
 * Protocol and events: `@app/shared/realtime-events`. Handlers: presence, typing, calls.
 */
export const webSocketPlugin = () =>
  new Elysia({ name: "websocket" }).use(authMacro).ws("/ws", {
    auth: true,
    idleTimeout: 120,
    open(ws) {
      const conn = new Conn(ws.raw as RawSocket, toSessionUser(ws.data.user));
      conns.set(ws.raw, conn);
      register(conn);
      conn.send({ e: "hello", d: { socketId: conn.id } });
      registerTyping(conn);
      registerCalls(conn);
      registerPresence(conn).catch((err) => console.error("[ws] presence", err));
    },
    message(ws, message) {
      const conn = conns.get(ws.raw);
      const frame = parseFrame(message);
      if (!conn || !frame) return;
      conn.dispatch(frame.e, frame.d, frame.id);
    },
    close(ws) {
      const conn = conns.get(ws.raw);
      if (!conn) return;
      conns.delete(ws.raw);
      const roomsBefore = [...conn.rooms];
      unregister(conn);
      announceOffline(conn, roomsBefore);
    },
  });
