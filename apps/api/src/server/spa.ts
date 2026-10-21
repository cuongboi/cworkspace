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
type Page = { html: string; etag: string };

let template: Promise<string | null> | undefined;
/** Keyed by origin; a single entry when APP_URL is set (bounded: Host is client-controlled). */
const pages = new Map<string, Page>();
let manifest = "";

onSettingsChange(({ app }) => {
  pages.clear();
  manifest = JSON.stringify(buildManifest(app));
});

/** The browser-facing origin, only needed when APP_URL isn't a URL (e.g. `WEB_ORIGIN=*`). */
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

function render(tpl: string, origin: string): Page {
  const html = renderShell(tpl, publicAppConfig(), origin || undefined);
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
