/**
 * Notification text and links, shared by the in-app list (client) and push messages (server).
 */

export type NotificationLinkable = {
  type: string;
  actor?: { name: string } | null;
  data?: unknown;
  postId?: string | null;
  commentId?: string | null;
  groupId?: string | null;
  eventId?: string | null;
  conversationId?: string | null;
  group?: { name: string; slug: string } | null;
  event?: { title: string } | null;
};

export const REACTION_EMOJI: Record<string, string> = {
  LIKE: "👍",
  LOVE: "❤️",
  HAHA: "😆",
  WOW: "😮",
  SAD: "😢",
  ANGRY: "😡",
};

export function dataField(data: unknown, key: string): string | undefined {
  if (data && typeof data === "object" && key in data) {
    const value = (data as Record<string, unknown>)[key];
    return typeof value === "string" ? value : undefined;
  }
  return undefined;
}

/** One-line plain-text sentence (push notifications, document titles). */
export function notificationText(n: NotificationLinkable): string {
  const actor = n.actor?.name ?? "Someone";
  const group = n.group?.name ?? "a group";
  const event = n.event?.title ?? dataField(n.data, "title") ?? "an event";
  switch (n.type) {
    case "MENTION":
      if (n.conversationId) return `${actor} mentioned you in a chat`;
      return `${actor} mentioned you in a ${n.commentId ? "comment" : "post"}`;
    case "POST_COMMENT":
      return `${actor} commented on your post`;
    case "COMMENT_REPLY":
      return `${actor} replied to your comment`;
    case "POST_REACTION": {
      const reaction = dataField(n.data, "reaction");
      return `${actor} reacted ${(reaction && REACTION_EMOJI[reaction]) ?? "👍"} to your post`;
    }
    case "GROUP_POST":
      return `${actor} posted in ${group}`;
    case "GROUP_JOIN_REQUEST":
      return `${actor} asked to join ${group}`;
    case "GROUP_JOIN_APPROVED":
      return `Your request to join ${group} was approved`;
    case "EVENT_INVITE":
      return `${actor} invited you to ${event}`;
    case "EVENT_REMINDER":
      return `Event starting soon: ${event}`;
    case "MISSED_CALL":
      return `Missed call from ${actor}`;
    case "THREAD_REPLY":
      return `${actor} replied in a thread`;
    default:
      return `New activity from ${actor}`;
  }
}

/** Where a notification leads. `groupSlug` is needed for group notifications. */
export function notificationHref(n: NotificationLinkable, groupSlug = n.group?.slug): string {
  switch (n.type) {
    case "GROUP_JOIN_REQUEST":
      return groupSlug ? `/groups/${groupSlug}?tab=members` : "/groups";
    case "GROUP_JOIN_APPROVED":
      return groupSlug ? `/groups/${groupSlug}` : "/groups";
    case "EVENT_INVITE":
    case "EVENT_REMINDER":
      return n.eventId ? `/calendar?event=${n.eventId}` : "/calendar";
    case "THREAD_REPLY":
      return n.conversationId
        ? threadHref(n.conversationId, dataField(n.data, "threadId"))
        : "/chat";
    case "MENTION":
    case "MISSED_CALL":
      if (n.conversationId && n.type === "MENTION") {
        return threadHref(n.conversationId, dataField(n.data, "threadId"));
      }
      if (n.conversationId) return `/chat/${n.conversationId}`;
      if (n.type === "MENTION") return n.postId ? `/posts/${n.postId}` : "/notifications";
      return n.eventId ? `/calendar?event=${n.eventId}` : "/chat";
    default:
      if (n.postId) return `/posts/${n.postId}`;
      if (groupSlug) return `/groups/${groupSlug}`;
      return "/notifications";
  }
}

function threadHref(conversationId: string, threadId?: string) {
  return threadId ? `/chat/${conversationId}?thread=${threadId}` : `/chat/${conversationId}`;
}
