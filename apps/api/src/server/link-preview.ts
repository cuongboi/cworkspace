import {
  type DocumentKind,
  documentKind,
  type LinkPreview,
  matchEmbed,
} from "@app/shared/link-preview";
import { safeFetch } from "../lib/safe-fetch";

const OK_TTL = 24 * 60 * 60_000;
const FAIL_TTL = 10 * 60_000;
const MAX_ENTRIES = 5_000;

/** LRU by insertion order (re-inserted on hit). Per process, like the rest of the realtime state. */
const cache = new Map<string, { value: LinkPreview; expires: number }>();
/** One upstream fetch per URL, however many viewers ask at once. */
const inflight = new Map<string, Promise<LinkPreview>>();

const TRACKING = /^(utm_\w+|fbclid|gclid|mc_eid|igshid)$/i;

/** Cache key: no fragment, no tracking params. */
export function normalizeUrl(raw: string): string | null {
  try {
    const u = new URL(raw);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    u.hash = "";
    // copy: deleting while iterating the live params skips entries
    for (const k of Array.from(u.searchParams.keys()))
      if (TRACKING.test(k)) u.searchParams.delete(k);
    return u.toString();
  } catch {
    return null;
  }
}

export async function getLinkPreview(raw: string): Promise<LinkPreview> {
  const key = normalizeUrl(raw);
  if (!key) return { type: "link", url: raw };
  const embed = matchEmbed(raw);
  if (embed) return embed;

  const hit = cache.get(key);
  if (hit && hit.expires > Date.now()) {
    cache.delete(key);
    cache.set(key, hit);
    return { ...hit.value, url: raw };
  }
  let pending = inflight.get(key);
  if (!pending) {
    pending = resolve(key)
      .catch((): LinkPreview => ({ type: "link", url: key }))
      .then((value) => {
        cache.set(key, {
          value,
          expires: Date.now() + (value.type === "link" ? FAIL_TTL : OK_TTL),
        });
        if (cache.size > MAX_ENTRIES) cache.delete(cache.keys().next().value!);
        return value;
      })
      .finally(() => inflight.delete(key));
    inflight.set(key, pending);
  }
  return { ...(await pending), url: raw };
}

const isHtml = (type: string) => type.includes("text/html") || type.includes("application/xhtml");

async function resolve(url: string): Promise<LinkPreview> {
  const res = await safeFetch(url, { readBody: isHtml });
  if (res.status >= 400) return { type: "link", url };
  const mime = res.contentType.split(";")[0]!.trim();
  const media = /^(image|video|audio)\//.exec(mime)?.[1] as "image" | "video" | "audio" | undefined;
  if (media) return { type: media, url, mimeType: mime };
  // a redirect may land on a provider page (short links)
  const embed = matchEmbed(res.url.toString());
  if (embed) return { ...embed, url };
  if (!isHtml(res.contentType) || !res.body.byteLength) return { type: "link", url };
  const meta = await parseHtmlMeta(decode(res.body, res.contentType), res.url);
  return meta ? { ...meta, url } : { type: "link", url };
}

/** Header charset, then `<meta charset>` sniffed from the first bytes, then UTF-8. */
function decode(body: Uint8Array, contentType: string) {
  const head = new TextDecoder("latin1").decode(body.subarray(0, 2048));
  const label =
    /charset=["']?([\w-]+)/i.exec(contentType)?.[1] ??
    /<meta[^>]+charset=["']?([\w-]+)/i.exec(head)?.[1] ??
    "utf-8";
  try {
    return new TextDecoder(label as Bun.Encoding).decode(body);
  } catch {
    return new TextDecoder().decode(body);
  }
}

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

/** lol-html hands back raw attribute/text values, so entities are decoded here. */
export function decodeEntities(s: string) {
  return s.replace(/&(#x[\da-f]+|#\d+|\w+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const code = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : Number(e.slice(1));
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

const clean = (s: string | undefined, max: number) => {
  const v = s && decodeEntities(s).replace(/\s+/g, " ").trim();
  return v ? (v.length > max ? `${v.slice(0, max - 1)}…` : v) : undefined;
};

/** Absolute http(s) URL resolved against the page, or undefined. */
const absolute = (value: string | undefined, base: URL) => {
  if (!value) return undefined;
  try {
    const u = new URL(decodeEntities(value.trim()), base);
    return u.protocol === "http:" || u.protocol === "https:" ? u.toString() : undefined;
  } catch {
    return undefined;
  }
};

/** Open Graph / Twitter card / plain HTML metadata; null when the page has no usable title. */
export async function parseHtmlMeta(
  html: string,
  base: URL,
): Promise<Omit<Extract<LinkPreview, { type: "page" }>, "url"> | null> {
  const meta: Record<string, string> = {};
  let title = "";
  let inHead = true;
  let favicon: string | undefined;

  const rewriter = new HTMLRewriter()
    .on("meta", {
      element(el) {
        if (!inHead) return;
        const key = (el.getAttribute("property") ?? el.getAttribute("name") ?? "").toLowerCase();
        const content = el.getAttribute("content");
        // first value wins (og:image may repeat)
        if (key && content && !(key in meta)) meta[key] = content;
      },
    })
    .on("title", {
      text(chunk) {
        if (inHead) title += chunk.text;
      },
    })
    .on("link", {
      element(el) {
        const rel = (el.getAttribute("rel") ?? "").toLowerCase().split(/\s+/);
        const href = el.getAttribute("href");
        if (href && !favicon && (rel.includes("icon") || rel.includes("apple-touch-icon")))
          favicon = href;
      },
    })
    .on("body", {
      element() {
        inHead = false;
      },
    });
  await rewriter.transform(new Response(html)).text();

  const resolvedTitle = clean(meta["og:title"] ?? meta["twitter:title"] ?? title, 200);
  if (!resolvedTitle) return null;
  const image = absolute(
    meta["og:image:secure_url"] ??
      meta["og:image"] ??
      meta["og:image:url"] ??
      meta["twitter:image"] ??
      meta["twitter:image:src"],
    base,
  );
  return {
    type: "page",
    title: resolvedTitle,
    description: clean(
      meta["og:description"] ?? meta["twitter:description"] ?? meta.description,
      400,
    ),
    image,
    imageLayout: meta["twitter:card"] === "summary" ? "thumb" : "banner",
    siteName: clean(meta["og:site_name"] ?? meta["application-name"], 80),
    favicon: absolute(favicon ?? "/favicon.ico", base),
    themeColor: /^#[\da-f]{3,8}$/i.test(meta["theme-color"] ?? "")
      ? meta["theme-color"]
      : undefined,
  };
}

/** An http(s) URL whose path names a file the document viewer can render, or `null`. */
export function documentUrl(raw: string): { url: string; kind: DocumentKind } | null {
  try {
    const url = new URL(raw);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    const kind = documentKind(url.pathname);
    return kind ? { url: url.href, kind } : null;
  } catch {
    return null;
  }
}
