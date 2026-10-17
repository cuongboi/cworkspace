import { Elysia, t } from "elysia";
import { notFound } from "@/lib/errors";
import { presignDownload } from "@/server/storage";
import { authMacro } from "../plugins/auth";

const INLINE =
  /^(image\/(png|jpe?g|gif|webp|avif)|video\/(mp4|webm)|audio\/\w+|application\/pdf)$/i;

/**
 * GET /api/files/:id[?download=1] → access check through the policy client, then a redirect to
 * a short-lived presigned URL. Use it directly as `<img src>` / `<a href>`.
 */
export const filesRoute = new Elysia({ name: "routes.files" }).use(authMacro).get(
  "/api/files/:id",
  async ({ params, query, userDb, set, redirect }) => {
    const file = await userDb.attachment.findUnique({
      where: { id: params.id },
      select: { key: true, name: true, mimeType: true },
    });
    if (!file) throw notFound("File not found");
    const inline = !query.download && INLINE.test(file.mimeType);
    const url = await presignDownload(file.key, file.name, inline);
    // private + short: the presigned URL expires in 5 minutes
    set.headers["cache-control"] = "private, max-age=240";
    return redirect(url, 302);
  },
  {
    auth: true,
    params: t.Object({ id: t.String({ minLength: 1, maxLength: 64 }) }),
    query: t.Object({ download: t.Optional(t.String()) }),
    detail: { tags: ["Files"], summary: "Redirect to a short-lived download URL" },
  },
);
