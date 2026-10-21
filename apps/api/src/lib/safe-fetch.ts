import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { env } from "../env";
import { isPrivateIp } from "./ip";

/** True when every address the host resolves to is public (SSRF guard). */
export async function resolvesPublic(hostname: string): Promise<boolean> {
  const host = hostname.replace(/^\[|\]$/g, "");
  const addresses = isIP(host)
    ? [host]
    : await lookup(host, { all: true })
        .then((a) => a.map((x) => x.address))
        .catch(() => []);
  return addresses.length > 0 && !addresses.some(isPrivateIp);
}

/**
 * Throws unless `url` is http(s) on a default port, carries no credentials and resolves to a
 * public address. `ALLOW_PRIVATE_WEBHOOKS` lifts the address check for local development.
 */
export async function assertPublicUrl(url: URL) {
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("Unsupported scheme");
  if (url.username || url.password) throw new Error("Credentials in URL");
  if (url.port && url.port !== "80" && url.port !== "443") throw new Error("Port not allowed");
  if (env.ALLOW_PRIVATE_WEBHOOKS) return;
  if (!(await resolvesPublic(url.hostname)))
    throw new Error("Target resolves to a private address");
}

export type SafeResponse = {
  /** Final URL after redirects. */
  url: URL;
  status: number;
  contentType: string;
  /** At most `maxBytes`; empty unless `readBody` accepted the content type. */
  body: Uint8Array;
};

type SafeFetchOptions = {
  maxBytes?: number;
  timeoutMs?: number;
  maxRedirects?: number;
  /** Whether to read the body for this content type (otherwise it's discarded unread). */
  readBody?: (contentType: string) => boolean;
};

/**
 * GET an untrusted, user-supplied URL. Redirects are followed by hand so every hop is
 * re-validated; time and body size are capped. DNS is checked before each hop, which leaves a
 * small rebinding window between the check and the connection — acceptable for read-only
 * metadata fetches from a single-tenant server.
 */
export async function safeFetch(
  raw: string,
  {
    maxBytes = 512 * 1024,
    timeoutMs = 5_000,
    maxRedirects = 5,
    readBody = () => true,
  }: SafeFetchOptions = {},
): Promise<SafeResponse> {
  const signal = AbortSignal.timeout(timeoutMs);
  let url = new URL(raw);
  for (let hop = 0; ; hop++) {
    await assertPublicUrl(url);
    const res = await fetch(url, {
      redirect: "manual",
      signal,
      headers: {
        "user-agent": `Mozilla/5.0 (compatible; cworkplace-linkbot/1; +${env.APP_URL})`,
        accept: "text/html,application/xhtml+xml,*/*;q=0.8",
      },
    });
    const location = res.headers.get("location");
    if (res.status >= 300 && res.status < 400 && location) {
      await res.body?.cancel();
      if (hop >= maxRedirects) throw new Error("Too many redirects");
      url = new URL(location, url);
      continue;
    }
    const contentType = (res.headers.get("content-type") ?? "").toLowerCase();
    if (!res.ok || !res.body || !readBody(contentType)) {
      await res.body?.cancel();
      return { url, status: res.status, contentType, body: new Uint8Array() };
    }
    return { url, status: res.status, contentType, body: await readCapped(res.body, maxBytes) };
  }
}

async function readCapped(stream: ReadableStream<Uint8Array>, maxBytes: number) {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (size < maxBytes) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      size += value.byteLength;
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  const out = new Uint8Array(Math.min(size, maxBytes));
  let offset = 0;
  for (const c of chunks) {
    const part = c.subarray(0, out.byteLength - offset);
    out.set(part, offset);
    offset += part.byteLength;
    if (offset >= out.byteLength) break;
  }
  return out;
}
