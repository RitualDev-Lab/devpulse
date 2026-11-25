import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { errorEvents, otelSpans, otelTraces } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { hashApiKey, verifyTelemetryApiKey } from "@/lib/security/api-keys";
import { checkRateLimit } from "@/lib/security/rate-limit";
import { parseOtlpTracePayload } from "@/lib/traces/otlp-parser";
import { scrubTelemetryText, scrubTelemetryValue } from "@/lib/security/ingest-scrub";

export const dynamic = "force-dynamic";

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization, x-devpulse-key",
    },
  });
}

/**
 * POST /api/v1/ingest/otlp/traces
 * OpenTelemetry OTLP/HTTP JSON trace collector endpoint.
 * Accepts standard ExportTraceServiceRequest payloads and stores spans in Turso.
 */
export async function POST(req: NextRequest) {
  try {
    const authHeader = req.headers.get("authorization");
    const rawKey =
      authHeader?.replace(/^Bearer\s+/i, "") ||
      req.headers.get("x-devpulse-key") ||
      "";

    if (!rawKey.trim()) {
      return NextResponse.json(
        { error: "Missing DevPulse telemetry API key (Authorization: Bearer <key>)" },
        { status: 401 }
      );
    }

    const keyHashPrefix = (await hashApiKey(rawKey)).slice(0, 16);
    const rl = await checkRateLimit({
      key: `otlp:${keyHashPrefix}`,
      limit: 600,
      windowSeconds: 60,
    });
    if (!rl.allowed) {
      return NextResponse.json(
        { error: "OTLP trace rate limit exceeded", retryAfterSeconds: rl.retryAfterSeconds },
        { status: 429 }
      );
    }

    const project = await verifyTelemetryApiKey(rawKey);
    if (!project) {
      return NextResponse.json({ error: "Invalid or revoked telemetry API key" }, { status: 403 });
    }

    let body: any;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "Invalid OTLP JSON payload" }, { status: 400 });
    }

    const traces = parseOtlpTracePayload(body);
    if (traces.length === 0) {
      return NextResponse.json({ partialSuccess: { rejectedSpans: 0 } }, { status: 200 });
    }

    let totalSpansStored = 0;

    for (const tr of traces.slice(0, 20)) {
      // Check if an error event already shares this traceId so we link trace <-> crash bi-directionally
      const [linkedErr] = await db
        .select({ id: errorEvents.id })
        .from(errorEvents)
        .where(and(eq(errorEvents.projectId, project.id), eq(errorEvents.traceId, tr.traceId)))
        .limit(1);

      const [existingTrace] = await db
        .select({ id: otelTraces.id, spanCount: otelTraces.spanCount, durationMs: otelTraces.durationMs })
        .from(otelTraces)
        .where(and(eq(otelTraces.projectId, project.id), eq(otelTraces.traceId, tr.traceId)))
        .limit(1);

      if (existingTrace) {
        await db
          .update(otelTraces)
          .set({
            spanCount: existingTrace.spanCount + tr.spanCount,
            durationMs: Math.max(existingTrace.durationMs, tr.durationMs),
            ...(tr.status === "error" ? { status: "error" } : {}),
            ...(linkedErr ? { linkedErrorId: linkedErr.id } : {}),
          })
          .where(eq(otelTraces.id, existingTrace.id));
      } else {
        await db.insert(otelTraces).values({
          id: `trc_${crypto.randomUUID().replace(/-/g, "").slice(0, 14)}`,
          projectId: project.id,
          traceId: tr.traceId,
          serviceName: tr.serviceName,
          rootSpanName: tr.rootSpanName,
          status: tr.status,
          spanCount: tr.spanCount,
          durationMs: tr.durationMs,
          startedAt: tr.startedAt,
          httpMethod: tr.httpMethod,
          httpRoute: tr.httpRoute,
          httpStatusCode: tr.httpStatusCode,
          linkedErrorId: linkedErr?.id || null,
        });
      }

      const spanBatch = tr.spans.slice(0, 100).map((sp) => ({
        id: `spn_${crypto.randomUUID().replace(/-/g, "").slice(0, 14)}`,
        projectId: project.id,
        traceId: sp.traceId,
        spanId: sp.spanId,
        parentSpanId: sp.parentSpanId,
        serviceName: sp.serviceName,
        spanName: scrubTelemetryText(sp.spanName),
        kind: sp.kind,
        statusCode: sp.statusCode,
        statusMessage: sp.statusMessage == null ? sp.statusMessage : scrubTelemetryText(String(sp.statusMessage)),
        startTimeMs: sp.startTimeMs,
        endTimeMs: sp.endTimeMs,
        durationMs: sp.durationMs,
        attributesJson: JSON.stringify(scrubTelemetryValue(sp.attributes)).slice(0, 4000),
        eventsJson: sp.events.length > 0 ? JSON.stringify(scrubTelemetryValue(sp.events)).slice(0, 4000) : null,
      }));

      if (spanBatch.length > 0) {
        await db.insert(otelSpans).values(spanBatch);
        totalSpansStored += spanBatch.length;
      }
    }

    return NextResponse.json(
      {
        partialSuccess: {},
        ingestedTraces: traces.length,
        ingestedSpans: totalSpansStored,
      },
      {
        status: 200,
        headers: { "Access-Control-Allow-Origin": "*" },
      }
    );
  } catch (err) {
    console.error("POST /api/v1/ingest/otlp/traces error:", err);
    return NextResponse.json({ error: "Failed to ingest OTLP traces" }, { status: 500 });
  }
}
