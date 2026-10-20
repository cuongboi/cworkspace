import { Elysia, t } from "elysia";
import { badRequest, forbidden, notFound } from "@/lib/errors";
import { ensureGroupConversation } from "@/server/group-chat";
import { authMacro } from "../plugins/auth";

/** Deepest ancestor chain walked when checking a move for cycles. */
const MAX_WIKI_DEPTH = 50;

export const groupsRoute = new Elysia({ name: "routes.groups" })
  .use(authMacro)
  /**
   * POST /api/groups/:groupId/conversation → the group chat, created on first use with the group's
   * ACTIVE members (its membership is then kept in sync by the realtime plugin).
   */
  .post(
    "/api/groups/:groupId/conversation",
    async ({ params: { groupId }, user, userDb }) => {
      const group = await userDb.group.findUnique({
        where: { id: groupId },
        select: { members: { where: { userId: user.id, status: "ACTIVE" }, select: { id: true } } },
      });
      if (!group) throw notFound("Group not found");
      if (!group.members.length) throw forbidden("Only group members can use the group chat");
      const id = await ensureGroupConversation(groupId);
      if (!id) throw notFound("Group not found");
      return { data: { id } };
    },
    {
      auth: true,
      params: t.Object({ groupId: t.String({ minLength: 1 }) }),
      detail: { tags: ["Groups"], summary: "Find or create the group chat" },
    },
  )
  /**
   * POST /api/groups/:groupId/wiki/:pageId/move { parentId, position } → moves a Knowledge page
   * (and its subtree). Needs a cycle check and sibling re-numbering in one transaction, so it is not
   * a plain `/api/execute` update. Policies still decide who may edit the pages involved.
   */
  .post(
    "/api/groups/:groupId/wiki/:pageId/move",
    async ({ params: { groupId, pageId }, body: { parentId, position }, userDb }) => {
      await userDb.$transaction(async (tx) => {
        const page = await tx.wikiPage.findUnique({
          where: { id: pageId },
          select: { groupId: true },
        });
        if (!page || page.groupId !== groupId) throw notFound("Page not found");

        if (parentId) {
          let cursor: string | null = parentId;
          for (let depth = 0; cursor; depth++) {
            if (cursor === pageId) throw badRequest("A page cannot be moved under itself");
            if (depth > MAX_WIKI_DEPTH) throw badRequest("Pages are nested too deeply");
            const ancestor: { groupId: string; parentId: string | null } | null =
              await tx.wikiPage.findUnique({
                where: { id: cursor },
                select: { groupId: true, parentId: true },
              });
            if (!ancestor || ancestor.groupId !== groupId) throw notFound("Parent page not found");
            cursor = ancestor.parentId;
          }
        }

        const siblings = await tx.wikiPage.findMany({
          where: { groupId, parentId: parentId ?? null, id: { not: pageId } },
          orderBy: [{ position: "asc" }, { createdAt: "asc" }],
          select: { id: true, position: true },
        });
        const at = Math.max(0, Math.min(position, siblings.length));
        const ordered = [
          ...siblings.slice(0, at),
          { id: pageId, position: -1 },
          ...siblings.slice(at),
        ];
        for (const [index, row] of ordered.entries()) {
          if (row.id === pageId) {
            await tx.wikiPage.update({
              where: { id: pageId },
              data: { parentId: parentId ?? null, position: index },
            });
          } else if (row.position !== index) {
            await tx.wikiPage.update({ where: { id: row.id }, data: { position: index } });
          }
        }
      });
      return { data: { id: pageId } };
    },
    {
      auth: true,
      params: t.Object({
        groupId: t.String({ minLength: 1 }),
        pageId: t.String({ minLength: 1 }),
      }),
      body: t.Object({
        parentId: t.Union([t.String({ minLength: 1 }), t.Null()]),
        position: t.Integer({ minimum: 0 }),
      }),
      detail: { tags: ["Groups"], summary: "Move a Knowledge page" },
    },
  )
  /**
   * GET /api/groups/:groupId/wiki/search?q= → Knowledge pages whose title or content match, with a
   * short excerpt around the first hit. Runs through `userDb`, so hidden groups return nothing.
   */
  .get(
    "/api/groups/:groupId/wiki/search",
    async ({ params: { groupId }, query: { q }, userDb }) => {
      const term = q.trim();
      if (!term) return { data: [] };
      const pages = await userDb.wikiPage.findMany({
        where: {
          groupId,
          OR: [
            { title: { contains: term, mode: "insensitive" } },
            { content: { contains: term, mode: "insensitive" } },
          ],
        },
        orderBy: { updatedAt: "desc" },
        take: SEARCH_LIMIT,
        select: { id: true, title: true, content: true, parentId: true, updatedAt: true },
      });
      return {
        data: pages.map(({ content, ...page }) => ({ ...page, excerpt: excerpt(content, term) })),
      };
    },
    {
      auth: true,
      params: t.Object({ groupId: t.String({ minLength: 1 }) }),
      query: t.Object({ q: t.String({ maxLength: 200 }) }),
      detail: { tags: ["Groups"], summary: "Search a group's Knowledge pages" },
    },
  );

const SEARCH_LIMIT = 20;
const EXCERPT_RADIUS = 80;

/** Plain-text window around the first match (markdown markers stripped so it reads as prose). */
function excerpt(content: string, term: string) {
  const text = content
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[#>*_`~|-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const at = text.toLowerCase().indexOf(term.toLowerCase());
  if (at < 0) return text.slice(0, EXCERPT_RADIUS * 2);
  const start = Math.max(0, at - EXCERPT_RADIUS);
  const end = Math.min(text.length, at + term.length + EXCERPT_RADIUS);
  return `${start > 0 ? "…" : ""}${text.slice(start, end)}${end < text.length ? "…" : ""}`;
}
