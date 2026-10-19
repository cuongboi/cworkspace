import { isIP } from "node:net";

/** IPv4 and IPv6 addresses as bigints, for CIDR checks (IPv4-mapped IPv6 is treated as IPv4). */
function parse(ip: string): { v: 4 | 6; n: bigint } | null {
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip);
  if (mapped) ip = mapped[1]!;
  const kind = isIP(ip);
  if (kind === 4) {
    return { v: 4, n: ip.split(".").reduce((acc, p) => (acc << 8n) + BigInt(Number(p)), 0n) };
  }
  if (kind === 6) {
    const [head = "", tail = ""] = ip.split("::");
    const h = head ? head.split(":") : [];
    const t = tail ? tail.split(":") : [];
    const groups = ip.includes("::")
      ? [...h, ...Array(8 - h.length - t.length).fill("0"), ...t]
      : h;
    if (groups.length !== 8) return null;
    return {
      v: 6,
      n: groups.reduce((acc, g) => (acc << 16n) + BigInt(parseInt(g || "0", 16)), 0n),
    };
  }
  return null;
}

/** Normalizes "10.0.0.0/8", "2001:db8::/32" or a bare address; null when invalid. */
export function normalizeCidr(value: string): string | null {
  const [addr = "", bits] = value.trim().split("/");
  const ip = parse(addr);
  if (!ip) return null;
  const max = ip.v === 4 ? 32 : 128;
  const prefix = bits === undefined ? max : Number(bits);
  if (!Number.isInteger(prefix) || prefix < 0 || prefix > max) return null;
  return `${addr}/${prefix}`;
}

export function ipInCidr(ip: string, cidr: string): boolean {
  const [addr = "", bits] = cidr.split("/");
  const a = parse(ip);
  const net = parse(addr);
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
  "192.168.0.0/16",
  "198.18.0.0/15",
  "224.0.0.0/3",
  "::/128",
  "::1/128",
  "fc00::/7",
  "fe80::/10",
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
