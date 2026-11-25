export type HostRouteMatch =
  | { kind: "primary" }
  | { kind: "subdomain"; subdomain: string }
  | { kind: "custom"; hostname: string };

const PRIMARY_DOMAIN = "devpulse.ritualdev.in";
const RESERVED_SUBDOMAINS = new Set([
  "www",
  "cname",
  "api",
  "app",
  "admin",
  "docs",
  "status",
  "mail",
  "cdn",
  "assets",
]);

export function parseIncomingHost(rawHost?: string | null): HostRouteMatch {
  if (!rawHost) return { kind: "primary" };

  const hostname = rawHost.split(":")[0].trim().toLowerCase();
  if (!hostname) return { kind: "primary" };

  if (
    hostname === PRIMARY_DOMAIN ||
    hostname === `www.${PRIMARY_DOMAIN}` ||
    hostname === `cname.${PRIMARY_DOMAIN}` ||
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname.endsWith(".pages.dev") ||
    hostname.endsWith(".workers.dev")
  ) {
    return { kind: "primary" };
  }

  const suffix = `.${PRIMARY_DOMAIN}`;
  if (hostname.endsWith(suffix)) {
    const sub = hostname.slice(0, -suffix.length);
    if (sub && !sub.includes(".") && !RESERVED_SUBDOMAINS.has(sub)) {
      return { kind: "subdomain", subdomain: sub };
    }
    return { kind: "primary" };
  }

  return { kind: "custom", hostname };
}

export function isValidSubdomainSlug(slug: string): boolean {
  if (!slug || RESERVED_SUBDOMAINS.has(slug)) return false;
  return /^[a-z0-9](?:[a-z0-9-]{1,36}[a-z0-9])?$/.test(slug);
}

export function isValidCustomHostname(hostname: string): boolean {
  if (!hostname || hostname.length > 253) return false;
  if (hostname.endsWith(PRIMARY_DOMAIN) || hostname === "localhost") return false;
  return /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(hostname);
}
