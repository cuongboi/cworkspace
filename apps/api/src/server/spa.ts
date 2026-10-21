import path from "node:path";
import { buildManifest, HEAD_PLACEHOLDER, renderHead } from "@app/shared/app-config";
import { appConfig, env } from "@/env";

/**
 * The SPA shell with this instance's branding rendered in at runtime (title, Open Graph,
 * `window.__APP_CONFIG__`), so one web build serves any company: change `.env`, restart, done.
 */
type Page = { html: string; etag: string };

let template: Promise<string | null> | undefined;
/** Keyed by origin; a single entry when APP_URL is set (bounded: Host is client-controlled). */
const pages = new Map<string, Page>();

/** The browser-facing origin, only needed when APP_URL isn't a URL (e.g. `WEB_ORIGIN=*`). */
function requestOrigin(request: Request) {
  if (appConfig.url) return "";
  const url = new URL(request.url);
  if (env.TRUST_PROXY) {
    const proto = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
    const host = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
    if (proto) url.protocol = proto;
    if (host) url.host = host;
  }
  return url.origin;
}

function render(tpl: string, origin: string): Page {
  const head = renderHead(appConfig, origin || undefined);
  // builds from before the placeholder existed still get the tags
  const html = tpl.includes(HEAD_PLACEHOLDER)
    ? tpl.replace(HEAD_PLACEHOLDER, head)
    : tpl.replace(/<title>.*?<\/title>/s, "").replace("</head>", `    ${head}\n  </head>`);
  return { html, etag: `"${Bun.hash(html).toString(36)}"` };
}

export async function serveIndex(
  assetPath: string,
  {
    request,
    set,
  }: {
    request: Request;
    set: { status?: number | string; headers: Record<string, string | number> };
  },
) {
  template ??= Bun.file(path.join(assetPath, "index.html"))
    .text()
    .catch(() => null);
  const tpl = await template;
  if (!tpl) return;
  const origin = requestOrigin(request);
  let page = pages.get(origin);
  if (!page) {
    page = render(tpl, origin);
    if (pages.size >= 32) pages.clear();
    pages.set(origin, page);
  }
  // revalidate every load (the shell names the hashed assets); 304 keeps it cheap
  set.headers["cache-control"] = "no-cache";
  set.headers.etag = page.etag;
  if (request.headers.get("if-none-match") === page.etag) {
    set.status = 304;
    return "";
  }
  set.headers["content-type"] = "text/html; charset=utf-8";
  return page.html;
}

const manifest = JSON.stringify(buildManifest(appConfig));

export function serveManifest({ set }: { set: { headers: Record<string, string | number> } }) {
  set.headers["content-type"] = "application/manifest+json";
  set.headers["cache-control"] = "public, max-age=3600";
  return manifest;
}
