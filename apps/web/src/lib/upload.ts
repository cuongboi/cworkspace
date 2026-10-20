import { ApiError } from "./api-client"

/**
 * Client-side upload: POST /api/uploads (creates the Attachment + presigned POST), then the
 * browser sends the bytes straight to the bucket. Large images are downscaled first.
 * Link the result by connecting it: `attachments: { connect: [{ id }] }`.
 */

export type UploadedAttachment = {
  id: string
  name: string
  mimeType: string
  size: number
  width: number | null
  height: number | null
}

export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024
const MAX_IMAGE_EDGE = 2048
const RESIZABLE = /^image\/(jpeg|png|webp)$/

/** URL that streams an attachment after an access check (works as <img src> / <a href>). */
export function fileUrl(id: string, opts?: { download?: boolean }) {
  return `/api/files/${id}${opts?.download ? "?download=1" : ""}`
}

async function readImage(file: File) {
  const bitmap = await createImageBitmap(file)
  return { bitmap, width: bitmap.width, height: bitmap.height }
}

async function prepare(
  file: File
): Promise<{ blob: Blob; width?: number; height?: number }> {
  if (!file.type.startsWith("image/")) return { blob: file }
  try {
    const { bitmap, width, height } = await readImage(file)
    const scale = Math.min(1, MAX_IMAGE_EDGE / Math.max(width, height))
    if (scale === 1 || !RESIZABLE.test(file.type)) {
      bitmap.close()
      return { blob: file, width, height }
    }
    const w = Math.round(width * scale)
    const h = Math.round(height * scale)
    const canvas = new OffscreenCanvas(w, h)
    canvas.getContext("2d")?.drawImage(bitmap, 0, 0, w, h)
    bitmap.close()
    const blob = await canvas.convertToBlob({
      type: file.type === "image/png" ? "image/png" : "image/jpeg",
      quality: 0.85,
    })
    return { blob, width: w, height: h }
  } catch {
    return { blob: file }
  }
}

export async function uploadFile(
  file: File,
  /**
   * `isPublic`: avatars and group covers, readable by every signed-in user (images only).
   * `wikiPageId`: embedded in a Knowledge page, readable by whoever can read the page.
   */
  opts?: { isPublic?: boolean; wikiPageId?: string }
): Promise<UploadedAttachment> {
  const { blob, width, height } = await prepare(file)
  if (blob.size > MAX_UPLOAD_BYTES)
    throw new ApiError(400, "INVALID_INPUT", "Files must be 25 MB or smaller")
  const mimeType = blob.type || "application/octet-stream"

  const res = await fetch("/api/uploads", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: file.name,
      mimeType,
      size: blob.size,
      width,
      height,
      ...opts,
    }),
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) {
    throw new ApiError(
      res.status,
      body.error?.code ?? "INTERNAL",
      body.error?.message ?? "Upload failed"
    )
  }
  const { attachment, upload } = body.data as {
    attachment: UploadedAttachment
    upload: { url: string; fields: Record<string, string> }
  }

  const form = new FormData()
  for (const [k, v] of Object.entries(upload.fields)) form.append(k, v)
  form.append("file", blob, file.name)
  const put = await fetch(upload.url, { method: "POST", body: form })
  if (!put.ok)
    throw new ApiError(put.status, "UPSTREAM_ERROR", "Upload to storage failed")
  return attachment
}
