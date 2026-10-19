import { db } from "@/lib/db";

/**
 * `db:push` doesn't emit full-text indexes for `@fullText` fields, so create them at boot.
 * The expression must match the query: the web app searches with `config: "simple"` (no
 * stemming, works for any language).
 */
export async function ensureSearchIndexes() {
  try {
    await db.$executeRaw`CREATE INDEX IF NOT EXISTS message_content_fts_idx ON "message" USING GIN (to_tsvector('simple', "content"))`;
    console.log("Search indexes ensured");
  } catch (err) {
    console.error("Could not create search indexes", err);
  }
}
