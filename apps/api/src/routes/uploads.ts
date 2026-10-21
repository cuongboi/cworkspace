import { createId } from "@paralleldrive/cuid2";
import { Elysia, t } from "elysia";
import { db } from "@/lib/db";
import { badRequest, tooManyRequests, upstreamError } from "@/lib/errors";
import { rateLimit } from "@/server/rate-limit";
import { MAX_UPLOAD_BYTES, presignUpload, storageConfigured } from "@/server/storage";
import { authMacro } from "../plugins/auth";

// executable/markup types are stored as plain text: served back with their real type they
// could run script on the bucket/our origin; as text/plain the browser only shows the source
// (XML types included: XSLT/XHTML/SVG documents can run script; so can Flash)
const UNSAFE =
  /^(text\/html|text\/javascript|application\/(x-)?(javascript|ecmascript)|(text|application)\/([\w.+-]+\+)?xml|image\/svg\+xml|text\/xsl|application\/(x-shockwave-flash|vnd\.adobe\.flash\.movie))$/i;

/**
 * POST /api/uploads → creates the Attachment row and returns a presigned POST for the browser
 * to upload the bytes straight to the bucket. Attach it afterwards by connecting it, e.g.
 * `db.post.create({ data: { …, attachments: { connect: [{ id }] } } })`.
 */
export const uploadsRoute = new Elysia({ name: "routes.uploads" }).use(authMacro).post(
  "/api/uploads",
  async ({ body, user, userDb, set }) => {
    if (!storageConfigured) throw upstreamError("File storage is not configured");
    if (!rateLimit(`upload:${user.id}`, 30, 60_000)) throw tooManyRequests("Too many uploads");
    if (UNSAFE.test(body.mimeType)) body.mimeType = "text/plain";
    if (body.isPublic && !body.mimeType.startsWith("image/"))
      throw badRequest("Only images can be shared publicly");

    const id = createId();
    const safeName = body.name.replace(/[^\w.\- ]+/g, "_").slice(-120) || "file";
    // Attachment create is denied by policy (it would skip the checks above): create it with the
    // trusted client, then link the wiki page through the policy client so its edit-rights rule applies
    const { wikiPageId, ...fields } = body;
    let attachment = await db.attachment.create({
      data: { id, ...fields, key: `files/${id}/${safeName}`, uploaderId: user.id },
    });
    if (wikiPageId) {
      try {
        attachment = await userDb.attachment.update({ where: { id }, data: { wikiPageId } });
      } catch (err) {
        await db.attachment.delete({ where: { id } }).catch(() => {});
        throw err;
      }
    }
    const upload = await presignUpload(attachment.key, attachment.mimeType, attachment.size);
    set.status = 201;
    return { data: { attachment, upload } };
  },
  {
    auth: true,
    body: t.Object({
      name: t.String({ minLength: 1, maxLength: 255 }),
      mimeType: t.String({ minLength: 1, maxLength: 127, pattern: "^[\\w.+-]+/[\\w.+-]+$" }),
      size: t.Integer({ minimum: 1, maximum: MAX_UPLOAD_BYTES }),
      width: t.Optional(t.Integer({ minimum: 1 })),
      height: t.Optional(t.Integer({ minimum: 1 })),
      // avatars and group covers; images only
      isPublic: t.Optional(t.Boolean()),
      // a Knowledge page the file is embedded in (the policy requires edit rights on it)
      wikiPageId: t.Optional(t.String({ minLength: 1, maxLength: 64 })),
    }),
    detail: { tags: ["Files"], summary: "Create an attachment and a presigned upload" },
  },
);
