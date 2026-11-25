/**
 * OpenTelemetry (OTLP/HTTP JSON) Trace Parser & Span Normalizer
 * Supports standard OTLP ExportTraceServiceRequest (resourceSpans -> scopeSpans -> spans)
 * as well as DevPulse simplified span batches.
 */

export interface NormalizedOtelSpan {
  traceId: string;
  spanId: string;
  parentSpanId: string | null;
  serviceName: string;
  spanName: string;
  kind: string;
  statusCode: "OK" | "ERROR" | "UNSET";
  statusMessage: string | null;
  startTimeMs: number;
  endTimeMs: number;
  durationMs: number;
  attributes: Record<string, unknown>;
  events: Array<{ name: string; timeMs: number; attributes?: Record<string, unknown> }>;
}

export interface NormalizedTraceSummary {
  traceId: string;
  serviceName: string;
  rootSpanName: string;
  status: "ok" | "error" | "unset";
  spanCount: number;
  durationMs: number;
  startedAt: string;
  httpMethod: string | null;
  httpRoute: string | null;
  httpStatusCode: number | null;
  spans: NormalizedOtelSpan[];
}

function decodeOtlpAnyValue(val: any): unknown {
  if (!val || typeof val !== "object") return val;
  if ("stringValue" in val) return String(val.stringValue);
  if ("intValue" in val) return Number(val.intValue);
  if ("doubleValue" in val) return Number(val.doubleValue);
  if ("boolValue" in val) return Boolean(val.boolValue);
  if ("arrayValue" in val && Array.isArray(val.arrayValue?.values)) {
    return val.arrayValue.values.map(decodeOtlpAnyValue);
  }
  return val;
}

function decodeOtlpAttributes(attrs: any): Record<string, unknown> {
  if (!attrs) return {};
  if (!Array.isArray(attrs) && typeof attrs === "object") {
    return attrs as Record<string, unknown>;
  }
  const out: Record<string, unknown> = {};
  for (const item of attrs) {
    if (item && typeof item.key === "string") {
      out[item.key] = decodeOtlpAnyValue(item.value);
    }
  }
  return out;
}

function nanoToMs(nanoInput: unknown, fallbackMs: number): number {
  if (typeof nanoInput === "number" && Number.isFinite(nanoInput)) {
    // Heuristic: if already milliseconds (~1.7e12), keep; if nanoseconds (~1.7e18), divide by 1e6
    return nanoInput > 1e15 ? Math.round(nanoInput / 1_000_000) : Math.round(nanoInput);
  }
  if (typeof nanoInput === "string" && /^\d+$/.test(nanoInput.trim())) {
    const big = BigInt(nanoInput.trim());
    if (big > BigInt(1e15)) {
      return Number(big / BigInt(1_000_000));
    }
    return Number(big);
  }
  return fallbackMs;
}

function mapSpanKind(kind: unknown): string {
  if (typeof kind === "string") return kind.toUpperCase();
  switch (Number(kind)) {
    case 1:
      return "INTERNAL";
    case 2:
      return "SERVER";
    case 3:
      return "CLIENT";
    case 4:
      return "PRODUCER";
    case 5:
      return "CONSUMER";
    default:
      return "INTERNAL";
  }
}

function mapStatusCode(status: any): { code: "OK" | "ERROR" | "UNSET"; message: string | null } {
  if (!status) return { code: "OK", message: null };
  const raw = status.code ?? status.statusCode ?? status;
  const msg = status.message ? String(status.message).slice(0, 500) : null;
  if (raw === 2 || String(raw).toUpperCase().includes("ERROR")) {
    return { code: "ERROR", message: msg };
  }
  if (raw === 1 || String(raw).toUpperCase().includes("OK")) {
    return { code: "OK", message: msg };
  }
  return { code: "OK", message: msg };
}

/**
 * Parses an incoming OTLP JSON ExportTraceServiceRequest or simplified span array
 * and groups spans by traceId.
 */
export function parseOtlpTracePayload(body: any): NormalizedTraceSummary[] {
  const flatSpans: NormalizedOtelSpan[] = [];
  const nowMs = Date.now();

  if (Array.isArray(body?.resourceSpans)) {
    for (const rs of body.resourceSpans) {
      const resourceAttrs = decodeOtlpAttributes(rs?.resource?.attributes);
      const serviceName =
        String(resourceAttrs["service.name"] || rs?.serviceName || "unknown-service").slice(0, 100);

      const scopeSpans = Array.isArray(rs?.scopeSpans)
        ? rs.scopeSpans
        : Array.isArray(rs?.instrumentationLibrarySpans)
        ? rs.instrumentationLibrarySpans
        : [];

      for (const ss of scopeSpans) {
        const spans = Array.isArray(ss?.spans) ? ss.spans : [];
        for (const sp of spans) {
          const traceId = String(sp?.traceId || sp?.trace_id || "").trim();
          const spanId = String(sp?.spanId || sp?.span_id || "").trim();
          if (!traceId || !spanId) continue;

          const startTimeMs = nanoToMs(sp.startTimeUnixNano ?? sp.startTimeMs, nowMs);
          const endTimeMs = Math.max(
            startTimeMs,
            nanoToMs(sp.endTimeUnixNano ?? sp.endTimeMs, startTimeMs + 1)
          );
          const { code, message } = mapStatusCode(sp.status);
          const attrs = { ...resourceAttrs, ...decodeOtlpAttributes(sp.attributes) };
          const events = Array.isArray(sp.events)
            ? sp.events.map((ev: any) => ({
                name: String(ev?.name || "event"),
                timeMs: nanoToMs(ev?.timeUnixNano ?? ev?.timeMs, startTimeMs),
                attributes: decodeOtlpAttributes(ev?.attributes),
              }))
            : [];

          flatSpans.push({
            traceId,
            spanId,
            parentSpanId: sp.parentSpanId || sp.parent_span_id || null,
            serviceName,
            spanName: String(sp.name || "span").slice(0, 180),
            kind: mapSpanKind(sp.kind),
            statusCode: code,
            statusMessage: message,
            startTimeMs,
            endTimeMs,
            durationMs: Math.max(1, endTimeMs - startTimeMs),
            attributes: attrs,
            events,
          });
        }
      }
    }
  } else if (Array.isArray(body?.spans)) {
    // Simplified DevPulse JSON format: { traceId?, serviceName?, spans: [...] }
    const defaultTraceId = String(body.traceId || crypto.randomUUID().replace(/-/g, ""));
    const defaultService = String(body.serviceName || "app-service");
    for (const sp of body.spans) {
      const traceId = String(sp.traceId || defaultTraceId);
      const spanId = String(sp.spanId || crypto.randomUUID().replace(/-/g, "").slice(0, 16));
      const startTimeMs = nanoToMs(sp.startTimeMs ?? sp.startTimeUnixNano, nowMs);
      const endTimeMs = Math.max(
        startTimeMs + (Number(sp.durationMs) || 1),
        nanoToMs(sp.endTimeMs ?? sp.endTimeUnixNano, startTimeMs + (Number(sp.durationMs) || 1))
      );
      const { code, message } = mapStatusCode(sp.status ?? sp.statusCode);
      flatSpans.push({
        traceId,
        spanId,
        parentSpanId: sp.parentSpanId || null,
        serviceName: String(sp.serviceName || defaultService).slice(0, 100),
        spanName: String(sp.spanName || sp.name || "span").slice(0, 180),
        kind: mapSpanKind(sp.kind),
        statusCode: code,
        statusMessage: message,
        startTimeMs,
        endTimeMs,
        durationMs: Math.max(1, endTimeMs - startTimeMs),
        attributes: decodeOtlpAttributes(sp.attributes),
        events: Array.isArray(sp.events) ? sp.events : [],
      });
    }
  }

  // Group normalized spans by traceId
  const byTrace = new Map<string, NormalizedOtelSpan[]>();
  for (const sp of flatSpans) {
    const list = byTrace.get(sp.traceId) || [];
    list.push(sp);
    byTrace.set(sp.traceId, list);
  }

  const traces: NormalizedTraceSummary[] = [];
  for (const [traceId, spans] of byTrace.entries()) {
    spans.sort((a, b) => a.startTimeMs - b.startTimeMs);
    const minStart = Math.min(...spans.map((s) => s.startTimeMs));
    const maxEnd = Math.max(...spans.map((s) => s.endTimeMs));
    const rootSpan = spans.find((s) => !s.parentSpanId) || spans[0];
    const hasError = spans.some((s) => s.statusCode === "ERROR");

    const httpMethod =
      (rootSpan.attributes["http.request.method"] ||
        rootSpan.attributes["http.method"] ||
        null) as string | null;
    const httpRoute =
      (rootSpan.attributes["http.route"] ||
        rootSpan.attributes["url.path"] ||
        rootSpan.attributes["http.target"] ||
        null) as string | null;
    const rawHttpCode =
      rootSpan.attributes["http.response.status_code"] ??
      rootSpan.attributes["http.status_code"];
    const httpStatusCode =
      rawHttpCode !== undefined && Number.isFinite(Number(rawHttpCode))
        ? Number(rawHttpCode)
        : null;

    traces.push({
      traceId,
      serviceName: rootSpan.serviceName,
      rootSpanName: rootSpan.spanName,
      status: hasError ? "error" : "ok",
      spanCount: spans.length,
      durationMs: Math.max(1, maxEnd - minStart),
      startedAt: new Date(minStart).toISOString(),
      httpMethod: httpMethod ? String(httpMethod).slice(0, 16) : null,
      httpRoute: httpRoute ? String(httpRoute).slice(0, 200) : null,
      httpStatusCode,
      spans,
    });
  }

  return traces;
}
