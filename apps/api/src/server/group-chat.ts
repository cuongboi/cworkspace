import { db } from "../lib/db";
import { badRequest, conflict, notFound } from "../lib/errors";

/**
 * A group's chats are its channels. The group chat (`Conversation.groupId`, unique) is the
 * `#general` channel; other channels each own one Conversation (`channelId`). Their members
 * mirror the group's ACTIVE members and are written here, with the unscoped client, only:
 * policies deny clients any write to them and ground read access in the group membership itself,
 * so a lagging mirror never grants access — it only drives unread counts, typing and
 * `message:new` fan-out. Callers must have authorized the user first.
 */
export async function ensureGroupConversation(groupId: string) {
  const existing = await db.conversation.findUnique({
    where: { groupId },
    select: { id: true, channelId: true },
  });
  if (existing) {
    if (!existing.channelId) await ensureGeneralChannel(groupId, existing.id);
    return existing.id;
  }

  const group = await db.group.findUnique({
    where: { id: groupId },
    select: {
      createdById: true,
      members: { where: { status: "ACTIVE" }, select: { userId: true } },
    },
  });
  if (!group) return null;

  let id: string;
  try {
    const created = await db.conversation.create({
      data: {
        groupId,
        type: "CHANNEL",
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
  await ensureGeneralChannel(groupId, id);
  return id;
}

/** Links the group chat to a `#general` channel row (created once). */
async function ensureGeneralChannel(groupId: string, conversationId: string) {
  const group = await db.group.findUnique({
    where: { id: groupId },
    select: { createdById: true },
  });
  if (!group) return;
  let channel = await db.channel.findFirst({
    where: { groupId, isDefault: true },
    select: { id: true },
  });
  channel ??= await db.channel.create({
    data: { groupId, name: "general", isDefault: true, createdById: group.createdById },
    select: { id: true },
  });
  await db.conversation
    .update({
      where: { id: conversationId },
      data: { channelId: channel.id },
      select: { id: true },
    })
    .catch(() => undefined); // a concurrent call linked it already
}

/** Lowercase slug: letters, digits, `-` and `_`; spaces become `-`. */
export function normalizeChannelName(raw: string) {
  return raw
    .trim()
    .toLowerCase()
    .replace(/^#+/, "")
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9_-]/g, "")
    .replace(/-{2,}/g, "-")
    .slice(0, 40);
}

/** Validates a name/parent pair for a channel in `groupId` (sibling-unique, one nesting level). */
export async function checkChannelPlacement(
  groupId: string,
  name: string,
  parentId: string | null,
  selfId?: string,
) {
  if (!name) throw badRequest("Channel names use letters, numbers, - and _");
  if (parentId) {
    if (parentId === selfId) throw badRequest("A channel cannot be nested under itself");
    const parent = await db.channel.findUnique({
      where: { id: parentId },
      select: { groupId: true, parentId: true },
    });
    if (!parent || parent.groupId !== groupId) throw notFound("Parent channel not found");
    if (parent.parentId) throw badRequest("Channels can only be nested one level deep");
    if (selfId) {
      const children = await db.channel.count({ where: { parentId: selfId } });
      if (children) throw badRequest("A channel with sub-channels cannot be nested");
    }
  }
  const clash = await db.channel.findFirst({
    where: { groupId, parentId, name, ...(selfId ? { id: { not: selfId } } : {}) },
    select: { id: true },
  });
  if (clash) throw conflict(`#${name} already exists here`);
}

/** Creates a channel and its chat, with the group's ACTIVE members, in one transaction. */
export async function createChannel(
  groupId: string,
  input: { name: string; parentId: string | null; topic: string | null },
  actorId: string,
) {
  // #general must exist first, so a new group's channel list always starts with it
  await ensureGroupConversation(groupId);
  const name = normalizeChannelName(input.name);
  await checkChannelPlacement(groupId, name, input.parentId);
  return db.$transaction(async (tx) => {
    const last = await tx.channel.findFirst({
      where: { groupId, parentId: input.parentId },
      orderBy: { position: "desc" },
      select: { position: true },
    });
    const channel = await tx.channel.create({
      data: {
        groupId,
        name,
        parentId: input.parentId,
        topic: input.topic,
        position: (last?.position ?? 0) + 1,
        createdById: actorId,
      },
    });
    const conversation = await tx.conversation.create({
      data: { type: "CHANNEL", channelId: channel.id, title: `#${name}`, createdById: actorId },
      select: { id: true },
    });
    const members = await tx.groupMember.findMany({
      where: { groupId, status: "ACTIVE" },
      select: { userId: true },
    });
    if (members.length) {
      await tx.conversationMember.createMany({
        data: members.map((m) => ({ conversationId: conversation.id, userId: m.userId })),
        skipDuplicates: true,
      });
    }
    return { ...channel, conversationId: conversation.id };
  });
}

/** Keeps every chat of the group (group chat + channels) in sync with one group membership. */
export async function syncGroupConversationMember(
  groupId: string,
  userId: string,
  active: boolean,
) {
  const convos = await db.conversation.findMany({
    where: { OR: [{ groupId }, { channel: { groupId } }] },
    select: { id: true },
  });
  if (!convos.length) return;
  if (active) {
    await db.conversationMember.createMany({
      data: convos.map((c) => ({ conversationId: c.id, userId })),
      skipDuplicates: true,
    });
  } else {
    await db.conversationMember.deleteMany({
      where: { conversationId: { in: convos.map((c) => c.id) }, userId },
    });
  }
}
