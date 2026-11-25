/**
 * Loki-Compatible Log Push Parser & Crash Correlation Helpers
 * Accepts Grafana Loki Push API `{ streams: [...] }` and structured JSON logs.
 */

export interface NormalizedLogEntry {
  level: "debug" | "info" | "warn" | "error" | "fatal";
  serviceName: string;
  message: string;
  labels: Record<string, string>;
  traceId: string | null;
  timestampMs: number;
  timestampIso: string;
}

function nanoOrMsToMs(raw: unknown, fallbackMs: number): number {
  if (typeof raw === "number" && Number.isFinite(raw)) {
    return raw > 1e15 ? Math.round(raw / 1_000_000) : Math.round(raw);
  }
  if (typeof raw === "string" && /^\d+$/.test(raw.trim())) {
    const big = BigInt(raw.trim());
    if (big > BigInt(1e15)) return Number(big / BigInt(1_000_000));
    return Number(big);
  }
  if (typeof raw === "string") {
    const parsed = Date.parse(raw);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallbackMs;
}

function detectLogLevel(
  explicit: unknown,
  line: string
): "debug" | "info" | "warn" | "error" | "fatal" {
  const s = `${String(explicit || "")} ${line.slice(0, 80)}`.toLowerCase();
  if (/\bfatal\b|\bpanic\b|\bcritical\b/.test(s)) return "fatal";
  if (/\berror\b|\berr\b|\bexception\b|\bfailed\b/.test(s)) return "error";
  if (/\bwarn\b|\bwarning\b/.test(s)) return "warn";
  if (/\bdebug\b|\btrace\b/.test(s)) return "debug";
  return "info";
}

export function parseLokiOrStructuredLogs(body: any): NormalizedLogEntry[] {
  const entries: NormalizedLogEntry[] = [];
  const nowMs = Date.now();

  // 1. Standard Grafana Loki Push API: { streams: [{ stream: {...}, values: [[nano, line], ...] }] }
  if (Array.isArray(body?.streams)) {
    for (const st of body.streams) {
      const labelsObj: Record<string, string> = {};
      if (st?.stream && typeof st.stream === "object") {
        for (const [k, v] of Object.entries(st.stream)) {
          labelsObj[String(k)] = String(v);
        }
      }
      const serviceName =
        labelsObj.service || labelsObj.service_name || labelsObj.app || labelsObj.job || "app";
      const values = Array.isArray(st?.values) ? st.values : [];

      for (const pair of values) {
        if (!Array.isArray(pair) || pair.length < 2) continue;
        const tsMs = nanoOrMsToMs(pair[0], nowMs);
        const line = String(pair[1] ?? "").slice(0, 4000);
        let parsedJson: Record<string, any> | null = null;
        if (line.startsWith("{")) {
          try {
            parsedJson = JSON.parse(line);
          } catch {
            parsedJson = null;
          }
        }
        const traceId =
          labelsObj.traceId ||
          labelsObj.trace_id ||
          (parsedJson?.traceId ? String(parsedJson.traceId) : null);

        entries.push({
          level: detectLogLevel(labelsObj.level || parsedJson?.level, line),
          serviceName: String(serviceName).slice(0, 80),
          message: parsedJson?.message ? String(parsedJson.message).slice(0, 4000) : line,
          labels: labelsObj,
          traceId: traceId ? String(traceId).slice(0, 64) : null,
          timestampMs: tsMs,
          timestampIso: new Date(tsMs).toISOString(),
        });
      }
    }
    return entries;
  }

  // 2. Structured JSON Logs: { logs: [...] } or single object
  const rawList = Array.isArray(body?.logs) ? body.logs : body?.message ? [body] : [];
  for (const item of rawList) {
    const message = String(item?.message || item?.msg || "").slice(0, 4000);
    if (!message) continue;
    const tsMs = nanoOrMsToMs(item.timestampMs ?? item.timestamp ?? item.ts, nowMs);
    const labels: Record<string, string> = {};
    if (item.labels && typeof item.labels === "object") {
      for (const [k, v] of Object.entries(item.labels)) labels[String(k)] = String(v);
    }
    entries.push({
      level: detectLogLevel(item.level, message),
      serviceName: String(item.serviceName || item.service || "app").slice(0, 80),
      message,
      labels,
      traceId: item.traceId ? String(item.traceId).slice(0, 64) : null,
      timestampMs: tsMs,
      timestampIso: new Date(tsMs).toISOString(),
    });
  }

  return entries;
}
