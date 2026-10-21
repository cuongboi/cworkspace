/**
 * Instance branding, configured at deploy time in the root `.env`:
 *   APP_NAME="Acme Workplace"
 *   APP_INFO='{"shortName":"Acme","description":"…","themeColor":"#09090b","ogImage":"/og.png"}'
 * Rendered into index.html (title, Open Graph, `window.__APP_CONFIG__`) and the PWA manifest at
 * runtime by the API, and by the Vite plugin in dev, so one build serves any company.
 * Admins override any of it at runtime (Settings → General / Theme); `.env` stays the default.
 */

export const SOCIAL_PROVIDERS = ["google", "github", "line"] as const;
export type SocialProvider = (typeof SOCIAL_PROVIDERS)[number];

export type AppConfig = {
  name: string;
  shortName: string;
  description: string;
  themeColor: string;
  backgroundColor: string;
  /** Share image (1200×630 recommended): absolute URL, or a path resolved against the origin. */
  ogImage?: string;
  /** Open Graph locale, e.g. `en_US`. */
  locale: string;
  /** Twitter/X handle, e.g. `@acme`. */
  twitterSite?: string;
  /** App icon (square PNG, 512×512 recommended): replaces the bundled icons when set. */
  icon?: string;
  /** Social sign-in buttons on the login page (configured by an admin). */
  socialProviders: SocialProvider[];
  /** The instance has no user yet: the SPA sends everyone to `/onboarding`. */
  onboarding?: boolean;
  /** Public origin (`APP_URL`); empty when it isn't an absolute URL (e.g. `WEB_ORIGIN=*`). */
  url: string;
};

export const DEFAULT_APP_CONFIG: AppConfig = {
  name: "CC Workplace",
  shortName: "Workplace",
  description: "Groups, feed, chat, calls and calendar for your company.",
  themeColor: "#09090b",
  backgroundColor: "#09090b",
  locale: "en_US",
  socialProviders: [],
  url: "",
};

/** The placeholder in index.html that `renderHead` replaces. */
export const HEAD_PLACEHOLDER = "<!--app-head-->";

const HEX = /^#(?:[\da-f]{3}|[\da-f]{6}|[\da-f]{8})$/i;

function str(info: Record<string, unknown>, key: string, max: number): string | undefined {
  const v = info[key];
  if (v === undefined || v === null || v === "") return undefined;
  if (typeof v !== "string") throw new Error(`APP_INFO.${key} must be a string`);
  const s = v.trim();
  if (s.length > max) throw new Error(`APP_INFO.${key} is longer than ${max} characters`);
  return s || undefined;
}

function color(info: Record<string, unknown>, key: string): string | undefined {
  const v = str(info, key, 9);
  if (v && !HEX.test(v)) throw new Error(`APP_INFO.${key} must be a #hex color`);
  return v;
}

/** A path on this origin or an absolute http(s) URL. */
function link(info: Record<string, unknown>, key: string): string | undefined {
  const v = str(info, key, 2048);
  if (v && !v.startsWith("/") && !httpOrigin(v))
    throw new Error(`APP_INFO.${key} must be an http(s) URL or a path starting with /`);
  return v;
}

/**
 * Validates `APP_NAME` / `APP_INFO`; throws a readable error so a bad deploy fails at boot.
 * `overrides` (admin settings) win over the env, field by field.
 */
export function parseAppConfig(
  env: {
    APP_NAME?: string;
    APP_INFO?: string;
    APP_URL?: string;
  },
  overrides: { name?: string; info?: Record<string, unknown> } = {},
): AppConfig {
  let info: Record<string, unknown> = {};
  if (env.APP_INFO?.trim()) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(env.APP_INFO);
    } catch (err) {
      throw new Error(`APP_INFO is not valid JSON: ${(err as Error).message}`);
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
      throw new Error("APP_INFO must be a JSON object");
    info = parsed as Record<string, unknown>;
  }
  info = { ...info, ...overrides.info };
  const d = DEFAULT_APP_CONFIG;
  const name = overrides.name?.trim() || env.APP_NAME?.trim() || d.name;
  if (name.length > 60) throw new Error("APP_NAME is longer than 60 characters");
  const url = httpOrigin(env.APP_URL) ?? "";
  const ogImage = link(info, "ogImage");
  const locale = str(info, "locale", 10);
  if (locale && !/^[a-z]{2,3}(?:_[A-Z]{2})?$/.test(locale))
    throw new Error("APP_INFO.locale must look like en_US");
  const twitterSite = str(info, "twitterSite", 16);
  if (twitterSite && !/^@\w{1,15}$/.test(twitterSite))
    throw new Error("APP_INFO.twitterSite must look like @handle");
  return {
    name,
    shortName: str(info, "shortName", 30) ?? (name === d.name ? d.shortName : name),
    description: str(info, "description", 300) ?? d.description,
    themeColor: color(info, "themeColor") ?? d.themeColor,
    backgroundColor:
      color(info, "backgroundColor") ?? color(info, "themeColor") ?? d.backgroundColor,
    ogImage,
    locale: locale ?? d.locale,
    twitterSite,
    icon: link(info, "icon"),
    socialProviders: [],
    url,
  };
}

/** Origin of an absolute http(s) URL, else null. */
function httpOrigin(raw: string | undefined): string | null {
  try {
    const u = new URL(raw?.trim() ?? "");
    return u.protocol === "http:" || u.protocol === "https:" ? u.origin : null;
  } catch {
    return null;
  }
}

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** JSON safe inside `<script>`: no `</script>`, no `<!--`, no JS line terminators. */
const scriptJson = (v: unknown) =>
  JSON.stringify(v)
    .replace(/</g, "\\u003c")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");

/**
 * `<head>` tags for the configured instance: title, description, Open Graph, Twitter, config.
 * `origin` (the request's) is the base for `og:url` / a relative `og:image` when `APP_URL` isn't
 * a URL; crawlers need absolute URLs, so without either those tags are left out.
 */
export function renderHead(cfg: AppConfig, origin?: string): string {
  const base = cfg.url || httpOrigin(origin) || "";
  const image = cfg.ogImage?.startsWith("/") ? base && `${base}${cfg.ogImage}` : cfg.ogImage;
  const meta = (attr: "name" | "property", key: string, value: string | undefined) =>
    value ? `<meta ${attr}="${key}" content="${escapeHtml(value)}" />` : "";
  return [
    `<title>${escapeHtml(cfg.name)}</title>`,
    meta("name", "description", cfg.description),
    meta("name", "application-name", cfg.name),
    meta("name", "apple-mobile-web-app-title", cfg.shortName),
    meta("property", "og:type", "website"),
    meta("property", "og:site_name", cfg.name),
    meta("property", "og:title", cfg.name),
    meta("property", "og:description", cfg.description),
    meta("property", "og:url", base && `${base}/`),
    meta("property", "og:locale", cfg.locale),
    meta("property", "og:image", image),
    meta("property", "og:image:alt", image && cfg.name),
    meta("name", "twitter:card", image ? "summary_large_image" : "summary"),
    meta("name", "twitter:site", cfg.twitterSite),
    `<script>window.__APP_CONFIG__=${scriptJson(cfg)}</script>`,
  ]
    .filter(Boolean)
    .join("\n    ");
}

/** Web app manifest for the configured instance. */
export function buildManifest(cfg: AppConfig) {
  return {
    name: cfg.name,
    short_name: cfg.shortName,
    description: cfg.description,
    id: "/",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: cfg.backgroundColor,
    theme_color: cfg.themeColor,
    lang: cfg.locale.split("_")[0],
    orientation: "any",
    categories: ["business", "productivity"],
    icons: cfg.icon
      ? [
          { src: cfg.icon, sizes: "512x512", type: "image/png", purpose: "any" },
          { src: cfg.icon, sizes: "512x512", type: "image/png", purpose: "maskable" },
        ]
      : [
          { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
          { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
          {
            src: "/icon-maskable-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
    shortcuts: [
      { name: "Feed", url: "/" },
      { name: "Chat", url: "/chat" },
      { name: "Calendar", url: "/calendar" },
    ],
  };
}

/**
 * The user's theme (`localStorage.theme`, written by ThemeProvider) applied before the first
 * paint, so a dark choice doesn't flash light while the app loads.
 */
const THEME_BOOT_SCRIPT = `<script>(function(){try{var t=localStorage.getItem("theme");if(t!=="light"&&t!=="dark")t=matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light";document.documentElement.classList.add(t)}catch(e){}})()</script>`;

/**
 * The whole SPA shell for the configured instance: `renderHead` at the placeholder, plus the
 * static tags of index.html that depend on settings (`<html lang>`, icons, theme-color) and the
 * user's theme applied before the first paint. Used by the API and by Vite in dev.
 */
export function renderShell(html: string, cfg: AppConfig, origin?: string): string {
  const head = `${renderHead(cfg, origin)}\n    ${THEME_BOOT_SCRIPT}`;
  let out = html.includes(HEAD_PLACEHOLDER)
    ? html.replace(HEAD_PLACEHOLDER, head)
    : // builds from before the placeholder existed still get the tags
      html.replace(/<title>.*?<\/title>/s, "").replace("</head>", `    ${head}\n  </head>`);
  out = out.replace(
    /<html\b([^>]*?)\slang="[^"]*"/,
    `<html$1 lang="${escapeHtml(cfg.locale.split("_")[0]!)}"`,
  );
  if (cfg.icon) {
    const icon = escapeHtml(cfg.icon);
    out = out
      .replace(/<link rel="icon"[^>]*>/, `<link rel="icon" href="${icon}" />`)
      .replace(
        /<link rel="apple-touch-icon"[^>]*>/,
        `<link rel="apple-touch-icon" href="${icon}" />`,
      );
  }
  // browser chrome color: the bundled light/dark pair unless the instance sets its own
  if (cfg.themeColor !== DEFAULT_APP_CONFIG.themeColor) {
    const color = escapeHtml(cfg.themeColor);
    out = out.replace(/(<meta\s+name="theme-color"\s+content=")[^"]*"/g, `$1${color}"`);
  }
  return out;
}
