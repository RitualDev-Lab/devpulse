/**
 * Masks telemetry ingest keys (dp_live_*, dp_pub_*) before rendering in UI cards,
 * dropdowns, and inline snippets so screenshots or screen shares never leak live keys.
 */
export function maskApiKey(rawKey?: string | null, fallback = "dp_live_your_api_key"): string {
  if (!rawKey) return fallback;
  const trimmed = rawKey.trim();
  if (!trimmed) return fallback;
  if (trimmed.startsWith("revoked_")) return "revoked_key";
  if (trimmed.length <= 12) return "••••••••";

  const prefixMatch = trimmed.match(/^(dp_(?:live|pub|test)_)/);
  const prefix = prefixMatch ? prefixMatch[1] : trimmed.slice(0, 4);
  const suffix = trimmed.slice(-4);
  return `${prefix}••••••••${suffix}`;
}

export function displaySnippetKey(
  rawKey?: string | null,
  revealed = false,
  fallback = "dp_live_your_api_key"
): string {
  if (!rawKey || !rawKey.trim()) return fallback;
  return revealed ? rawKey.trim() : maskApiKey(rawKey, fallback);
}
