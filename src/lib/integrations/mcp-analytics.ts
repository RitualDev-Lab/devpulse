export interface RawMcpCallRow {
  toolName: string;
  outcome: string;
  durationMs: number;
  createdAt: string;
  inputTokens?: number | null;
  outputTokens?: number | null;
  costUsd?: number | null;
  model?: string | null;
}

export interface AggregatedMcpToolMetric {
  toolName: string;
  calls: number;
  denied: number;
  errors: number;
  errorRatePercent: number;
  avgDurationMs: number;
  p50DurationMs: number;
  p95DurationMs: number;
  estimatedTokens: number;
  estimatedCostUsd: number;
}

export function computePercentile(sortedAsc: number[], pct: number): number {
  if (sortedAsc.length === 0) return 0;
  const idx = Math.min(
    sortedAsc.length - 1,
    Math.max(0, Math.ceil((pct / 100) * sortedAsc.length) - 1)
  );
  return sortedAsc[idx];
}

export function estimateMcpCallUsage(call: {
  toolName: string;
  durationMs: number;
  inputTokens?: number | null;
  outputTokens?: number | null;
  costUsd?: number | null;
}): { tokens: number; costUsd: number } {
  const hasExplicitTokens =
    typeof call.inputTokens === "number" || typeof call.outputTokens === "number";
  const tokens = hasExplicitTokens
    ? Math.max(0, Math.round((call.inputTokens || 0) + (call.outputTokens || 0)))
    : Math.max(280, Math.round(call.durationMs * 1.4));

  const costUsd =
    typeof call.costUsd === "number" && Number.isFinite(call.costUsd)
      ? Math.max(0, call.costUsd)
      : Number(((tokens / 1_000_000) * 1.25).toFixed(6));

  return { tokens, costUsd };
}

export function aggregateMcpMetrics(calls: RawMcpCallRow[]): {
  tools: AggregatedMcpToolMetric[];
  totalCalls: number;
  deniedCount: number;
  errorCount: number;
  errorRatePercent: number;
  p50DurationMs: number;
  p95DurationMs: number;
  totalTokens: number;
  estimatedCostUsd: number;
  daily: Record<string, { calls: number; errors: number; costUsd: number }>;
} {
  const allDurations: number[] = [];
  let deniedCount = 0;
  let errorCount = 0;
  let totalTokens = 0;
  let estimatedCostUsd = 0;

  const grouped = new Map<
    string,
    {
      calls: number;
      denied: number;
      errors: number;
      durations: number[];
      tokens: number;
      costUsd: number;
    }
  >();

  const daily: Record<string, { calls: number; errors: number; costUsd: number }> = {};

  for (const call of calls) {
    const dur = Math.max(0, Number(call.durationMs || 0));
    allDurations.push(dur);

    if (call.outcome === "denied") deniedCount++;
    if (call.outcome === "error") errorCount++;

    const usage = estimateMcpCallUsage({
      toolName: call.toolName,
      durationMs: dur,
      inputTokens: call.inputTokens,
      outputTokens: call.outputTokens,
      costUsd: call.costUsd,
    });
    totalTokens += usage.tokens;
    estimatedCostUsd += usage.costUsd;

    const existing = grouped.get(call.toolName) || {
      calls: 0,
      denied: 0,
      errors: 0,
      durations: [],
      tokens: 0,
      costUsd: 0,
    };
    existing.calls++;
    if (call.outcome === "denied") existing.denied++;
    if (call.outcome === "error") existing.errors++;
    existing.durations.push(dur);
    existing.tokens += usage.tokens;
    existing.costUsd += usage.costUsd;
    grouped.set(call.toolName, existing);

    const day = (call.createdAt || "").slice(0, 10) || new Date().toISOString().slice(0, 10);
    if (!daily[day]) daily[day] = { calls: 0, errors: 0, costUsd: 0 };
    daily[day].calls++;
    if (call.outcome === "error" || call.outcome === "denied") daily[day].errors++;
    daily[day].costUsd = Number((daily[day].costUsd + usage.costUsd).toFixed(4));
  }

  allDurations.sort((a, b) => a - b);

  const tools: AggregatedMcpToolMetric[] = Array.from(grouped.entries())
    .map(([toolName, stat]) => {
      const sorted = [...stat.durations].sort((a, b) => a - b);
      const avg = Math.round(sorted.reduce((s, d) => s + d, 0) / Math.max(1, sorted.length));
      return {
        toolName,
        calls: stat.calls,
        denied: stat.denied,
        errors: stat.errors,
        errorRatePercent: Number((((stat.errors + stat.denied) / Math.max(1, stat.calls)) * 100).toFixed(1)),
        avgDurationMs: avg,
        p50DurationMs: computePercentile(sorted, 50),
        p95DurationMs: computePercentile(sorted, 95),
        estimatedTokens: stat.tokens,
        estimatedCostUsd: Number(stat.costUsd.toFixed(4)),
      };
    })
    .sort((a, b) => b.calls - a.calls);

  const totalCalls = calls.length;
  return {
    tools,
    totalCalls,
    deniedCount,
    errorCount,
    errorRatePercent:
      totalCalls > 0 ? Number((((errorCount + deniedCount) / totalCalls) * 100).toFixed(1)) : 0,
    p50DurationMs: computePercentile(allDurations, 50),
    p95DurationMs: computePercentile(allDurations, 95),
    totalTokens,
    estimatedCostUsd: Number(estimatedCostUsd.toFixed(4)),
    daily,
  };
}
