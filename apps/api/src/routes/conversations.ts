import { Elysia, t } from "elysia";
import { db } from "@/lib/db";
import { badRequest } from "@/lib/errors";
import { authMacro } from "../plugins/auth";

/**
 * POST /api/conversations/direct { organizationId, userId } → the 1:1 conversation between the
 * caller and `userId` in that org, created on first use (deduplicated by `directKey`).
 */
export const conversationsRoute = new Elysia({ name: "routes.conversations" }).use(authMacro).post(
  "/api/conversations/direct",
  async ({ body: { organizationId, userId }, user, userDb, set }) => {
    if (userId === user.id) throw badRequest("Cannot message yourself");
    const directKey = `${organizationId}:${[user.id, userId].sort().join(":")}`;
    const existing = await userDb.conversation.findUnique({
      where: { directKey },
      select: { id: true },
    });
    if (existing) return { data: existing };
    try {
      // policies check that both users belong to the organization
      const created = await userDb.conversation.create({
        data: {
          organizationId,
          type: "DIRECT",
          directKey,
          members: { create: [{ userId: user.id }, { userId }] },
        },
        select: { id: true },
      });
      set.status = 201;
      return { data: created };
    } catch (err) {
      // lost a race with the other user creating the same conversation
      const raced = await db.conversation.findUnique({
        where: { directKey },
        select: { id: true, members: { where: { userId: user.id }, select: { id: true } } },
      });
      if (raced?.members.length) return { data: { id: raced.id } };
      throw err;
    }
  },
  {
    auth: true,
    body: t.Object({
      organizationId: t.String({ minLength: 1 }),
      userId: t.String({ minLength: 1 }),
    }),
    detail: { tags: ["Chat"], summary: "Find or create a 1:1 conversation" },
  },
);
