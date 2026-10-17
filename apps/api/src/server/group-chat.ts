import { db } from "../lib/db";

/**
 * A group's chat is one Conversation (`groupId` unique) created on first use. Its members mirror
 * the group's ACTIVE members and are written here, with the unscoped client, only: policies deny
 * clients any write to it and ground read access in the group membership itself, so a lagging
 * mirror never grants access — it only drives unread counts, typing and `message:new` fan-out.
 * Callers must have authorized the user first.
 */
export async function ensureGroupConversation(groupId: string) {
  const existing = await db.conversation.findUnique({
    where: { groupId },
    select: { id: true },
  });
  if (existing) return existing.id;

  const group = await db.group.findUnique({
    where: { id: groupId },
    select: {
      organizationId: true,
      createdById: true,
      members: { where: { status: "ACTIVE" }, select: { userId: true } },
    },
  });
  if (!group) return null;

  let id: string;
  try {
    const created = await db.conversation.create({
      data: {
        organizationId: group.organizationId,
        groupId,
        type: "GROUP",
        createdById: group.createdById,
      },
      select: { id: true },
    });
    id = created.id;
  } catch (err) {
    // lost the race against another member opening the chat (unique groupId)
    const raced = await db.conversation.findUnique({
      where: { groupId },
      select: { id: true },
    });
    if (!raced) throw err;
    return raced.id;
  }
  if (group.members.length) {
    await db.conversationMember.createMany({
      data: group.members.map((m) => ({ conversationId: id, userId: m.userId })),
      skipDuplicates: true,
    });
  }
  return id;
}

/** Keeps the group chat's members in sync with one group membership. No-op until the chat exists. */
export async function syncGroupConversationMember(
  groupId: string,
  userId: string,
  active: boolean,
) {
  const convo = await db.conversation.findUnique({
    where: { groupId },
    select: { id: true },
  });
  if (!convo) return;
  if (active) {
    await db.conversationMember.upsert({
      where: { conversationId_userId: { conversationId: convo.id, userId } },
      create: { conversationId: convo.id, userId },
      update: {},
    });
  } else {
    await db.conversationMember.deleteMany({
      where: { conversationId: convo.id, userId },
    });
  }
}
