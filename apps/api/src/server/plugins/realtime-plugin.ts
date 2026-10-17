import { definePlugin } from "@zenstackhq/orm";
import { extractMentionIds } from "@app/shared/mentions";
import type { ChatMessagePayload, MutationAction } from "@app/shared/realtime-events";
import type { SchemaType } from "../../../zenstack/schema";
import { notify } from "../notify";
import {
  emitToRoom,
  emitToUsers,
  groupMembershipEnded,
  joinUserToRoom,
  removeUserFromRoom,
  rooms,
} from "../../websocket/hub";

/**
 * Side effects of mutations, wherever they come from (`/execute`, API routes, better-auth).
 * Runs after the transaction commits. Handlers read with the unscoped `db` (lazy import: db.ts
 * installs this plugin) and must stay cheap: every mutation, including better-auth's session
 * writes, passes through here. Failures are logged and never fail the original request.
 */

type Row = Record<string, unknown>;
type Handler = (action: MutationAction, rows: Row[]) => Promise<void>;

const getDb = async () => (await import("../../lib/db")).db;
// lazy for the same reason: group-chat.ts imports db.ts
const groupChat = () => import("../group-chat");
const str = (v: unknown) => v as string;

const userSummary = { select: { id: true, name: true, image: true } } as const;

/** Users mentioned in `text` who can read posts of `groupId`. */
async function mentionedReaders(text: string, groupId: string) {
  const ids = extractMentionIds(text);
  if (ids.length === 0) return [];
  const db = await getDb();
  const group = await db.group.findUnique({
    where: { id: groupId },
    select: { privacy: true, organizationId: true },
  });
  if (!group) return [];
  const users = await db.user.findMany({
    where: {
      id: { in: ids },
      members: { some: { organizationId: group.organizationId } },
      ...(group.privacy === "PUBLIC"
        ? {}
        : { groupMemberships: { some: { groupId, status: "ACTIVE" } } }),
    },
    select: { id: true },
  });
  return users.map((u) => u.id);
}

async function conversationMemberIds(conversationId: string) {
  const db = await getDb();
  const members = await db.conversationMember.findMany({
    where: { conversationId },
    select: { userId: true },
  });
  return members.map((m) => m.userId);
}

const handlers: Partial<Record<string, Handler>> = {
  // ── feed ──────────────────────────────────────────────────────────
  async Post(action, rows) {
    const db = await getDb();
    for (const post of rows) {
      const groupId = str(post.groupId);
      emitToRoom(rooms.group(groupId), "post:changed", {
        groupId,
        postId: str(post.id),
        action,
      });
      if (action !== "create") continue;
      const group = await db.group.findUnique({
        where: { id: groupId },
        select: { organizationId: true },
      });
      if (!group) continue;
      const mentioned = await mentionedReaders(str(post.content), groupId);
      await notify(
        mentioned.map((userId) => ({
          organizationId: group.organizationId,
          userId,
          actorId: str(post.authorId),
          type: "MENTION",
          groupId,
          postId: str(post.id),
        })),
      );
    }
  },

  async Comment(action, rows) {
    const db = await getDb();
    for (const comment of rows) {
      const post = await db.post.findUnique({
        where: { id: str(comment.postId) },
        select: {
          id: true,
          authorId: true,
          groupId: true,
          group: { select: { organizationId: true } },
        },
      });
      if (!post) continue;
      emitToRoom(rooms.group(post.groupId), "comment:changed", {
        groupId: post.groupId,
        postId: post.id,
        commentId: str(comment.id),
        action,
      });
      if (action !== "create") continue;

      const base = {
        organizationId: post.group.organizationId,
        actorId: str(comment.authorId),
        groupId: post.groupId,
        postId: post.id,
        commentId: str(comment.id),
      };
      const notified = new Set<string>();
      const items: Parameters<typeof notify>[0] = [];
      for (const userId of await mentionedReaders(str(comment.content), post.groupId)) {
        notified.add(userId);
        items.push({ ...base, userId, type: "MENTION" });
      }
      if (comment.parentId) {
        const parent = await db.comment.findUnique({
          where: { id: str(comment.parentId) },
          select: { authorId: true },
        });
        if (parent && !notified.has(parent.authorId)) {
          notified.add(parent.authorId);
          items.push({
            ...base,
            userId: parent.authorId,
            type: "COMMENT_REPLY",
          });
        }
      }
      if (!notified.has(post.authorId))
        items.push({ ...base, userId: post.authorId, type: "POST_COMMENT" });
      await notify(items);
    }
  },

  async PostReaction(action, rows) {
    const db = await getDb();
    for (const reaction of rows) {
      const post = await db.post.findUnique({
        where: { id: str(reaction.postId) },
        select: {
          id: true,
          authorId: true,
          groupId: true,
          group: { select: { organizationId: true } },
        },
      });
      if (!post) continue;
      emitToRoom(rooms.group(post.groupId), "reaction:changed", {
        groupId: post.groupId,
        postId: post.id,
        commentId: null,
      });
      if (action !== "create") continue;
      // coalesce: one unread reaction notification per actor and post
      const existing = await db.notification.findFirst({
        where: {
          userId: post.authorId,
          actorId: str(reaction.userId),
          postId: post.id,
          type: "POST_REACTION",
          readAt: null,
        },
        select: { id: true },
      });
      if (existing) continue;
      await notify([
        {
          organizationId: post.group.organizationId,
          userId: post.authorId,
          actorId: str(reaction.userId),
          type: "POST_REACTION",
          groupId: post.groupId,
          postId: post.id,
          data: { reaction: str(reaction.type) },
        },
      ]);
    }
  },

  async CommentReaction(_action, rows) {
    const db = await getDb();
    for (const reaction of rows) {
      const comment = await db.comment.findUnique({
        where: { id: str(reaction.commentId) },
        select: { id: true, postId: true, post: { select: { groupId: true } } },
      });
      if (!comment) continue;
      emitToRoom(rooms.group(comment.post.groupId), "reaction:changed", {
        groupId: comment.post.groupId,
        postId: comment.postId,
        commentId: comment.id,
      });
    }
  },

  async PollVote(_action, rows) {
    const db = await getDb();
    for (const pollId of new Set(rows.map((r) => str(r.pollId)))) {
      const poll = await db.poll.findUnique({
        where: { id: pollId },
        select: { postId: true, post: { select: { groupId: true } } },
      });
      if (!poll) continue;
      emitToRoom(rooms.group(poll.post.groupId), "poll:changed", {
        groupId: poll.post.groupId,
        postId: poll.postId,
        pollId,
      });
    }
  },

  async Group(_action, rows) {
    for (const group of rows) {
      emitToRoom(rooms.group(str(group.id)), "group:changed", {
        groupId: str(group.id),
      });
    }
  },

  async GroupMember(action, rows) {
    const db = await getDb();
    for (const member of rows) {
      const groupId = str(member.groupId);
      const userId = str(member.userId);
      const room = rooms.group(groupId);

      const active = action !== "delete" && member.status === "ACTIVE";
      if (active) joinUserToRoom(userId, room);
      else {
        removeUserFromRoom(userId, room);
        groupMembershipEnded(groupId, userId);
      }
      await (await groupChat()).syncGroupConversationMember(groupId, userId, active);
      emitToRoom(room, "group:changed", { groupId });
      emitToUsers([userId], "group:changed", { groupId });

      const group = await db.group.findUnique({
        where: { id: groupId },
        select: { organizationId: true },
      });
      if (!group) continue;
      if (action === "create" && member.status === "PENDING") {
        const admins = await db.groupMember.findMany({
          where: {
            groupId,
            status: "ACTIVE",
            role: { in: ["ADMIN", "MODERATOR"] },
          },
          select: { userId: true },
        });
        await notify(
          admins.map((a) => ({
            organizationId: group.organizationId,
            userId: a.userId,
            actorId: userId,
            type: "GROUP_JOIN_REQUEST",
            groupId,
          })),
        );
      }
      if (action === "update" && member.status === "ACTIVE") {
        // approvals only: a PENDING request that just became ACTIVE has no approval notification yet
        const already = await db.notification.findFirst({
          where: { userId, groupId, type: "GROUP_JOIN_APPROVED" },
          select: { id: true },
        });
        const wasRequested = await db.notification.findFirst({
          where: { actorId: userId, groupId, type: "GROUP_JOIN_REQUEST" },
          select: { id: true },
        });
        if (!already && wasRequested) {
          await notify([
            {
              organizationId: group.organizationId,
              userId,
              type: "GROUP_JOIN_APPROVED",
              groupId,
            },
          ]);
        }
      }
    }
  },

  // ── knowledge ─────────────────────────────────────────────────────
  async WikiPage(action, rows) {
    for (const page of rows) {
      const groupId = str(page.groupId);
      emitToRoom(rooms.group(groupId), "wiki:changed", {
        groupId,
        pageId: str(page.id),
        action,
      });
    }
  },

  // ── chat ──────────────────────────────────────────────────────────
  async Message(action, rows) {
    const db = await getDb();
    for (const row of rows) {
      const conversationId = str(row.conversationId);
      const memberIds = await conversationMemberIds(conversationId);
      if (action === "create") {
        const message = await db.message.findUnique({
          where: { id: str(row.id) },
          include: { sender: userSummary },
        });
        if (!message) continue;
        await db.conversation.update({
          where: { id: conversationId },
          data: { lastMessageAt: message.createdAt },
        });
        emitToUsers(memberIds, "message:new", message as ChatMessagePayload);
      } else {
        emitToUsers(memberIds, "message:changed", {
          conversationId,
          messageId: str(row.id),
        });
      }
    }
  },

  async MessageReaction(_action, rows) {
    const db = await getDb();
    for (const reaction of rows) {
      const message = await db.message.findUnique({
        where: { id: str(reaction.messageId) },
        select: { id: true, conversationId: true },
      });
      if (!message) continue;
      emitToUsers(await conversationMemberIds(message.conversationId), "message:changed", {
        conversationId: message.conversationId,
        messageId: message.id,
      });
    }
  },

  async Conversation(action, rows) {
    for (const row of rows) {
      // lastMessageAt bumps are covered by message:new
      if (action === "update") continue;
      const conversationId = str(row.id);
      emitToUsers(await conversationMemberIds(conversationId), "conversation:changed", {
        conversationId,
      });
    }
  },

  async ConversationMember(action, rows) {
    for (const row of rows) {
      const conversationId = str(row.conversationId);
      const members = await conversationMemberIds(conversationId);
      if (action === "update") {
        emitToUsers(members, "conversation:read", {
          conversationId,
          userId: str(row.userId),
          lastReadAt: row.lastReadAt as Date,
        });
      } else {
        emitToUsers([...members, str(row.userId)], "conversation:changed", {
          conversationId,
        });
      }
    }
  },

  // ── notifications ─────────────────────────────────────────────────
  async Notification(action, rows) {
    if (action !== "create") return;
    const db = await getDb();
    for (const row of rows) {
      const notification = await db.notification.findUnique({
        where: { id: str(row.id) },
        include: { actor: userSummary },
      });
      if (notification) emitToUsers([notification.userId], "notification:new", notification);
    }
  },

  // ── calendar ──────────────────────────────────────────────────────
  async Event(_action, rows) {
    const db = await getDb();
    for (const row of rows) {
      const eventId = str(row.id);
      const attendees = await db.eventAttendee.findMany({
        where: { eventId },
        select: { userId: true },
      });
      const targets = [str(row.creatorId), ...attendees.map((a) => a.userId)];
      emitToUsers(targets, "event:changed", { eventId });
      if (row.groupId) emitToRoom(rooms.group(str(row.groupId)), "event:changed", { eventId });
    }
  },

  async EventAttendee(action, rows) {
    const db = await getDb();
    for (const row of rows) {
      const event = await db.event.findUnique({
        where: { id: str(row.eventId) },
        select: {
          id: true,
          organizationId: true,
          creatorId: true,
          title: true,
        },
      });
      if (!event) continue;
      emitToUsers([event.creatorId, str(row.userId)], "event:changed", {
        eventId: event.id,
      });
      if (action === "create" && row.userId !== event.creatorId) {
        await notify([
          {
            organizationId: event.organizationId,
            userId: str(row.userId),
            actorId: event.creatorId,
            type: "EVENT_INVITE",
            eventId: event.id,
            data: { title: event.title },
          },
        ]);
      }
    }
  },
};

/** Models whose deletes need their rows captured before the delete runs. */
const NEEDS_BEFORE_DELETE = new Set(Object.keys(handlers));

export const realtimePlugin = definePlugin<SchemaType>({
  id: "realtime",
  onEntityMutation: {
    runAfterMutationWithinTransaction: false,
    beforeEntityMutation: async ({ model, action, loadBeforeMutationEntities }) => {
      if (action === "delete" && NEEDS_BEFORE_DELETE.has(model)) await loadBeforeMutationEntities();
    },
    afterEntityMutation: async ({
      model,
      action,
      loadAfterMutationEntities,
      beforeMutationEntities,
    }) => {
      const handler = handlers[model];
      if (!handler) return;
      try {
        const rows =
          action === "delete" ? beforeMutationEntities : await loadAfterMutationEntities();
        if (rows?.length) await handler(action, rows);
      } catch (err) {
        console.error(`[realtime] ${model}.${action}`, err);
      }
    },
  },
});
