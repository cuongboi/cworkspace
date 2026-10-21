import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { checkServerIdentity } from "node:tls";
import { env } from "../env";
import { isPrivateIp } from "./ip";

/** Every address `hostname` resolves to (an IP literal resolves to itself); [] on failure. */
async function resolveAll(hostname: string): Promise<string[]> {
  const host = hostname.replace(/^\[|\]$/g, "");
  if (isIP(host)) return [host];
  return lookup(host, { all: true })
    .then((a) => a.map((x) => x.address))
    .catch(() => []);
}

/** True when every address the host resolves to is public (SSRF guard). */
export async function resolvesPublic(hostname: string): Promise<boolean> {
  const addresses = await resolveAll(hostname);
  return addresses.length > 0 && !addresses.some(isPrivateIp);
}

export type TargetOptions = {
  /**
   * Skip the private-address check. Only outgoing webhooks pass this (from
   * `ALLOW_PRIVATE_WEBHOOKS`, for local development); link previews never do.
   */
  allowPrivate?: boolean;
  /** Allow ports other than 80/443 (outgoing webhooks, whose host is admin-allowlisted). */
  allowAnyPort?: boolean;
};

/**
 * Throws unless `url` is http(s) on a default port, carries no credentials and resolves only to
 * public addresses. Returns the address to connect to: callers pin the connection to it
 * (`pinnedFetch`) so a second DNS answer can't swap in a private host (rebinding).
 */
export async function assertPublicUrl(
  url: URL,
  { allowPrivate = false, allowAnyPort = false }: TargetOptions = {},
) {
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("Unsupported scheme");
  if (url.username || url.password) throw new Error("Credentials in URL");
  if (!allowAnyPort && url.port && url.port !== "80" && url.port !== "443")
    throw new Error("Port not allowed");
  const addresses = await resolveAll(url.hostname);
  if (addresses.length === 0) throw new Error("Target does not resolve");
  if (!allowPrivate && addresses.some(isPrivateIp))
    throw new Error("Target resolves to a private address");
  return addresses[0]!;
}

/**
 * `fetch` connected to an already validated `address` instead of resolving `url.hostname`
 * again. The URL is rewritten to the IP; `Host` keeps the name for virtual hosting, and TLS
 * sends the name as SNI and verifies the certificate against it (not against the IP).
 */
export function pinnedFetch(url: URL, address: string, init: RequestInit = {}) {
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (isIP(host)) return fetch(url, init);
  const target = new URL(url);
  target.hostname = isIP(address) === 6 ? `[${address}]` : address;
  const headers = new Headers(init.headers);
  headers.set("host", url.host);
  return fetch(target, {
    ...init,
    headers,
    ...(url.protocol === "https:"
      ? {
          tls: {
            serverName: host,
            checkServerIdentity: (_ip: string, cert: Parameters<typeof checkServerIdentity>[1]) =>
              checkServerIdentity(host, cert),
          },
        }
      : {}),
  });
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
 * re-validated; time and body size are capped. Each hop connects to the address that was
 * validated (no second DNS lookup), and private addresses are always refused here.
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
    const address = await assertPublicUrl(url);
    const res = await pinnedFetch(url, address, {
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
