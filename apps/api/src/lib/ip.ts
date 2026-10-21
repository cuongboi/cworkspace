import { env } from "../env";
import { isIP } from "node:net";

const v4ToBig = (ip: string) =>
  ip.split(".").reduce((acc, p) => (acc << 8n) + BigInt(Number(p)), 0n);

/** Expands any IPv6 text form (`::`, embedded dotted quad, zone id) to 8 groups; null if invalid. */
function expandV6(ip: string): number[] | null {
  ip = ip.replace(/%.*$/, "");
  // a trailing dotted quad (`::ffff:1.2.3.4`, `::1.2.3.4`) becomes two hex groups
  const dotted = /^(.*:)(\d+\.\d+\.\d+\.\d+)$/.exec(ip);
  if (dotted) {
    if (isIP(dotted[2]!) !== 4) return null;
    const n = Number(v4ToBig(dotted[2]!));
    ip = `${dotted[1]}${(n >>> 16).toString(16)}:${(n & 0xffff).toString(16)}`;
  }
  const parts = ip.split("::");
  if (parts.length > 2) return null;
  const h = parts[0] ? parts[0].split(":") : [];
  const t = parts.length === 2 && parts[1] ? parts[1].split(":") : [];
  const fill = parts.length === 2 ? 8 - h.length - t.length : 0;
  if (fill < 0) return null;
  const groups = [...h, ...Array<string>(fill).fill("0"), ...t];
  if (groups.length !== 8 || groups.some((g) => !/^[\da-f]{1,4}$/i.test(g))) return null;
  return groups.map((g) => parseInt(g, 16));
}

/**
 * IPv4 embedded in an IPv6 address that routes to that IPv4 host: mapped `::ffff:0:0/96`,
 * compatible `::/96` (deprecated, but some stacks still route it), NAT64 `64:ff9b::/96` and
 * `64:ff9b:1::/48`, 6to4 `2002::/16` (bits 16-48). Null when none.
 */
function embeddedV4(g: number[]): string | null {
  const quad = (hi: number, lo: number) => [hi >>> 8, hi & 255, lo >>> 8, lo & 255].join(".");
  const zero = (from: number, to: number) => g.slice(from, to).every((x) => x === 0);
  if (zero(0, 5) && g[5] === 0xffff) return quad(g[6]!, g[7]!);
  // `::` and `::1` are handled as IPv6 (unspecified / loopback), not as 0.0.0.0 / 0.0.0.1
  if (zero(0, 6) && (g[6] !== 0 || g[7]! > 1)) return quad(g[6]!, g[7]!);
  if (g[0] === 0x64 && g[1] === 0xff9b && zero(2, 6)) return quad(g[6]!, g[7]!);
  if (g[0] === 0x64 && g[1] === 0xff9b && g[2] === 1) return quad(g[6]!, g[7]!);
  if (g[0] === 0x2002) return quad(g[1]!, g[2]!);
  return null;
}

/** IPv4 and IPv6 addresses as bigints, for CIDR checks. */
function parse(ip: string, unwrap = true): { v: 4 | 6; n: bigint } | null {
  ip = ip.trim().replace(/^\[|\]$/g, "");
  if (isIP(ip) === 4) return { v: 4, n: v4ToBig(ip) };
  if (!ip.includes(":")) return null;
  const groups = expandV6(ip);
  if (!groups) return null;
  const v4 = unwrap ? embeddedV4(groups) : null;
  if (v4) return { v: 4, n: v4ToBig(v4) };
  return { v: 6, n: groups.reduce((acc, x) => (acc << 16n) + BigInt(x), 0n) };
}

/** Normalizes "10.0.0.0/8", "2001:db8::/32" or a bare address; null when invalid. */
export function normalizeCidr(value: string): string | null {
  const [addr = "", bits] = value.trim().split("/");
  const ip = parse(addr, false);
  if (!ip) return null;
  const max = ip.v === 4 ? 32 : 128;
  const prefix = bits === undefined ? max : Number(bits);
  if (!Number.isInteger(prefix) || prefix < 0 || prefix > max) return null;
  return `${addr}/${prefix}`;
}

export function ipInCidr(ip: string, cidr: string): boolean {
  const [addr = "", bits] = cidr.split("/");
  const a = parse(ip);
  const net = parse(addr, false);
  if (!a || !net || a.v !== net.v) return false;
  const max = a.v === 4 ? 32 : 128;
  const prefix = BigInt(bits === undefined ? max : Number(bits));
  const shift = BigInt(max) - prefix;
  return a.n >> shift === net.n >> shift;
}

/** Empty allowlist means "anywhere". */
export const ipAllowed = (ip: string | null, allowlist: string[]) =>
  allowlist.length === 0 || (ip !== null && allowlist.some((c) => ipInCidr(ip, c)));

const PRIVATE_RANGES = [
  "0.0.0.0/8",
  "10.0.0.0/8",
  "100.64.0.0/10",
  "127.0.0.0/8",
  "169.254.0.0/16",
  "172.16.0.0/12",
  "192.0.0.0/24",
  "192.0.2.0/24",
  "192.88.99.0/24",
  "192.168.0.0/16",
  "198.18.0.0/15",
  "198.51.100.0/24",
  "203.0.113.0/24",
  "224.0.0.0/3", // multicast + reserved 240/4 + broadcast
  "::/128",
  "::1/128",
  "100::/64",
  "2001::/23", // IETF protocol assignments (Teredo 2001::/32 embeds a NAT'd v4 we can't vet)
  "2001:db8::/32",
  "fc00::/7",
  "fe80::/10",
  "fec0::/10",
  "ff00::/8",
];

/** Loopback, private, link-local, CGNAT, multicast… — never a webhook target (SSRF). */
export const isPrivateIp = (ip: string) => PRIVATE_RANGES.some((c) => ipInCidr(ip, c));

/** Hostname rules: exact "api.example.com" or wildcard "*.example.com". */
export function hostAllowed(host: string, allowlist: string[]) {
  const h = host.toLowerCase();
  return (
    allowlist.length === 0 ||
    allowlist.some((rule) => {
      const r = rule.toLowerCase();
      return r.startsWith("*.") ? h.endsWith(r.slice(1)) : h === r;
    })
  );
}

const HOST_RE = /^(\*\.)?([a-z0-9-]+\.)*[a-z0-9-]+$/i;
export const isValidHostRule = (value: string) => value.length <= 253 && HOST_RE.test(value);

type IpContext = {
  request: Request;
  server: { requestIP(r: Request): { address: string } | null } | null;
};

/**
 * The caller's address: behind a trusted proxy, the right-most `X-Forwarded-For` hop (the one our
 * proxy appended; anything left of it is client-supplied and spoofable), else the socket.
 */
export function clientIp({ request, server }: IpContext) {
  if (env.TRUST_PROXY) {
    const forwarded = request.headers.get("x-forwarded-for")?.split(",").at(-1)?.trim();
    if (forwarded) return forwarded;
  }
  return server?.requestIP(request)?.address ?? null;
}
