/**
 * Recharts v3 Null-Safe Formatter Helpers
 * Guards `(value: number | undefined)` callbacks so sparse buckets render "—" rather than throwing TypeError.
 */
export function formatMetricNumber(
  value: number | string | null | undefined,
  suffix = ""
): string {
  if (value === null || value === undefined || value === "") return "—";
  const num = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(num)) return "—";
  return `${num.toLocaleString("en-US")}${suffix}`;
}
