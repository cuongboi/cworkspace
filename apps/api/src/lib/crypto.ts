import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  hkdfSync,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import { env } from "../env";

/**
 * Secrets of channel integrations. HMAC secrets must be recoverable (we sign outgoing calls and
 * verify incoming ones), so they are stored AES-256-GCM encrypted with a key derived from
 * BETTER_AUTH_SECRET; bot tokens are additionally stored as a sha256 for lookup.
 */
const key = Buffer.from(
  hkdfSync("sha256", env.BETTER_AUTH_SECRET, "cworkplace", "channel-integrations", 32),
);

export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), data].map((b) => b.toString("base64url")).join(".");
}

export function decryptSecret(sealed: string): string {
  const [iv, tag, data] = sealed.split(".").map((p) => Buffer.from(p, "base64url"));
  if (!iv || !tag || !data) throw new Error("Malformed secret");
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
}

export const randomSecret = (prefix = "") => `${prefix}${randomBytes(32).toString("base64url")}`;

export const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

/** `v1=<hex>` over `${timestamp}.${body}` — the scheme used by incoming and outgoing webhooks. */
export function signPayload(secret: string, timestamp: string, body: string) {
  return `v1=${createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex")}`;
}

export const SIGNATURE_TOLERANCE_MS = 5 * 60_000;

export function verifySignature(
  secret: string,
  timestamp: string | null | undefined,
  body: string,
  signature: string | null | undefined,
  now = Date.now(),
): boolean {
  if (!timestamp || !signature) return false;
  const ts = Number(timestamp) * 1000;
  if (!Number.isFinite(ts) || Math.abs(now - ts) > SIGNATURE_TOLERANCE_MS) return false;
  const expected = Buffer.from(signPayload(secret, timestamp, body));
  const given = Buffer.from(signature);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

export function safeEqual(a: string, b: string) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
