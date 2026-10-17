import type { UserSummary } from "@app/shared/realtime-events";
import { db } from "@/lib/db";
import { rateLimit } from "@/server/rate-limit";
import { type Conn, connectionCount, emitTo, emitToUsers, onlineUserIds, rooms } from "./hub";

/** Joins org and group rooms, announces presence and sends the initial snapshot. */
export async function registerPresence(conn: Conn) {
  const { user } = conn;
  const [memberships, groups] = await Promise.all([
    db.member.findMany({ where: { userId: user.id }, select: { organizationId: true } }),
    db.groupMember.findMany({
      where: { userId: user.id, status: "ACTIVE" },
      select: { groupId: true },
    }),
  ]);
  const orgIds = memberships.map((m) => m.organizationId);
  for (const id of orgIds) conn.join(rooms.org(id));
  for (const g of groups) conn.join(rooms.group(g.groupId));

  if (connectionCount(user.id) === 1 && orgIds.length)
    emitTo(orgIds.map(rooms.org), "presence", { userId: user.id, online: true });

  const visible = await db.member.findMany({
    where: { userId: { in: [...onlineUserIds()] }, organizationId: { in: orgIds } },
    select: { userId: true },
    distinct: ["userId"],
  });
  conn.emit("presence:snapshot", { online: visible.map((m) => m.userId) });
}

/**
 * Call after the connection was unregistered (with the rooms it was in): announces offline when it
 * was the user's last connection.
 */
export function announceOffline(conn: Conn, roomsBefore: string[]) {
  if (connectionCount(conn.user.id) > 0) return;
  const orgRooms = roomsBefore.filter((r) => r.startsWith("org:"));
  if (orgRooms.length) emitTo(orgRooms, "presence", { userId: conn.user.id, online: false });
}

/** Typing indicators: relayed to the other members of a conversation the sender belongs to. */
export function registerTyping(conn: Conn) {
  const { user } = conn;
  const verified = new Map<string, string[]>(); // conversationId → member ids (cached per connection)
  const summary: UserSummary = { id: user.id, name: user.name, image: user.image };

  const relay = async (conversationId: string) => {
    let memberIds = verified.get(conversationId);
    if (!memberIds) {
      const rows = await db.conversationMember.findMany({
        where: { conversationId },
        select: { userId: true },
      });
      memberIds = rows.map((r) => r.userId);
      if (!memberIds.includes(user.id)) return;
      verified.set(conversationId, memberIds);
    }
    emitToUsers(
      memberIds.filter((id) => id !== user.id),
      "typing",
      { conversationId, user: summary },
    );
  };

  conn.on("typing", (payload) => {
    const conversationId = (payload as { conversationId?: unknown } | null)?.conversationId;
    if (typeof conversationId !== "string" || !rateLimit(`typing:${conn.id}`, 5, 2_000)) return;
    relay(conversationId).catch((err) => console.error("[ws] typing", err));
  });
}
