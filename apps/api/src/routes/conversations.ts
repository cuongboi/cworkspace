import { Elysia, t } from "elysia";
import { db } from "@/lib/db";
import { badRequest, invalidState, notFound } from "@/lib/errors";
import { createThreadReply } from "@/server/threads";
import { authMacro } from "../plugins/auth";

/**
 * POST /api/conversations/direct { userId } → the 1:1 conversation between the caller and
 * `userId`, created on first use (deduplicated by `directKey`).
 */
export const conversationsRoute = new Elysia({ name: "routes.conversations" })
  .use(authMacro)
  .post(
    "/api/conversations/direct",
    async ({ body: { userId }, user, set }) => {
      if (userId === user.id) throw badRequest("Cannot message yourself");
      // DIRECT conversations are denied to the policy client (anyone could pre-claim a directKey):
      // the key, members and creator are derived here and written with the trusted client
      const target = await db.user.findUnique({
        where: { id: userId },
        select: { id: true, banned: true },
      });
      if (!target || target.banned) throw notFound("User not found");
      const directKey = [user.id, userId].sort().join(":");
      const find = () =>
        db.conversation.findUnique({
          where: { directKey },
          select: { id: true, type: true, members: { select: { userId: true } } },
        });
      const owned = (c: NonNullable<Awaited<ReturnType<typeof find>>>) => {
        const ids = new Set(c.members.map((m) => m.userId));
        if (c.type !== "DIRECT" || !ids.has(user.id))
          throw invalidState("Conversation unavailable");
        return { data: { id: c.id } };
      };
      const existing = await find();
      if (existing) return owned(existing);
      try {
        const created = await db.conversation.create({
          data: {
            type: "DIRECT",
            directKey,
            createdById: user.id,
            members: { create: [{ userId: user.id }, { userId }] },
          },
          select: { id: true },
        });
        set.status = 201;
        return { data: created };
      } catch (err) {
        // lost a race with the other user creating the same conversation (unique directKey)
        const raced = await find();
        if (raced) return owned(raced);
        throw err;
      }
    },
    {
      auth: true,
      body: t.Object({
        userId: t.String({ minLength: 1 }),
      }),
      detail: { tags: ["Chat"], summary: "Find or create a 1:1 conversation" },
    },
  )
  /** Reply in a CHANNEL thread (see `createThreadReply`). */
  .post(
    "/api/conversations/:id/threads/:rootId/replies",
    async ({ params, body, user, userDb, set }) => {
      const reply = await createThreadReply(userDb, user.id, params.id, params.rootId, body);
      set.status = 201;
      return { data: reply };
    },
    {
      auth: true,
      params: t.Object({ id: t.String(), rootId: t.String() }),
      body: t.Object({
        content: t.String({ maxLength: 20000 }),
        alsoSentToChannel: t.Optional(t.Boolean()),
        attachmentIds: t.Optional(t.Array(t.String(), { maxItems: 20 })),
      }),
      detail: { tags: ["Chat"], summary: "Reply in a channel thread" },
    },
  );
