/**
 * Region labels for synthetic runs. Pure module (no DB imports) so it can be unit-tested.
 *
 * A label is sent to the target as the X-DevPulse-Region header and stored with the run.
 * It does not move the probe: every run currently executes from the same Worker origin.
 */
export const EDGE_REGIONS = [
  { id: "iad", label: "US-East (Virginia)" },
  { id: "fra", label: "EU-Central (Frankfurt)" },
  { id: "sin", label: "AP-South (Singapore)" },
  { id: "syd", label: "OC-East (Sydney)" },
  { id: "gru", label: "SA-East (Sao Paulo)" },
] as const;

export type EdgeRegionId = (typeof EDGE_REGIONS)[number]["id"];

export const MAX_SYNTHETIC_REGIONS = 5;

/**
 * Resolves stored regionsJson to known region labels. Unknown labels are dropped.
 * Falls back to the default set when the JSON is missing, malformed, or has no known label.
 */
export function resolveSyntheticRegions(regionsJson: string | null | undefined): EdgeRegionId[] {
  const defaults = EDGE_REGIONS.map((r) => r.id);
  if (!regionsJson) return defaults;

  let raw: unknown;
  try {
    raw = JSON.parse(regionsJson);
  } catch {
    return defaults;
  }
  if (!Array.isArray(raw)) return defaults;

  const known = new Set<string>(defaults);
  const valid = Array.from(new Set(raw.map(String).filter((id) => known.has(id)))) as EdgeRegionId[];
  return valid.length > 0 ? valid.slice(0, MAX_SYNTHETIC_REGIONS) : defaults;
}
