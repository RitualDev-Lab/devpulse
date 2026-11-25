/**
 * Business Impact Scoring, Geographic Extraction & Semantic Crash Grouping Helpers
 */

export interface BusinessImpactResult {
  impactScore: number; // 0..1000 priority rank
  estimatedLostRevenueCents: number;
  category: "revenue_critical" | "auth_critical" | "api_core" | "standard";
  summaryLabel: string;
}

/**
 * Extracts ISO 3166-1 alpha-2 country code from Cloudflare / Vercel edge headers or payload.
 */
export function extractCountryCode(headers: Headers, body?: any): string | null {
  const fromBody = body?.countryCode || body?.country_code || body?.country;
  if (typeof fromBody === "string" && /^[A-Za-z]{2}$/.test(fromBody.trim())) {
    return fromBody.trim().toUpperCase();
  }

  const cf = headers.get("cf-ipcountry") || headers.get("x-vercel-ip-country");
  if (cf && /^[A-Za-z]{2}$/.test(cf.trim()) && cf.toUpperCase() !== "XX") {
    return cf.trim().toUpperCase();
  }
  return null;
}

/**
 * Computes semantic group key by stripping volatile UUIDs, hex pointers, numbers, and timestamps
 * so similar errors group cleanly even before AI grouping runs.
 */
export function computeSemanticGroupKey(
  errorName: string,
  message: string,
  stackTrace?: string | null
): string {
  const cleanName = errorName.split(":")[0].trim().toLowerCase() || "runtimeerror";
  const normalizedMsg = message
    .toLowerCase()
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "<uuid>")
    .replace(/0x[0-9a-f]+/gi, "<hex>")
    .replace(/\b\d+\b/g, "<n>")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);

  const firstFrame = (stackTrace || "")
    .split(/\r?\n/)
    .find((line) => /\bat\s+|File\s+"/.test(line))
    ?.replace(/:\d+:\d+/g, "")
    .trim()
    .slice(0, 80) || "";

  const basis = `${cleanName}|${normalizedMsg}|${firstFrame}`;
  // Deterministic lightweight FNV-1a 32-bit slug
  let hash = 2166136261;
  for (let i = 0; i < basis.length; i++) {
    hash ^= basis.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `${cleanName.replace(/[^a-z0-9]+/g, "-")}-${(hash >>> 0).toString(16)}`;
}

/**
 * Extracts normalized top application stack frame (`file:line` / `fn@file`) for issue fingerprinting.
 */
export function extractTopStackFrame(stackTrace?: string | null): string {
  if (!stackTrace) return "no-stack";
  const lines = stackTrace
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  const frameLine =
    lines.find(
      (l) =>
        (/\bat\s+/.test(l) || /File\s+"/.test(l) || /\.ts:|\.js:|\.py:|\.rs:|\.go:|\.dart:/.test(l)) &&
        !/node_modules|internal\/|<anonymous>/.test(l)
    ) ||
    lines.find((l) => /\bat\s+|File\s+"/.test(l)) ||
    lines[1] ||
    lines[0] ||
    "no-stack";

  return frameLine
    .replace(/:\d+:\d+/g, "")
    .replace(/0x[0-9a-f]+/gi, "<hex>")
    .slice(0, 140);
}

/**
 * Computes a deterministic SHA-256 issue fingerprint (`fp_<24-hex>`) from
 * projectId + errorName + normalized top stack frame.
 */
export async function computeCrashFingerprint(
  projectId: string,
  errorName: string,
  stackTrace?: string | null
): Promise<{ fingerprint: string; topFrame: string }> {
  const cleanName = errorName.split(":")[0].trim().toLowerCase() || "runtimeerror";
  const topFrame = extractTopStackFrame(stackTrace);
  const input = `${projectId}|${cleanName}|${topFrame.toLowerCase()}`;
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  const hex = Array.from(new Uint8Array(digest))
    .slice(0, 12)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return { fingerprint: `fp_${hex}`, topFrame };
}

/**
 * Assigns Business Impact ($) and Priority Score (0..1000) to a crash event based on:
 * - Affected route criticality (/checkout, /billing, /auth, /api)
 * - Affected users count
 * - Estimated ARPU / lost conversion revenue
 */
export function computeBusinessImpact(params: {
  routePath?: string | null;
  message?: string | null;
  affectedUsersCount?: number;
  arpuCents?: number; // Default $29/mo -> 2900 cents
  environment?: string | null;
}): BusinessImpactResult {
  const route = String(params.routePath || "").toLowerCase();
  const msg = String(params.message || "").toLowerCase();
  const users = Math.max(1, Number(params.affectedUsersCount || 1));
  const arpuCents = Math.max(500, Number(params.arpuCents || 2900));
  const isProd = (params.environment || "production").toLowerCase() === "production";

  let category: BusinessImpactResult["category"] = "standard";
  let routeMultiplier = 1.0;
  let conversionLossRate = 0.04;

  if (
    /checkout|payment|billing|subscribe|stripe|dodo|cart|order|invoice/.test(route) ||
    /paymentintent|checkout|stripe|billing/.test(msg)
  ) {
    category = "revenue_critical";
    routeMultiplier = 3.5;
    conversionLossRate = 0.28;
  } else if (/auth|login|signup|register|oauth|saml|sso|token/.test(route)) {
    category = "auth_critical";
    routeMultiplier = 2.4;
    conversionLossRate = 0.14;
  } else if (/^\/api\//.test(route)) {
    category = "api_core";
    routeMultiplier = 1.6;
    conversionLossRate = 0.08;
  }

  const envWeight = isProd ? 1.0 : 0.25;
  const estimatedLostRevenueCents = Math.round(
    users * arpuCents * conversionLossRate * envWeight
  );

  // Score combines route severity, log-scaled affected users, and estimated revenue at risk
  const userScore = Math.min(350, Math.round(Math.log10(users + 1) * 115));
  const revScore = Math.min(400, Math.round((estimatedLostRevenueCents / 10000) * 12));
  const rawScore = Math.round((routeMultiplier * 70 + userScore + revScore) * envWeight);
  const impactScore = Math.max(10, Math.min(1000, rawScore));

  const dollars = Math.round(estimatedLostRevenueCents / 100);
  const summaryLabel = `${users.toLocaleString()} user${users === 1 ? "" : "s"} • est. $${dollars.toLocaleString()} revenue at risk (assumes $${(arpuCents / 100).toLocaleString()}/mo ARPU)`;

  return {
    impactScore,
    estimatedLostRevenueCents,
    category,
    summaryLabel,
  };
}
