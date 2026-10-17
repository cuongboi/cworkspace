import type { JsonObject } from "@zenstackhq/orm";
import type { NotificationType } from "../../zenstack/models";

type NotificationInput = {
  organizationId: string;
  userId: string;
  actorId?: string | null;
  type: NotificationType;
  groupId?: string | null;
  postId?: string | null;
  commentId?: string | null;
  eventId?: string | null;
  conversationId?: string | null;
  callId?: string | null;
  data?: JsonObject;
};

/**
 * Creates notifications (never for the actor themself). Delivery to the recipient's sockets
 * happens in the realtime plugin's Notification handler, so every path that creates one is live.
 */
export async function notify(items: NotificationInput[]) {
  const rows = items.filter((n) => n.userId !== n.actorId);
  if (rows.length === 0) return;
  // lazy: db.ts installs the realtime plugin, which imports this module
  const { db } = await import("../lib/db");
  for (const row of rows) await db.notification.create({ data: row });
}
