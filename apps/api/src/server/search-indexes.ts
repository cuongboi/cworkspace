import { db } from "@/lib/db";

/**
 * `db:push` doesn't emit full-text indexes for `@fullText` fields, so create them at boot.
 * The expression must match the query: the web app searches with `config: "simple"` (no
 * stemming, works for any language).
 */
export async function ensureSearchIndexes() {
  try {
    await db.$executeRaw`CREATE INDEX IF NOT EXISTS message_content_fts_idx ON "message" USING GIN (to_tsvector('simple', "content"))`;
    // group chats and group channels predate the CHANNEL type; idempotent backfill
    await db.$executeRaw`UPDATE "conversation" SET "type" = 'CHANNEL' WHERE "type" = 'GROUP' AND ("groupId" IS NOT NULL OR "channelId" IS NOT NULL)`;
    console.log("Search indexes ensured");
  } catch (err) {
    console.error("Could not create search indexes", err);
  }
}

if (import.meta.main) {
  await ensureSearchIndexes();
  process.exit(0);
}
