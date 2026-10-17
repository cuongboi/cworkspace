import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { createPresignedPost } from "@aws-sdk/s3-presigned-post";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { env } from "@/env";

/**
 * Private S3-compatible bucket (AWS S3, Cloudflare R2, MinIO). Browsers upload directly with a
 * presigned POST and download through short-lived presigned GETs; the bucket is never public.
 */

export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

const bucket = env.S3_BUCKET;

export const storageConfigured = Boolean(
  env.S3_BUCKET && env.S3_ACCESS_KEY_ID && env.S3_SECRET_ACCESS_KEY,
);

const s3 = new S3Client({
  region: env.S3_REGION,
  endpoint: env.S3_ENDPOINT || undefined,
  // MinIO and most self-hosted S3s need path-style URLs
  forcePathStyle: Boolean(env.S3_ENDPOINT),
  credentials: {
    accessKeyId: env.S3_ACCESS_KEY_ID,
    secretAccessKey: env.S3_SECRET_ACCESS_KEY,
  },
});

export function presignUpload(key: string, mimeType: string, size: number) {
  return createPresignedPost(s3, {
    Bucket: bucket,
    Key: key,
    // the signed policy pins the exact key, type and size the API validated
    Conditions: [
      ["content-length-range", size, size],
      ["eq", "$Content-Type", mimeType],
    ],
    Fields: { "Content-Type": mimeType },
    Expires: 300,
  });
}

export function presignDownload(key: string, fileName: string, inline: boolean) {
  const disposition = `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(fileName)}`;
  return getSignedUrl(
    s3,
    new GetObjectCommand({
      Bucket: bucket,
      Key: key,
      ResponseContentDisposition: disposition,
    }),
    { expiresIn: 300 },
  );
}
