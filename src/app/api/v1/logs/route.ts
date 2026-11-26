import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { errorEvents, projectConnectors, structuredLogs } from "@/db/schema";
import { and, desc, eq, gte, lte, or } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth";
import { resolveProjectAccess } from "@/lib/security/rbac";
import { verifyTelemetryApiKey } from "@/lib/security/api-keys";
import { parseLokiOrStructuredLogs } from "@/lib/logs/loki-parser";
import { isPublicDemoProject } from "@/lib/security/demo-project";
import { scrubTelemetryText, scrubTelemetryValue } from "@/lib/security/ingest-scrub";
import { detectLogErrorSpike } from "@/lib/logs/spike-detector";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    let projectId = req.nextUrl.searchParams.get("projectId");
    const q = (req.nextUrl.searchParams.get("q") || "").trim().toLowerCase();
    const level = (req.nextUrl.searchParams.get("level") || "").trim().toLowerCase();
    const service = (req.nextUrl.searchParams.get("service") || "").trim().toLowerCase();
    const sinceMsRaw = Number(req.nextUrl.searchParams.get("sinceMs") || 0);
    const aroundErrorId = req.nextUrl.searchParams.get("aroundErrorId");

    const bearerKey = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim() || "";
    if (bearerKey) {
      const verified = await verifyTelemetryApiKey(bearerKey);
      if (!verified) return NextResponse.json({ error: "Invalid telemetry API key" }, { status: 401 });
      projectId = verified.id;
    } else {
      if (!projectId) {
        return NextResponse.json({ error: "Missing projectId" }, { status: 400 });
      }
      if (!isPublicDemoProject(projectId)) {
        const user = await getCurrentUser();
        if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        const access = await resolveProjectAccess(projectId, user);
        if (!access) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
    }

    // Correlate log lines right before a crash (default +-2000ms window, highlighting <= 500ms prior)
    if (aroundErrorId) {
      const [errRow] = await db
        .select()
        .from(errorEvents)
        .where(and(eq(errorEvents.id, aroundErrorId), eq(errorEvents.projectId, projectId)))
        .limit(1);

      if (!errRow) {
        return NextResponse.json({ logs: [], crashAtMs: null });
      }

      const crashMs = Date.parse(errRow.createdAt);
      const fromMs = crashMs - 2000;
      const toMs = crashMs + 500;

      const correlated = await db
        .select()
        .from(structuredLogs)
        .where(
          and(
            eq(structuredLogs.projectId, projectId),
            or(
              and(gte(structuredLogs.timestampMs, fromMs), lte(structuredLogs.timestampMs, toMs)),
              errRow.traceId ? eq(structuredLogs.traceId, errRow.traceId) : undefined
            )
          )
        )
        .orderBy(desc(structuredLogs.timestampMs))
        .limit(50);

      const annotated = correlated.reverse().map((l) => {
        const deltaMs = crashMs - l.timestampMs;
        return {
          ...l,
          msBeforeCrash: deltaMs,
          within500ms: deltaMs >= 0 && deltaMs <= 500,
        };
      });

      return NextResponse.json({
        crashAtMs: crashMs,
        crashAtIso: errRow.createdAt,
        logs: annotated,
      });
    }

    const [rawLogs, savedQueryRows] = await Promise.all([
      db
        .select()
        .from(structuredLogs)
        .where(eq(structuredLogs.projectId, projectId))
        .orderBy(desc(structuredLogs.timestampMs))
        .limit(250),
      db
        .select({
          id: projectConnectors.id,
          label: projectConnectors.label,
          metadataJson: projectConnectors.metadataJson,
        })
        .from(projectConnectors)
        .where(
          and(
            eq(projectConnectors.projectId, projectId),
            eq(projectConnectors.category, "telemetry"),
            eq(projectConnectors.provider, "saved_log_query")
          )
        )
        .limit(20),
    ]);

    const spikeAnalysis = detectLogErrorSpike(rawLogs);

    const filtered = rawLogs.filter((l) => {
      if (Number.isFinite(sinceMsRaw) && sinceMsRaw > 0 && l.timestampMs <= sinceMsRaw) return false;
      if (level && level !== "all" && l.level.toLowerCase() !== level) return false;
      if (service && service !== "all" && l.serviceName.toLowerCase() !== service) return false;
      if (q) {
        const hay = `${l.message} ${l.serviceName} ${l.labelsJson || ""} ${l.traceId || ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });

    const services = Array.from(new Set(rawLogs.map((l) => l.serviceName)));
    const savedQueries = savedQueryRows.map((row) => {
      let meta: { q?: string; level?: string; service?: string } = {};
      try {
        meta = row.metadataJson ? JSON.parse(row.metadataJson) : {};
      } catch {
        meta = {};
      }
      return {
        id: row.id,
        name: row.label,
        q: meta.q || "",
        level: meta.level || "all",
        service: meta.service || "all",
      };
    });

    return NextResponse.json({
      logs: filtered.slice(0, 120),
      services,
      totalMatched: filtered.length,
      spikeAnalysis,
      savedQueries,
    });
  } catch (err) {
    console.error("GET /api/v1/logs error:", err);
    return NextResponse.json({ error: "Failed to search logs" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    if (body.action === "save_query" && body.projectId) {
      const user = await getCurrentUser();
      if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      const access = await resolveProjectAccess(String(body.projectId), user);
      if (!access || !access.canWrite) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      const name = String(body.name || "").trim().slice(0, 60);
      if (!name) return NextResponse.json({ error: "Query name required" }, { status: 400 });
      const id = `lq_${crypto.randomUUID().replace(/-/g, "").slice(0, 14)}`;
      await db.insert(projectConnectors).values({
        id,
        projectId: access.project.id,
        category: "telemetry",
        provider: "saved_log_query",
        label: name,
        identifier: `query_${Date.now()}`,
        metadataJson: JSON.stringify({
          q: String(body.q || "").slice(0, 120),
          level: String(body.level || "all"),
          service: String(body.service || "all"),
        }),
      });
      return NextResponse.json({ success: true, id }, { status: 201 });
    }

    if (body.action === "delete_query" && body.projectId && body.id) {
      const user = await getCurrentUser();
      if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      const access = await resolveProjectAccess(String(body.projectId), user);
      if (!access || !access.canWrite) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      await db
        .delete(projectConnectors)
        .where(
          and(
            eq(projectConnectors.id, String(body.id)),
            eq(projectConnectors.projectId, access.project.id),
            eq(projectConnectors.provider, "saved_log_query")
          )
        );
      return NextResponse.json({ success: true });
    }

    // Sample emitter for authenticated dashboard users
    if (body.action === "emit_sample" && body.projectId) {
      const user = await getCurrentUser();
      if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      const access = await resolveProjectAccess(String(body.projectId), user);
      if (!access || !access.canWrite) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

      const now = Date.now();
      const traceId = crypto.randomUUID().replace(/-/g, "");
      const sampleLogs = [
        { level: "info", serviceName: "checkout-api", message: "Received POST /api/checkout from usr_91a", traceId, timestampMs: now - 420 },
        { level: "debug", serviceName: "turso-db", message: "Loaded workspace plan caps (latency=14ms)", traceId, timestampMs: now - 260 },
        { level: "warn", serviceName: "stripe-client", message: "Stripe PaymentIntent retry #1 (status=502)", traceId, timestampMs: now - 90 },
        { level: "error", serviceName: "checkout-api", message: "TypeError: Cannot read properties of undefined (reading 'client_secret')", traceId, timestampMs: now - 12 },
      ];

      await db.insert(structuredLogs).values(
        sampleLogs.map((s) => ({
          id: `log_${crypto.randomUUID().replace(/-/g, "").slice(0, 14)}`,
          projectId: access.project.id,
          level: s.level,
          serviceName: s.serviceName,
          message: s.message,
          labelsJson: JSON.stringify({ env: "production", region: "iad" }),
          traceId: s.traceId,
          timestampMs: s.timestampMs,
          timestampIso: new Date(s.timestampMs).toISOString(),
        }))
      );

      return NextResponse.json({ success: true, inserted: sampleLogs.length }, { status: 201 });
    }

    const rawKey =
      req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") || body.apiKey || "";
    const project = await verifyTelemetryApiKey(String(rawKey));
    if (!project) {
      return NextResponse.json({ error: "Invalid telemetry API key" }, { status: 403 });
    }

    const entries = parseLokiOrStructuredLogs(body).slice(0, 200);
    if (entries.length === 0) {
      return NextResponse.json({ success: true, inserted: 0 });
    }

    await db.insert(structuredLogs).values(
      entries.map((e) => ({
        id: `log_${crypto.randomUUID().replace(/-/g, "").slice(0, 14)}`,
        projectId: project.id,
        level: e.level,
        serviceName: e.serviceName,
        message: scrubTelemetryText(String(e.message)),
        labelsJson: JSON.stringify(e.labels).slice(0, 2000),
        traceId: e.traceId,
        timestampMs: e.timestampMs,
        timestampIso: e.timestampIso,
      }))
    );

    return NextResponse.json({ success: true, inserted: entries.length }, { status: 201 });
  } catch (err) {
    console.error("POST /api/v1/logs error:", err);
    return NextResponse.json({ error: "Failed to ingest structured logs" }, { status: 500 });
  }
}
