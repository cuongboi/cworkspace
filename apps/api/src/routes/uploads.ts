import { createId } from "@paralleldrive/cuid2";
import { Elysia, t } from "elysia";
import { badRequest, tooManyRequests, upstreamError } from "@/lib/errors";
import { rateLimit } from "@/server/rate-limit";
import { MAX_UPLOAD_BYTES, presignUpload, storageConfigured } from "@/server/storage";
import { authMacro } from "../plugins/auth";

// executable/markup types are never stored: they could be served back from our origin
const BLOCKED =
  /^(text\/html|application\/(x-)?(javascript|ecmascript)|image\/svg\+xml|application\/xhtml\+xml)$/i;

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
    if (BLOCKED.test(body.mimeType)) throw badRequest("This file type is not allowed");
    if (body.orgVisible && !body.mimeType.startsWith("image/"))
      throw badRequest("Only images can be shared organization-wide");

    const id = createId();
    const safeName = body.name.replace(/[^\w.\- ]+/g, "_").slice(-120) || "file";
    // the policy client enforces that the uploader belongs to the organization
    const attachment = await userDb.attachment.create({
      data: {
        id,
        ...body,
        key: `org/${body.organizationId}/${id}/${safeName}`,
        uploaderId: user.id,
      },
    });
    const upload = await presignUpload(attachment.key, attachment.mimeType, attachment.size);
    set.status = 201;
    return { data: { attachment, upload } };
  },
  {
    auth: true,
    body: t.Object({
      organizationId: t.String({ minLength: 1 }),
      name: t.String({ minLength: 1, maxLength: 255 }),
      mimeType: t.String({ minLength: 1, maxLength: 127, pattern: "^[\\w.+-]+/[\\w.+-]+$" }),
      size: t.Integer({ minimum: 1, maximum: MAX_UPLOAD_BYTES }),
      width: t.Optional(t.Integer({ minimum: 1 })),
      height: t.Optional(t.Integer({ minimum: 1 })),
      // avatars and group covers; images only
      orgVisible: t.Optional(t.Boolean()),
    }),
    detail: { tags: ["Files"], summary: "Create an attachment and a presigned upload" },
  },
);
