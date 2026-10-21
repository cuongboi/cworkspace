/**
 * Link previews: the `/api/link-preview` contract, shared by the server (fetch + parse) and the
 * web renderer.
 */
import { parseText } from "./mentions";

export type LinkPreview =
  | { type: "image" | "video" | "audio"; url: string; mimeType?: string }
  | {
      type: "embed";
      url: string;
      provider: "youtube" | "vimeo" | "loom";
      embedUrl: string;
      thumbnail?: string;
      title?: string;
    }
  | {
      type: "page";
      url: string;
      title: string;
      description?: string;
      image?: string;
      /** `summary` = small square thumbnail; otherwise a wide banner. */
      imageLayout: "banner" | "thumb";
      siteName?: string;
      favicon?: string;
      themeColor?: string;
    }
  /** Nothing worth previewing (dead link, non-HTML file, blocked host…). */
  | { type: "link"; url: string };

/** The first `max` distinct URLs in user text (mentions are skipped). */
export function extractLinks(text: string, max = 3): string[] {
  const urls = new Set<string>();
  for (const seg of parseText(text)) {
    if (seg.kind !== "link") continue;
    urls.add(seg.url);
    if (urls.size >= max) break;
  }
  return [...urls];
}

const YOUTUBE_HOSTS = new Set([
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
  "music.youtube.com",
]);

/** `t=1m30s` / `t=90` → seconds. */
function startSeconds(t: string | null): number {
  if (!t) return 0;
  if (/^\d+$/.test(t)) return Number(t);
  const m = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/.exec(t);
  return m ? Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0) : 0;
}

/**
 * Known video providers, matched from the URL alone (no network). The iframe URL is built here
 * from a validated id, never taken from the page, so only these origins are ever embedded.
 */
export function matchEmbed(raw: string): Extract<LinkPreview, { type: "embed" }> | null {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  const host = u.hostname.toLowerCase();
  let id: string | null = null;
  if (YOUTUBE_HOSTS.has(host)) {
    id =
      u.pathname === "/watch"
        ? u.searchParams.get("v")
        : (/^\/(?:shorts|embed|live)\/([^/]+)/.exec(u.pathname)?.[1] ?? null);
  } else if (host === "youtu.be") {
    id = u.pathname.slice(1).split("/")[0] ?? null;
  }
  if (id && /^[\w-]{11}$/.test(id)) {
    const start = startSeconds(u.searchParams.get("t") ?? u.searchParams.get("start"));
    return {
      type: "embed",
      url: raw,
      provider: "youtube",
      embedUrl: `https://www.youtube-nocookie.com/embed/${id}?autoplay=1${start ? `&start=${start}` : ""}`,
      thumbnail: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
    };
  }
  if (host === "vimeo.com" || host === "www.vimeo.com") {
    const vid = /^\/(\d{4,12})(?:\/([\da-f]+))?\/?$/.exec(u.pathname);
    if (vid) {
      const hash = vid[2] ? `&h=${vid[2]}` : "";
      return {
        type: "embed",
        url: raw,
        provider: "vimeo",
        embedUrl: `https://player.vimeo.com/video/${vid[1]}?autoplay=1${hash}`,
      };
    }
  }
  if (host === "www.loom.com" || host === "loom.com") {
    const lid = /^\/(?:share|embed)\/([\da-f]{32})/.exec(u.pathname)?.[1];
    if (lid)
      return {
        type: "embed",
        url: raw,
        provider: "loom",
        embedUrl: `https://www.loom.com/embed/${lid}?autoplay=1`,
        thumbnail: `https://cdn.loom.com/sessions/thumbnails/${lid}-with-play.gif`,
      };
  }
  return null;
}

const MEDIA_EXT: Record<string, "image" | "video" | "audio"> = {
  png: "image",
  jpg: "image",
  jpeg: "image",
  gif: "image",
  webp: "image",
  avif: "image",
  svg: "image",
  mp4: "video",
  webm: "video",
  mov: "video",
  m4v: "video",
  ogv: "video",
  mp3: "audio",
  ogg: "audio",
  oga: "audio",
  wav: "audio",
  m4a: "audio",
  flac: "audio",
};

/** Media type guessed from the path extension: lets the client render before the server answers. */
export function mediaTypeFromUrl(raw: string): "image" | "video" | "audio" | null {
  try {
    const ext = /\.([a-z\d]{2,5})$/i.exec(new URL(raw).pathname)?.[1]?.toLowerCase();
    return (ext && MEDIA_EXT[ext]) || null;
  } catch {
    return null;
  }
}

/** Files the in-app document viewer can render. */
export type DocumentKind = "markdown" | "html" | "csv" | "pdf" | "text";

const TEXT_EXTENSIONS = new Set(
  (
    "txt log json xml yaml yml toml ini env sql sh ts tsx js jsx mjs py go rs java kt rb php " +
    "c h cpp cs swift css scss graphql diff patch"
  ).split(" "),
);

/** File extension (lower case, no dot) of a name or URL path. */
export function fileExtension(nameOrPath: string): string {
  return /\.([a-z0-9]{1,10})$/i.exec(nameOrPath)?.[1]?.toLowerCase() ?? "";
}

/** What the document viewer should do with a file, by name or URL path; `null` = can't view. */
export function documentKind(nameOrPath: string): DocumentKind | null {
  const ext = fileExtension(nameOrPath);
  if (ext === "md" || ext === "markdown") return "markdown";
  if (ext === "html" || ext === "htm") return "html";
  if (ext === "csv" || ext === "tsv") return "csv";
  if (ext === "pdf") return "pdf";
  return TEXT_EXTENSIONS.has(ext) ? "text" : null;
}

/** Largest document the viewer loads; PDFs render page by page so they may be bigger. */
export function maxDocumentBytes(kind: DocumentKind): number {
  return kind === "pdf" ? 25 * 1024 * 1024 : 2 * 1024 * 1024;
}

export const DOCUMENT_CONTENT_TYPES: Record<DocumentKind, string> = {
  markdown: "text/markdown; charset=utf-8",
  html: "text/plain; charset=utf-8",
  csv: "text/plain; charset=utf-8",
  pdf: "application/pdf",
  text: "text/plain; charset=utf-8",
};
