export interface FunnelStepResult {
  event: string;
  users: number;
  conversionFromPrevious: number | null;
  conversionFromStart: number | null;
}

export function buildFunnelResults(events: string[], counts: number[]): FunnelStepResult[] {
  if (events.length !== counts.length) throw new Error("Funnel event/count lengths must match");
  const safeCounts = counts.map((count) => (Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0));
  if (safeCounts.some((count, index) => index > 0 && count > safeCounts[index - 1])) {
    throw new Error("Sequential funnel counts cannot increase at later steps");
  }
  return events.map((event, index) => ({
    event,
    users: safeCounts[index],
    conversionFromPrevious:
      index === 0 || safeCounts[index - 1] === 0
        ? null
        : Number(Math.min(100, (safeCounts[index] / safeCounts[index - 1]) * 100).toFixed(1)),
    conversionFromStart:
      index === 0 || safeCounts[0] === 0
        ? null
        : Number(Math.min(100, (safeCounts[index] / safeCounts[0]) * 100).toFixed(1)),
  }));
}

export function parseFunnelSteps(raw: string | null): string[] {
  if (!raw) return [];
  const values = raw.split(",").map((value) => value.trim().slice(0, 64)).filter(Boolean);
  return Array.from(new Set(values)).slice(0, 5);
}
