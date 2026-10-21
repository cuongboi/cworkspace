import { createHash } from "node:crypto";
import path from "node:path";
import { buildManifest, renderShell } from "@app/shared/app-config";
import { env } from "@/env";
import { onboardingRequired } from "@/server/onboarding";
import { getSettings, onSettingsChange } from "@/server/settings";

/**
 * The SPA shell with this instance's settings rendered in at runtime (`renderShell`: title,
 * Open Graph, theme `<style>`, `<html lang>`, icons, theme-color, default theme before first
 * paint, `window.__APP_CONFIG__`), so one web build serves any company. Settings come from the
 * admin over `.env`; a change clears the rendered pages.
 */
type Page = { html: string; etag: string; csp: string };

let template: Promise<string | null> | undefined;
/** Keyed by origin; a single entry when APP_URL is set (bounded: Host is client-controlled). */
const pages = new Map<string, Page>();
let manifest = "";

onSettingsChange(({ app }) => {
  pages.clear();
  manifest = JSON.stringify(buildManifest(app));
});

/** The browser-facing origin, only needed when APP_URL isn't a URL (forwarded headers only behind TRUST_PROXY). */
function requestOrigin(request: Request) {
  if (getSettings().app.url) return "";
  const url = new URL(request.url);
  if (env.TRUST_PROXY) {
    const proto = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
    const host = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
    if (proto) url.protocol = proto;
    if (host) url.host = host;
  }
  return url.origin;
}

/** What the shell exposes as `window.__APP_CONFIG__` (also served by `/api/settings/public`). */
export const publicAppConfig = () => ({
  ...getSettings().app,
  ...(onboardingRequired() ? { onboarding: true } : {}),
});

/**
 * Scripts are limited to our own files plus the shell's inline ones (theme boot,
 * `window.__APP_CONFIG__`), allowed by hash so an HTML injection can't add more. Other
 * directives stay open: media and API calls reach S3 presigned URLs, Firebase and OAuth hosts.
 */
function contentSecurityPolicy(html: string) {
  const hashes = [...html.matchAll(/<script(?![^>]*\ssrc=)[^>]*>([\s\S]*?)<\/script>/g)].map(
    (m) => `'sha256-${createHash("sha256").update(m[1]!).digest("base64")}'`,
  );
  return [
    `script-src 'self' ${hashes.join(" ")}`.trim(),
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "object-src 'none'",
  ].join("; ");
}

function render(tpl: string, origin: string): Page {
  const html = renderShell(tpl, publicAppConfig(), origin || undefined);
  return { html, etag: `"${Bun.hash(html).toString(36)}"`, csp: contentSecurityPolicy(html) };
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
  // the onboarding flag flips once the first account exists
  const key = `${onboardingRequired() ? "setup:" : ""}${origin}`;
  let page = pages.get(key);
  if (!page) {
    page = render(tpl, origin);
    if (pages.size >= 32) pages.clear();
    pages.set(key, page);
  }
  // revalidate every load (the shell names the hashed assets); 304 keeps it cheap
  set.headers["cache-control"] = "no-cache";
  set.headers.etag = page.etag;
  set.headers["content-security-policy"] = page.csp;
  if (request.headers.get("if-none-match") === page.etag) {
    set.status = 304;
    return "";
  }
  set.headers["content-type"] = "text/html; charset=utf-8";
  return page.html;
}

export function serveManifest({ set }: { set: { headers: Record<string, string | number> } }) {
  set.headers["content-type"] = "application/manifest+json";
  // short: an admin may change the name or icon
  set.headers["cache-control"] = "public, max-age=300";
  return manifest;
}
