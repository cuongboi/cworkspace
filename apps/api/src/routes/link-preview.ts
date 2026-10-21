import { Elysia, t } from "elysia";
import { maxDocumentBytes } from "@app/shared/link-preview";
import { safeFetch } from "@/lib/safe-fetch";
import { badRequest, invalidState, notFound, tooManyRequests } from "@/lib/errors";
import { documentResponse } from "@/server/documents";
import { rateLimit } from "@/server/rate-limit";
import { documentUrl, getLinkPreview } from "@/server/link-preview";
import { authMacro } from "../plugins/auth";

/**
 * GET /api/link-preview?url=… → what to render for a URL in user text: inline media, a known
 * video embed, or an Open Graph card. The server fetches (SSRF-guarded) so viewers never hit
 * arbitrary sites just by reading a post. Unreachable pages answer `{ type: "link" }`, not an error.
 */
export const linkPreviewRoute = new Elysia({ name: "routes.link-preview" })
  .use(authMacro)
  .get(
    "/api/link-preview",
    async ({ query, user, set }) => {
      if (!rateLimit(`link-preview:${user.id}`, 60, 60_000)) throw tooManyRequests();
      set.headers["cache-control"] = "private, max-age=3600";
      return { data: await getLinkPreview(query.url) };
    },
    {
      auth: true,
      query: t.Object({ url: t.String({ minLength: 8, maxLength: 2048 }) }),
      detail: { tags: ["Link previews"], summary: "Preview metadata for a URL" },
    },
  )
  .get(
    "/api/link-preview/document",
    async ({ query, user }) => {
      if (!rateLimit(`link-preview:${user.id}`, 60, 60_000)) throw tooManyRequests();
      const doc = documentUrl(query.url);
      if (!doc) throw badRequest("This link can't be viewed");
      const max = maxDocumentBytes(doc.kind);
      const res = await safeFetch(doc.url, {
        maxBytes: max + 1,
        timeoutMs: doc.kind === "pdf" ? 15_000 : 5_000,
        // raw hosts serve these as text/plain, octet-stream, …; skip media and error pages
        readBody: (ct) =>
          !/^(image|video|audio)\//.test(ct) && (doc.kind === "html" || !ct.includes("html")),
      }).catch(() => null);
      if (!res || res.status >= 400 || !res.body.byteLength) throw notFound("Document not found");
      if (res.body.byteLength > max) throw invalidState("File is too large to view");
      return documentResponse(res.body, doc.kind);
    },
    {
      auth: true,
      query: t.Object({ url: t.String({ minLength: 8, maxLength: 2048 }) }),
      detail: { tags: ["Link previews"], summary: "Raw bytes of a linked viewable document" },
    },
  );
