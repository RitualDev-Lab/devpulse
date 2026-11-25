/**
 * Cloudflare for SaaS Custom Hostnames & DNS Verification Client
 * Manages:
 * - *.<PRIMARY_PORTAL_DOMAIN> free subdomain validation
 * - Cloudflare Custom Hostnames API (/zones/{zone_id}/custom_hostnames) for automated DV SSL
 * - Live DNS-over-HTTPS CNAME verification against CUSTOM_DOMAIN_CNAME_TARGET
 */

/** Portal host that free subdomains live under (NEXT_PUBLIC_PORTAL_DOMAIN). */
import { CNAME_TARGET, PORTAL_DOMAIN } from "@/lib/config/app-url";
export const PRIMARY_PORTAL_DOMAIN = PORTAL_DOMAIN;
/** Target that customer CNAME records must point to (NEXT_PUBLIC_CNAME_TARGET). */
export const CUSTOM_DOMAIN_CNAME_TARGET = CNAME_TARGET;

const RESERVED_SUBDOMAINS = new Set([
  "www",
  "api",
  "app",
  "cname",
  "admin",
  "auth",
  "dashboard",
  "mail",
  "smtp",
  "cdn",
  "static",
  "assets",
  "devpulse",
  "status",
  "docs",
]);

export function isPaidDomainTier(tier?: string | null): boolean {
  const normalized = (tier || "free").toLowerCase();
  return ["pro", "team", "enterprise", "byos"].includes(normalized);
}

export function normalizeAndValidateSubdomain(raw: string): {
  valid: boolean;
  subdomain: string;
  error?: string;
} {
  const cleaned = raw
    .trim()
    .toLowerCase()
    .replace(new RegExp(`\\.${PRIMARY_PORTAL_DOMAIN.split(".").join("\\.")}$`, "i"), "")
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/^-+|-+$/g, "");

  if (cleaned.length < 3 || cleaned.length > 32) {
    return {
      valid: false,
      subdomain: cleaned,
      error: "Subdomain must be between 3 and 32 characters (letters, numbers, hyphens).",
    };
  }

  if (RESERVED_SUBDOMAINS.has(cleaned)) {
    return {
      valid: false,
      subdomain: cleaned,
      error: `"${cleaned}" is reserved. Please pick another subdomain handle.`,
    };
  }

  return { valid: true, subdomain: cleaned };
}

export function normalizeAndValidateCustomDomain(raw: string): {
  valid: boolean;
  domain: string;
  error?: string;
} {
  const cleaned = raw
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .split("/")[0]
    .split(":")[0]
    .replace(/\.+$/, "");

  if (!cleaned || cleaned.length > 253 || !/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(cleaned)) {
    return {
      valid: false,
      domain: cleaned,
      error: 'Enter a valid domain hostname such as "stats.mytool.dev".',
    };
  }

  if (cleaned === PRIMARY_PORTAL_DOMAIN || cleaned.endsWith(`.${PRIMARY_PORTAL_DOMAIN}`)) {
    return {
      valid: false,
      domain: cleaned,
      error: `Use the Free Subdomain field for *.${PRIMARY_PORTAL_DOMAIN} hosts.`,
    };
  }

  return { valid: true, domain: cleaned };
}

function getCloudflareZoneAuth(): { zoneId: string; token: string | null } {
  return {
    zoneId: process.env.CLOUDFLARE_ZONE_ID || "",
    token: process.env.CLOUDFLARE_ZONE_TOKEN || process.env.CLOUDFLARE_API_TOKEN || null,
  };
}

export interface CustomHostnameProvisionResult {
  provisioned: boolean;
  customHostnameId: string | null;
  sslStatus: "pending" | "pending_validation" | "active" | "error";
  ownershipVerification?: { type: string; name: string; value: string } | null;
  note?: string;
}

/**
 * Registers a custom hostname with Cloudflare for SaaS Custom Hostnames API
 * so Cloudflare automatically issues and renews DV SSL certificates.
 */
export async function createCloudflareCustomHostname(
  hostname: string
): Promise<CustomHostnameProvisionResult> {
  const { zoneId, token } = getCloudflareZoneAuth();
  if (!token) {
    return {
      provisioned: false,
      customHostnameId: null,
      sslStatus: "pending_validation",
      note: "Cloudflare Zone API token not configured; DNS CNAME record can still be verified.",
    };
  }

  try {
    const res = await fetch(
      `https://api.cloudflare.com/client/v4/zones/${zoneId}/custom_hostnames`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          hostname,
          ssl: {
            method: "http",
            type: "dv",
            settings: {
              min_tls_version: "1.2",
              http2: "on",
            },
          },
        }),
      }
    );

    const json = await res.json();
    if (!res.ok || !json.success) {
      const errMsg = json.errors?.[0]?.message || `Cloudflare API status ${res.status}`;
      return {
        provisioned: false,
        customHostnameId: null,
        sslStatus: "pending_validation",
        note: `Cloudflare SaaS API note: ${errMsg}`,
      };
    }

    const r = json.result;
    const sslState =
      r?.ssl?.status === "active"
        ? "active"
        : r?.ssl?.status === "pending_validation"
        ? "pending_validation"
        : "pending";

    return {
      provisioned: true,
      customHostnameId: r?.id || null,
      sslStatus: sslState,
      ownershipVerification: r?.ownership_verification || null,
    };
  } catch (err: any) {
    return {
      provisioned: false,
      customHostnameId: null,
      sslStatus: "pending_validation",
      note: err?.message || "Failed to reach Cloudflare Custom Hostnames API",
    };
  }
}

export async function getCloudflareCustomHostnameStatus(customHostnameId: string): Promise<{
  found: boolean;
  status?: string;
  sslStatus?: "pending" | "pending_validation" | "active" | "error";
  verificationErrors?: string[];
}> {
  const { zoneId, token } = getCloudflareZoneAuth();
  if (!token || !customHostnameId) {
    return { found: false };
  }

  try {
    const res = await fetch(
      `https://api.cloudflare.com/client/v4/zones/${zoneId}/custom_hostnames/${customHostnameId}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      }
    );
    if (!res.ok) return { found: false };
    const json = await res.json();
    const r = json.result;
    const ssl = r?.ssl?.status;
    return {
      found: true,
      status: r?.status,
      sslStatus: ssl === "active" ? "active" : ssl === "pending_validation" ? "pending_validation" : "pending",
      verificationErrors: r?.verification_errors || [],
    };
  } catch {
    return { found: false };
  }
}

export async function deleteCloudflareCustomHostname(customHostnameId: string): Promise<boolean> {
  const { zoneId, token } = getCloudflareZoneAuth();
  if (!token || !customHostnameId) return false;
  try {
    const res = await fetch(
      `https://api.cloudflare.com/client/v4/zones/${zoneId}/custom_hostnames/${customHostnameId}`,
      {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${token}`,
        },
      }
    );
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Queries Cloudflare DNS-over-HTTPS (1.1.1.1) to check if the user's CNAME record
 * points to CUSTOM_DOMAIN_CNAME_TARGET or PRIMARY_PORTAL_DOMAIN.
 */
export async function verifyDomainCname(domain: string): Promise<{
  verified: boolean;
  records: string[];
}> {
  try {
    const res = await fetch(
      `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(domain)}&type=CNAME`,
      {
        headers: { Accept: "application/dns-json" },
      }
    );
    if (!res.ok) return { verified: false, records: [] };
    const json = await res.json();
    const answers: Array<{ data: string }> = Array.isArray(json.Answer) ? json.Answer : [];
    const targets = answers.map((a) => String(a.data || "").replace(/\.+$/, "").toLowerCase());

    const verified = targets.some(
      (t) =>
        t === CUSTOM_DOMAIN_CNAME_TARGET ||
        t === PRIMARY_PORTAL_DOMAIN ||
        t.endsWith(".pages.dev")
    );

    return { verified, records: targets };
  } catch {
    return { verified: false, records: [] };
  }
}
