export type VitalMetricName = "LCP" | "INP" | "CLS" | "TTFB";
export type VitalRating = "good" | "needs_improvement" | "poor";

export interface RawWebVitalSample {
  metric: VitalMetricName;
  value: number;
  route?: string | null;
  country?: string | null;
  browser?: string | null;
  release?: string | null;
}

export interface VitalPercentiles {
  metric: VitalMetricName;
  count: number;
  p50: number;
  p75: number;
  p95: number;
  rating: VitalRating;
}

export interface WebVitalBreakdownRow {
  key: string;
  count: number;
  lcpP75: number | null;
  inpP75: number | null;
  clsP75: number | null;
  ttfbP75: number | null;
}

export interface RumWebVitalsSummary {
  sampleCount: number;
  metrics: Record<VitalMetricName, VitalPercentiles | null>;
  byRoute: WebVitalBreakdownRow[];
  byCountry: WebVitalBreakdownRow[];
  byBrowser: WebVitalBreakdownRow[];
  byRelease: WebVitalBreakdownRow[];
}

export function computePercentile(sortedValues: number[], pct: number): number {
  if (sortedValues.length === 0) return 0;
  const idx = Math.min(
    sortedValues.length - 1,
    Math.max(0, Math.ceil((pct / 100) * sortedValues.length) - 1)
  );
  return sortedValues[idx];
}

export function rateWebVital(metric: VitalMetricName, p75Value: number): VitalRating {
  if (metric === "LCP") return p75Value <= 2500 ? "good" : p75Value <= 4000 ? "needs_improvement" : "poor";
  if (metric === "INP") return p75Value <= 200 ? "good" : p75Value <= 500 ? "needs_improvement" : "poor";
  if (metric === "CLS") return p75Value <= 0.1 ? "good" : p75Value <= 0.25 ? "needs_improvement" : "poor";
  return p75Value <= 800 ? "good" : p75Value <= 1800 ? "needs_improvement" : "poor";
}

function roundVital(metric: VitalMetricName, value: number): number {
  return metric === "CLS" ? Math.round(value * 1000) / 1000 : Math.round(value);
}

function buildBreakdown(
  samples: RawWebVitalSample[],
  extractor: (s: RawWebVitalSample) => string
): WebVitalBreakdownRow[] {
  const groups = new Map<string, Record<VitalMetricName, number[]> & { total: number }>();
  for (const s of samples) {
    const k = extractor(s) || "Unknown";
    if (!groups.has(k)) {
      groups.set(k, { LCP: [], INP: [], CLS: [], TTFB: [], total: 0 });
    }
    const bucket = groups.get(k)!;
    bucket[s.metric].push(s.value);
    bucket.total += 1;
  }

  return Array.from(groups.entries())
    .sort((a, b) => b[1].total - a[1].total)
    .slice(0, 10)
    .map(([key, bucket]) => {
      const p75Of = (m: VitalMetricName) =>
        bucket[m].length > 0
          ? roundVital(m, computePercentile([...bucket[m]].sort((x, y) => x - y), 75))
          : null;
      return {
        key,
        count: bucket.total,
        lcpP75: p75Of("LCP"),
        inpP75: p75Of("INP"),
        clsP75: p75Of("CLS"),
        ttfbP75: p75Of("TTFB"),
      };
    });
}

export function aggregateWebVitals(samples: RawWebVitalSample[]): RumWebVitalsSummary {
  const byMetric: Record<VitalMetricName, number[]> = { LCP: [], INP: [], CLS: [], TTFB: [] };
  for (const s of samples) {
    if (Number.isFinite(s.value) && s.value >= 0) {
      byMetric[s.metric].push(s.value);
    }
  }

  const metrics: Record<VitalMetricName, VitalPercentiles | null> = {
    LCP: null,
    INP: null,
    CLS: null,
    TTFB: null,
  };

  for (const m of ["LCP", "INP", "CLS", "TTFB"] as const) {
    const arr = byMetric[m].sort((a, b) => a - b);
    if (arr.length === 0) continue;
    const p50 = roundVital(m, computePercentile(arr, 50));
    const p75 = roundVital(m, computePercentile(arr, 75));
    const p95 = roundVital(m, computePercentile(arr, 95));
    metrics[m] = {
      metric: m,
      count: arr.length,
      p50,
      p75,
      p95,
      rating: rateWebVital(m, p75),
    };
  }

  return {
    sampleCount: samples.length,
    metrics,
    byRoute: buildBreakdown(samples, (s) => s.route || "/"),
    byCountry: buildBreakdown(samples, (s) => s.country || "Global"),
    byBrowser: buildBreakdown(samples, (s) => s.browser || "other"),
    byRelease: buildBreakdown(samples, (s) => s.release || "unreleased"),
  };
}
