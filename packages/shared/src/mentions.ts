/**
 * Mentions are stored inline in post/comment/message text as `@[Display Name](userId)`.
 * Shared by the composer (client), the renderer (client) and notifications (server).
 */

export const MENTION_RE = /@\[([^\]]{1,100})\]\(([A-Za-z0-9_-]{1,64})\)/g;

export function formatMention(name: string, userId: string) {
  return `@[${name.replace(/[[\]]/g, "")}](${userId})`;
}

export function extractMentionIds(text: string): string[] {
  return [
    ...new Set([...text.matchAll(MENTION_RE)].map((m) => m[2] as string)),
  ];
}

export type TextSegment =
  | { kind: "text"; text: string }
  | { kind: "mention"; name: string; userId: string }
  | { kind: "link"; url: string };

const URL_RE = /\bhttps?:\/\/[^\s<]+[^\s<.,:;"')\]!?]/g;

/** Splits text into plain text, mentions and links for rendering. */
export function parseText(text: string): TextSegment[] {
  const segments: TextSegment[] = [];
  const pushText = (chunk: string) => {
    let last = 0;
    for (const m of chunk.matchAll(URL_RE)) {
      if (m.index > last)
        segments.push({ kind: "text", text: chunk.slice(last, m.index) });
      segments.push({ kind: "link", url: m[0] });
      last = m.index + m[0].length;
    }
    if (last < chunk.length)
      segments.push({ kind: "text", text: chunk.slice(last) });
  };
  let last = 0;
  for (const m of text.matchAll(MENTION_RE)) {
    if (m.index > last) pushText(text.slice(last, m.index));
    segments.push({
      kind: "mention",
      name: m[1] as string,
      userId: m[2] as string,
    });
    last = m.index + m[0].length;
  }
  if (last < text.length) pushText(text.slice(last));
  return segments;
}

/** Plain-text preview (mentions become @Name). */
export function toPlainText(text: string) {
  return text.replace(MENTION_RE, (_, name: string) => `@${name}`);
}
