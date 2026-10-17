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

export const env = {
  DATABASE_URL: read("DATABASE_URL"),
  BETTER_AUTH_SECRET: read("BETTER_AUTH_SECRET"),
  BETTER_AUTH_URL: read("BETTER_AUTH_URL", "http://localhost:3000"),
  WEB_ORIGIN: read("WEB_ORIGIN", "http://localhost:5173"),
  BETTER_AUTH_BASE_PATH: read("BETTER_AUTH_BASE_PATH", "/api/auth"),
  /** Public URL of the web app, used in emailed links (invitations, password reset). */
  APP_URL: read("APP_URL", read("WEB_ORIGIN", "http://localhost:5173").split(",")[0]!),
  DB_LOG_QUERIES: read("DB_LOG_QUERIES", "false") === "true",

  // Email (Resend). Without a key, emails are printed to the API console.
  RESEND_API_KEY: read("RESEND_API_KEY", ""),
  MAIL_FROM: read("MAIL_FROM", "cworkplace <onboarding@resend.dev>"),

  // File storage: any S3-compatible bucket (AWS S3, R2, MinIO). Uploads are disabled when unset.
  S3_ENDPOINT: read("S3_ENDPOINT", ""),
  S3_REGION: read("S3_REGION", "auto"),
  S3_BUCKET: read("S3_BUCKET", ""),
  S3_ACCESS_KEY_ID: read("S3_ACCESS_KEY_ID", ""),
  S3_SECRET_ACCESS_KEY: read("S3_SECRET_ACCESS_KEY", ""),

  // WebRTC: STUN (comma-separated) and TURN with coturn REST credentials (use-auth-secret).
  STUN_URLS: read("STUN_URLS", "stun:stun.l.google.com:19302"),
  TURN_URLS: read("TURN_URLS", ""),
  TURN_SECRET: read("TURN_SECRET", ""),
} as const;

export type Env = typeof env;
