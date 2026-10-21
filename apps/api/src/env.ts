import { parseAppConfig } from "@app/shared/app-config";

/** Validated process environment. Fails fast at boot instead of at first use. */

export const read = (key: string, fallback?: string): string => {
  const value = process.env[key];
  if (value !== undefined && value !== "") return value;
  if (fallback !== undefined) return fallback;
  throw new Error(`Missing required environment variable ${key} (see .env.example)`);
};

export const oneOf = <T extends string>(key: string, allowed: readonly T[], fallback: T): T => {
  const value = read(key, fallback);
  if (!(allowed as readonly string[]).includes(value)) {
    throw new Error(`${key} must be one of ${allowed.join(", ")} (got "${value}")`);
  }
  return value as T;
};

export const nonNegativeInt = (key: string, fallback: number): number => {
  const value = Number(read(key, String(fallback)));
  if (!Number.isInteger(value) || value < 0)
    throw new Error(`${key} must be a non-negative integer`);
  return value;
};

/** Secrets that sign sessions or encrypt stored keys: short ones are brute-forceable. */
const secretOf = (key: string, value: string) => {
  if (value && value.length < 32)
    throw new Error(`${key} must be at least 32 characters (e.g. \`openssl rand -hex 32\`)`);
  return value;
};

/** Credentialed CORS: a wildcard would hand every site the signed-in user's session. */
const webOrigin = (value: string) => {
  if (value.includes("*"))
    throw new Error("WEB_ORIGIN must list exact origins (comma-separated); `*` is not allowed");
  return value;
};

const IS_PRODUCTION = process.env.NODE_ENV === "production";

export const env = {
  IS_PRODUCTION,
  DATABASE_URL: read("DATABASE_URL"),
  BETTER_AUTH_SECRET: secretOf("BETTER_AUTH_SECRET", read("BETTER_AUTH_SECRET")),
  BETTER_AUTH_URL: read("BETTER_AUTH_URL", "http://localhost:3000"),
  WEB_ORIGIN: webOrigin(read("WEB_ORIGIN", "http://localhost:5173")),
  BETTER_AUTH_BASE_PATH: read("BETTER_AUTH_BASE_PATH", "/api/auth"),
  /** Public URL of the web app, used in emailed links (invitations, password reset). */
  APP_URL: read("APP_URL", read("WEB_ORIGIN", "http://localhost:5173").split(",")[0]!),
  // Branding: name + JSON details (shortName, description, themeColor, ogImage…), see app-config.ts
  APP_NAME: read("APP_NAME", ""),
  APP_INFO: read("APP_INFO", ""),
  /** Fixed setup token for first-run onboarding (else a random one is printed at boot). */
  ONBOARDING_TOKEN: read("ONBOARDING_TOKEN", ""),
  /** Encrypts API keys stored in admin settings; defaults to BETTER_AUTH_SECRET. */
  SETTINGS_SECRET: secretOf("SETTINGS_SECRET", read("SETTINGS_SECRET", "")),
  /** Serve the OpenAPI spec + Scalar UI at /openapi (off in production unless enabled). */
  OPENAPI_ENABLED: read("OPENAPI_ENABLED", String(!IS_PRODUCTION)) === "true",
  DB_LOG_QUERIES: read("DB_LOG_QUERIES", "false") === "true",

  // Email (Resend). Without a key, emails are printed to the API console.
  RESEND_API_KEY: read("RESEND_API_KEY", ""),
  MAIL_FROM: read("MAIL_FROM", "cworkplace <onboarding@resend.dev>"),

  // File storage: any S3-compatible bucket (AWS S3, R2, MinIO). Uploads are disabled when unset.
  S3_ENDPOINT: read("S3_ENDPOINT", ""),
  /** Public base that replaces S3_ENDPOINT in presigned URLs (e.g. https://host/s3 behind Caddy). */
  S3_PUBLIC_URL: read("S3_PUBLIC_URL", ""),
  S3_REGION: read("S3_REGION", "auto"),
  S3_BUCKET: read("S3_BUCKET", ""),
  S3_ACCESS_KEY_ID: read("S3_ACCESS_KEY_ID", ""),
  S3_SECRET_ACCESS_KEY: read("S3_SECRET_ACCESS_KEY", ""),

  // WebRTC: STUN (comma-separated) and TURN with coturn REST credentials (use-auth-secret).
  STUN_URLS: read("STUN_URLS", "stun:stun.l.google.com:19302"),
  TURN_URLS: read("TURN_URLS", ""),
  TURN_SECRET: read("TURN_SECRET", ""),

  // Live call captions: defaults for Settings → Integrations (an admin's stored key wins).
  // The provider defaults to Soniox when its key is set, else Gemini, else captions are off.
  SONIOX_API_KEY: read("SONIOX_API_KEY", ""),
  SONIOX_MODEL: read("SONIOX_MODEL", "stt-rt-v5"),
  GEMINI_API_KEY: read("GEMINI_API_KEY", ""),
  GEMINI_TRANSCRIBE_MODEL: read("GEMINI_TRANSCRIBE_MODEL", "gemini-3.5-transcribe-live"),
  GEMINI_TRANSLATE_MODEL: read("GEMINI_TRANSLATE_MODEL", "gemini-3.8-live"),

  // Push notifications (Firebase Cloud Messaging). Disabled unless all are set.
  FIREBASE_PROJECT_ID: read("FIREBASE_PROJECT_ID", ""),
  FIREBASE_CLIENT_EMAIL: read("FIREBASE_CLIENT_EMAIL", ""),
  FIREBASE_PRIVATE_KEY: read("FIREBASE_PRIVATE_KEY", "").replace(/\\n/g, "\n"),
  FIREBASE_API_KEY: read("FIREBASE_API_KEY", ""),
  FIREBASE_APP_ID: read("FIREBASE_APP_ID", ""),
  FIREBASE_MESSAGING_SENDER_ID: read("FIREBASE_MESSAGING_SENDER_ID", ""),
  FIREBASE_VAPID_KEY: read("FIREBASE_VAPID_KEY", ""),

  // Channel integrations. Behind a reverse proxy, trust X-Forwarded-For for IP allowlists.
  TRUST_PROXY: read("TRUST_PROXY", "false") === "true",
  // Let outgoing webhooks reach private/loopback addresses (local development only).
  ALLOW_PRIVATE_WEBHOOKS: read("ALLOW_PRIVATE_WEBHOOKS", "false") === "true",
} as const;

export type Env = typeof env;

/** Parsed once at boot: an invalid APP_INFO stops the server instead of shipping broken tags. */
export const appConfig = parseAppConfig(env);
