import { db } from "@/lib/db";
import { badRequest, invalidState, notFound } from "@/lib/errors";
import type { dbFor } from "@/server/session";

export type ThreadReplyInput = {
  content: string;
  alsoSentToChannel?: boolean;
  attachmentIds?: string[];
};

/**
 * Replies in a CHANNEL thread. Clients can't create thread replies through /api/execute: the
 * root must be a top-level message of a CHANNEL conversation the caller can read (threads are
 * one level deep), and the root's `replyCount` / `lastReplyAt` are server-maintained, so both
 * writes run in one transaction with the unscoped client after the checks below.
 */
export async function createThreadReply(
  userDb: ReturnType<typeof dbFor>,
  userId: string,
  conversationId: string,
  rootId: string,
  input: ThreadReplyInput,
) {
  const root = await userDb.message.findFirst({
    where: { id: rootId, conversationId },
    select: { threadId: true, conversation: { select: { type: true } } },
  });
  if (!root) throw notFound("Message not found");
  if (root.conversation.type !== "CHANNEL") {
    throw invalidState("Threads are only available in channels");
  }
  if (root.threadId) throw badRequest("Cannot reply to a thread reply");
  const content = input.content.trim();
  const attachmentIds = [...new Set(input.attachmentIds ?? [])];
  if (!content && attachmentIds.length === 0) throw badRequest("Reply is empty");

  // only the caller's own, still-unattached uploads
  const attachments = attachmentIds.length
    ? await userDb.attachment.findMany({
        where: {
          id: { in: attachmentIds },
          uploaderId: userId,
          messageId: null,
          postId: null,
          commentId: null,
          wikiPageId: null,
        },
        select: { id: true },
      })
    : [];
  if (attachments.length !== attachmentIds.length) throw badRequest("Invalid attachments");

  return db.$transaction(async (tx) => {
    const created = await tx.message.create({
      data: {
        conversationId,
        senderId: userId,
        threadId: rootId,
        content,
        alsoSentToChannel: input.alsoSentToChannel ?? false,
        attachments: { connect: attachments },
      },
      select: { id: true, createdAt: true },
    });
    await tx.message.update({
      where: { id: rootId },
      data: { replyCount: { increment: 1 }, lastReplyAt: created.createdAt },
      select: { id: true },
    });
    return { id: created.id };
  });
}
