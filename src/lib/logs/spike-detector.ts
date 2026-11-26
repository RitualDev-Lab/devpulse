export interface LogSpikeAnalysis {
  currentErrorCount: number;
  baselineHourlyAvg: number;
  multiplier: number;
  isSpike: boolean;
  summary: string;
}

export function extractJsonFieldsFromLog(
  message: string,
  labelsJson?: string | null
): Record<string, string> {
  const fields: Record<string, string> = {};

  if (labelsJson) {
    try {
      const parsed = JSON.parse(labelsJson);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        for (const [k, v] of Object.entries(parsed)) {
          if (v !== null && v !== undefined) {
            fields[k] = String(v).slice(0, 64);
          }
        }
      }
    } catch {
      // ignore malformed labels json
    }
  }

  // Extract inline key=value pairs like status=502 latency=14ms
  for (const match of message.matchAll(/\b([a-zA-Z_][a-zA-Z0-9_]{1,24})=([a-zA-Z0-9._:/-]{1,48})/g)) {
    const [, key, val] = match;
    if (!(key in fields)) fields[key] = val;
  }

  // Extract inline JSON snippets {...}
  const jsonStart = message.indexOf("{");
  const jsonEnd = message.lastIndexOf("}");
  if (jsonStart !== -1 && jsonEnd > jsonStart && jsonEnd - jsonStart <= 1200) {
    try {
      const inline = JSON.parse(message.slice(jsonStart, jsonEnd + 1));
      if (inline && typeof inline === "object" && !Array.isArray(inline)) {
        for (const [k, v] of Object.entries(inline)) {
          if (v !== null && v !== undefined && typeof v !== "object") {
            fields[k] = String(v).slice(0, 64);
          }
        }
      }
    } catch {
      // message may not contain valid JSON object
    }
  }

  return fields;
}

export function detectLogErrorSpike(
  logs: Array<{ level: string; timestampMs: number }>,
  nowMs = Date.now(),
  spikeMultiplierThreshold = 3.0
): LogSpikeAnalysis {
  const hourMs = 3600_000;
  const recentCutoff = nowMs - hourMs;
  const baselineCutoff = nowMs - 24 * hourMs;

  let currentErrorCount = 0;
  let baselineErrorCount = 0;

  for (const log of logs) {
    const lvl = (log.level || "").toLowerCase();
    if (lvl !== "error" && lvl !== "fatal") continue;
    if (log.timestampMs >= recentCutoff && log.timestampMs <= nowMs) {
      currentErrorCount++;
    } else if (log.timestampMs >= baselineCutoff && log.timestampMs < recentCutoff) {
      baselineErrorCount++;
    }
  }

  const baselineHourlyAvg = Number((baselineErrorCount / 23).toFixed(2));
  const effectiveBaseline = Math.max(1, baselineHourlyAvg);
  const multiplier = Number((currentErrorCount / effectiveBaseline).toFixed(2));
  const isSpike = currentErrorCount >= 5 && multiplier >= spikeMultiplierThreshold;

  return {
    currentErrorCount,
    baselineHourlyAvg,
    multiplier,
    isSpike,
    summary: isSpike
      ? `Error log spike detected: ${currentErrorCount} error/fatal logs in the last hour (${multiplier}x 24h baseline avg ${baselineHourlyAvg}/hr)`
      : `Normal log error rate (${currentErrorCount}/hr vs 24h avg ${baselineHourlyAvg}/hr)`,
  };
}
