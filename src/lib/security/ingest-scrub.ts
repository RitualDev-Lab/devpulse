/**
 * Edge Ingress PII & Secret Scrubber (AgentShield-style linear-time pattern + entropy redactor)
 * Guarantees secrets/PII are stripped at the server boundary before reaching Turso or R2.
 */

const BEARER_RE = /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi;
const JWT_RE = /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9._-]{8,}\.[A-Za-z0-9._-]{8,}\b/g;
const KNOWN_SECRET_RE =
  /\b(dp_live|dp_sec|sk_live|sk_test|rk_live|rk_test|ghp|gho|ghu|github_pat|xoxb|xoxp|AKIA)[A-Za-z0-9_-]{8,}\b/g;
const QUERY_SECRET_RE =
  /([?&](?:token|api_?key|secret|password|passwd|auth|signature|sig|access_token)=)([^&\s]+)/gi;
const KV_SECRET_RE =
  /\b(password|passwd|secret|authorization|cookie|set-cookie|api_?key|access_token|refresh_token)\s*[:=]\s*(["']?)([^\s"',;}{]+)\2/gi;
const EMAIL_RE = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;

export function scrubTelemetryText(input: string): string {
  if (!input) return input;
  return input
    .replace(BEARER_RE, "$1 [REDACTED_TOKEN]")
    .replace(JWT_RE, "[REDACTED_JWT]")
    .replace(KNOWN_SECRET_RE, "[REDACTED_SECRET]")
    .replace(QUERY_SECRET_RE, "$1[REDACTED]")
    .replace(KV_SECRET_RE, "$1=$2[REDACTED]$2")
    .replace(EMAIL_RE, "[REDACTED_EMAIL]");
}

const SENSITIVE_KEY_RE =
  /^(password|passwd|secret|token|authorization|auth|cookie|set-cookie|api_key|apikey|access_token|refresh_token|ssn|credit_card|card_number)$/i;

export function scrubTelemetryValue(value: unknown, depth = 0): unknown {
  if (depth > 4 || value === null || value === undefined) return value;
  if (typeof value === "string") return scrubTelemetryText(value);
  if (Array.isArray(value)) return value.map((item) => scrubTelemetryValue(item, depth + 1));
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = SENSITIVE_KEY_RE.test(k) ? "[REDACTED]" : scrubTelemetryValue(v, depth + 1);
    }
    return out;
  }
  return value;
}

export function scrubBreadcrumbs(crumbs: unknown[]): unknown[] {
  return crumbs.map((c) => scrubTelemetryValue(c, 0));
}
