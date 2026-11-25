import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { structuredLogs } from "@/db/schema";
import { hashApiKey, verifyTelemetryApiKey } from "@/lib/security/api-keys";
import { checkRateLimit } from "@/lib/security/rate-limit";
import { parseLokiOrStructuredLogs } from "@/lib/logs/loki-parser";

export const dynamic = "force-dynamic";

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Scope-OrgID",
    },
  });
}

/**
 * POST /api/v1/loki/api/v1/push
 * Grafana Loki-compatible Push API endpoint for Promtail, Vector, Winston, Pino & SDK logs.
 */
export async function POST(req: NextRequest) {
  try {
    const rawKey =
      req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ||
      req.headers.get("x-devpulse-key") ||
      req.nextUrl.searchParams.get("apiKey") ||
      "";

    if (!rawKey.trim()) {
      return NextResponse.json({ error: "Missing telemetry API key" }, { status: 401 });
    }

    const prefix = (await hashApiKey(rawKey)).slice(0, 16);
    const rl = await checkRateLimit({ key: `loki:${prefix}`, limit: 1200, windowSeconds: 60 });
    if (!rl.allowed) {
      return NextResponse.json({ error: "Log rate limit exceeded" }, { status: 429 });
    }

    const project = await verifyTelemetryApiKey(rawKey);
    if (!project) {
      return NextResponse.json({ error: "Invalid telemetry API key" }, { status: 403 });
    }

    const body = await req.json();
    const entries = parseLokiOrStructuredLogs(body).slice(0, 200);
    if (entries.length === 0) {
      return new NextResponse(null, { status: 204 });
    }

    await db.insert(structuredLogs).values(
      entries.map((e) => ({
        id: `log_${crypto.randomUUID().replace(/-/g, "").slice(0, 14)}`,
        projectId: project.id,
        level: e.level,
        serviceName: e.serviceName,
        message: e.message,
        labelsJson: JSON.stringify(e.labels).slice(0, 2000),
        traceId: e.traceId,
        timestampMs: e.timestampMs,
        timestampIso: e.timestampIso,
      }))
    );

    // Loki Push API spec returns 204 No Content on success
    return new NextResponse(null, {
      status: 204,
      headers: { "Access-Control-Allow-Origin": "*" },
    });
  } catch (err) {
    console.error("POST /api/v1/loki/api/v1/push error:", err);
    return NextResponse.json({ error: "Failed to ingest Loki logs" }, { status: 500 });
  }
}
