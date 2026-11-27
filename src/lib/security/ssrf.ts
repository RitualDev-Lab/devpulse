/**
 * SSRF Prevention & Project-Scoped R2 Object Key Validators
 */

const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "localhost.localdomain",
  "ip6-localhost",
  "ip6-loopback",
  "metadata",
  "metadata.google.internal",
  "metadata.goog",
  "instance-data",
  "169.254.169.254",
]);

function parseIpv4Quad(hostname: string): [number, number, number, number] | null {
  // Block single-integer / hex / octal shorthand forms (e.g. 2130706433, 0x7f000001, 0177.0.0.1)
  if (/^\d+$/.test(hostname) || /^0x[0-9a-f]+$/i.test(hostname)) {
    const val = Number(hostname);
    if (Number.isFinite(val) && val >= 0 && val <= 0xffffffff) {
      return [
        (val >>> 24) & 0xff,
        (val >>> 16) & 0xff,
        (val >>> 8) & 0xff,
        val & 0xff,
      ];
    }
  }

  const parts = hostname.split(".");
  if (parts.length !== 4) return null;
  const octets: number[] = [];
  for (const p of parts) {
    if (!/^(?:0|[1-9]\d*|0x[0-9a-f]+|0[0-7]+)$/i.test(p)) return null;
    const n = p.toLowerCase().startsWith("0x")
      ? parseInt(p, 16)
      : p.startsWith("0") && p.length > 1
      ? parseInt(p, 8)
      : parseInt(p, 10);
    if (!Number.isFinite(n) || n < 0 || n > 255) return null;
    octets.push(n);
  }
  return [octets[0], octets[1], octets[2], octets[3]];
}

function isBlockedIpv4(a: number, b: number, _c: number, _d: number): boolean {
  if (a === 0) return true; // 0.0.0.0/8 ("this host on this network")
  if (a === 10) return true; // 10.0.0.0/8 RFC1918
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10 CGNAT
  if (a === 127) return true; // 127.0.0.0/8 loopback
  if (a === 169 && b === 254) return true; // 169.254.0.0/16 link-local & cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12 RFC1918
  if (a === 192 && b === 0 && _c === 0) return true; // 192.0.0.0/24
  if (a === 192 && b === 168) return true; // 192.168.0.0/16 RFC1918
  if (a === 198 && (b === 18 || b === 19)) return true; // 198.18.0.0/15 benchmarking
  if (a >= 224) return true; // Multicast & reserved
  return false;
}

function isBlockedIpv6(rawHost: string): boolean {
  const host = rawHost.replace(/^\[|\]$/g, "").toLowerCase();
  if (!host.includes(":")) return false;

  if (host === "::" || host === "::1" || host === "0:0:0:0:0:0:0:1" || host === "0:0:0:0:0:0:0:0") {
    return true;
  }
  // Link-local (fe80::/10) or ULA (fc00::/7 -> fc00..fdff)
  if (/^fe[89ab][0-9a-f]:/i.test(host) || /^f[cd][0-9a-f]{2}:/i.test(host)) {
    return true;
  }
  // IPv4-mapped IPv6 (e.g. ::ffff:127.0.0.1 or ::ffff:7f00:1)
  const v4MappedMatch = host.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
  if (v4MappedMatch) {
    const q = parseIpv4Quad(v4MappedMatch[1]);
    if (!q || isBlockedIpv4(q[0], q[1], q[2], q[3])) return true;
  }
  const hexMappedMatch = host.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i);
  if (hexMappedMatch) {
    const hi = parseInt(hexMappedMatch[1], 16);
    const lo = parseInt(hexMappedMatch[2], 16);
    if (isBlockedIpv4((hi >> 8) & 0xff, hi & 0xff, (lo >> 8) & 0xff, lo & 0xff)) return true;
  }
  return false;
}

export function validatePublicUrl(
  rawUrl: string,
  options?: { allowHttp?: boolean }
): { valid: boolean; reason?: string; normalized?: string } {
  try {
    const trimmed = String(rawUrl || "").trim();
    if (!trimmed) return { valid: false, reason: "URL cannot be empty" };

    const parsed = new URL(trimmed);
    const allowHttp = Boolean(options?.allowHttp);
    const protocolOk = allowHttp
      ? parsed.protocol === "https:" || parsed.protocol === "http:"
      : parsed.protocol === "https:";

    if (!protocolOk) {
      return {
        valid: false,
        reason: allowHttp
          ? "URL must use https:// or http://"
          : "Webhook and storage endpoint URLs must strictly use https://",
      };
    }

    if (parsed.username || parsed.password) {
      return { valid: false, reason: "Embedded credentials in URLs are not permitted" };
    }

    const host = parsed.hostname.toLowerCase().replace(/\.+$/, "");
    if (!host) {
      return { valid: false, reason: "Invalid hostname" };
    }

    if (
      BLOCKED_HOSTNAMES.has(host) ||
      host.endsWith(".localhost") ||
      host.endsWith(".local") ||
      host.endsWith(".internal") ||
      host.endsWith(".localdomain") ||
      host.endsWith(".home.arpa")
    ) {
      return { valid: false, reason: "Loopback and internal hostnames are blocked for security" };
    }

    const ipv4 = parseIpv4Quad(host);
    if (ipv4 && isBlockedIpv4(ipv4[0], ipv4[1], ipv4[2], ipv4[3])) {
      return { valid: false, reason: "Private, loopback, or link-local IP addresses are blocked" };
    }

    if (isBlockedIpv6(host)) {
      return { valid: false, reason: "Private or loopback IPv6 addresses are blocked" };
    }

    return { valid: true, normalized: parsed.toString() };
  } catch {
    return { valid: false, reason: "Invalid URL format" };
  }
}

export function assertSafePublicHttpsUrl(rawUrl: string): string {
  const check = validatePublicUrl(rawUrl, { allowHttp: false });
  if (!check.valid || !check.normalized) {
    throw new Error(check.reason || "Blocked unsafe URL");
  }
  return check.normalized;
}

export type HostDnsResolver = (hostname: string) => Promise<string[]>;

async function resolveHostnameViaDoH(hostname: string): Promise<string[]> {
  const ips: string[] = [];
  for (const recordType of ["A", "AAAA"] as const) {
    try {
      const res = await fetch(
        `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(hostname)}&type=${recordType}`,
        {
          headers: { Accept: "application/dns-json" },
          signal: AbortSignal.timeout(1500),
        }
      );
      if (!res.ok) continue;
      const json = (await res.json()) as { Answer?: Array<{ type?: number; data?: string }> };
      for (const ans of json.Answer || []) {
        if ((ans.type === 1 || ans.type === 28) && ans.data) {
          ips.push(ans.data.trim());
        }
      }
    } catch {
      // DoH best-effort lookup
    }
  }
  return ips;
}

export function isBlockedIpLiteral(rawIp: string): boolean {
  const clean = rawIp.trim().replace(/^\[|\]$/g, "").toLowerCase();
  const v4 = parseIpv4Quad(clean);
  if (v4) return isBlockedIpv4(v4[0], v4[1], v4[2], v4[3]);
  return isBlockedIpv6(clean);
}

/**
 * Validates URL syntax AND resolves public DNS A/AAAA records to mitigate DNS-rebinding SSRF.
 */
export async function validateResolvedPublicUrl(
  rawUrl: string,
  options?: { allowHttp?: boolean; resolver?: HostDnsResolver }
): Promise<{ valid: boolean; reason?: string; normalized?: string }> {
  const syntaxCheck = validatePublicUrl(rawUrl, { allowHttp: options?.allowHttp });
  if (!syntaxCheck.valid || !syntaxCheck.normalized) return syntaxCheck;

  const parsed = new URL(syntaxCheck.normalized);
  const host = parsed.hostname.toLowerCase().replace(/\.+$/, "");

  // If literal IP already passed syntaxCheck, no DNS lookup needed
  if (parseIpv4Quad(host) || host.includes(":")) {
    return syntaxCheck;
  }

  const resolver = options?.resolver || resolveHostnameViaDoH;
  const resolvedIps = await resolver(host).catch(() => []);
  for (const ip of resolvedIps) {
    if (isBlockedIpLiteral(ip)) {
      return {
        valid: false,
        reason: `DNS resolution for ${host} returned blocked private/internal IP (${ip})`,
      };
    }
  }

  return syntaxCheck;
}

function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Validates that an attachment or stack object key strictly belongs to
 * `${tierPrefix}/${projectUserId}/${projectId}/...` with no URL schemes or path traversal.
 */
export function isValidProjectR2ObjectKey(
  rawKey: unknown,
  projectId: string,
  projectUserId: string
): rawKey is string {
  if (typeof rawKey !== "string") return false;
  const key = rawKey.trim();
  if (!key || key.length > 512) return false;
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(key)) return false; // reject http://, https://, javascript:, data:
  if (key.includes("..") || key.includes("\\") || key.includes("?") || key.includes("#") || /[\x00-\x1f]/.test(key)) {
    return false;
  }

  const lower = key.toLowerCase();
  if (lower.includes("%2e%2e") || lower.includes("%2f..") || lower.includes("..%2f")) {
    return false;
  }

  const pattern = new RegExp(
    `^(?:free|pro|enterprise|byos)\\/${escapeRegExp(projectUserId)}\\/${escapeRegExp(projectId)}\\/[a-zA-Z0-9._\\/-]{1,320}$`
  );
  return pattern.test(key);
}
