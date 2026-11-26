import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { errorEvents, otelSpans, otelTraces } from "@/db/schema";
import { and, asc, desc, eq } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth";
import { resolveProjectAccess } from "@/lib/security/rbac";
import { parseOtlpTracePayload } from "@/lib/traces/otlp-parser";
import { isPublicDemoProject } from "@/lib/security/demo-project";
import { verifyTelemetryApiKey } from "@/lib/security/api-keys";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const apiKey = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim();
    let projectId = req.nextUrl.searchParams.get("projectId")?.trim() || "";
    const traceId = req.nextUrl.searchParams.get("traceId");

    if (apiKey) {
      const verified = await verifyTelemetryApiKey(apiKey);
      if (!verified) return NextResponse.json({ error: "Invalid API key" }, { status: 401 });
      if (projectId && projectId !== verified.id) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      projectId = verified.id;
    }
    if (!projectId) {
      return NextResponse.json({ error: "Missing projectId" }, { status: 400 });
    }

    if (!apiKey && !isPublicDemoProject(projectId)) {
      const user = await getCurrentUser();
      if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      const access = await resolveProjectAccess(projectId, user);
      if (!access) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    if (traceId) {
      const [[trace], spans, linkedErrors] = await Promise.all([
        db
          .select()
          .from(otelTraces)
          .where(and(eq(otelTraces.projectId, projectId), eq(otelTraces.traceId, traceId)))
          .limit(1),
        db
          .select()
          .from(otelSpans)
          .where(and(eq(otelSpans.projectId, projectId), eq(otelSpans.traceId, traceId)))
          .orderBy(asc(otelSpans.startTimeMs))
          .limit(200),
        db
          .select({
            id: errorEvents.id,
            errorName: errorEvents.errorName,
            message: errorEvents.message,
            runtime: errorEvents.runtime,
            version: errorEvents.version,
            routePath: errorEvents.routePath,
            createdAt: errorEvents.createdAt,
          })
          .from(errorEvents)
          .where(and(eq(errorEvents.projectId, projectId), eq(errorEvents.traceId, traceId)))
          .limit(10),
      ]);

      return NextResponse.json({
        trace: trace || null,
        spans,
        linkedErrors,
      });
    }

    const traces = await db
      .select()
      .from(otelTraces)
      .where(eq(otelTraces.projectId, projectId))
      .orderBy(desc(otelTraces.startedAt))
      .limit(40);

    return NextResponse.json({ traces });
  } catch (err) {
    console.error("GET /api/v1/traces error:", err);
    return NextResponse.json({ error: "Failed to load distributed traces" }, { status: 500 });
  }
}

/**
 * POST /api/v1/traces
 * Sends an interactive sample distributed trace (API Gateway -> Auth -> Postgres -> Stripe)
 * so developers can verify flame graph rendering immediately.
 */
export async function POST(req: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await req.json();
    const projectId = String(body.projectId || "");
    if (!projectId) return NextResponse.json({ error: "Missing projectId" }, { status: 400 });

    const access = await resolveProjectAccess(projectId, user);
    if (!access || !access.canWrite) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const traceId = crypto.randomUUID().replace(/-/g, "");
    const t0 = Date.now() - 420;
    const rootId = "spn_root_0001";
    const authId = "spn_auth_0002";
    const dbId = "spn_pg_0003";
    const stripeId = "spn_pay_0004";

    const parsed = parseOtlpTracePayload({
      traceId,
      spans: [
        {
          spanId: rootId,
          serviceName: `${access.project.slug}-web`,
          spanName: "POST /api/checkout",
          kind: "SERVER",
          startTimeMs: t0,
          endTimeMs: t0 + 384,
          status: "ERROR",
          attributes: {
            "http.request.method": "POST",
            "http.route": "/api/checkout",
            "http.response.status_code": 502,
          },
        },
        {
          spanId: authId,
          parentSpanId: rootId,
          serviceName: "auth-edge",
          spanName: "verifySessionJwt",
          kind: "CLIENT",
          startTimeMs: t0 + 12,
          endTimeMs: t0 + 48,
          status: "OK",
          attributes: { "auth.provider": "saml_sso" },
        },
        {
          spanId: dbId,
          parentSpanId: rootId,
          serviceName: "turso-db",
          spanName: "SELECT * FROM workspaces WHERE id = ?",
          kind: "CLIENT",
          startTimeMs: t0 + 52,
          endTimeMs: t0 + 128,
          status: "OK",
          attributes: { "db.system": "sqlite", "db.statement": "SELECT * FROM workspaces WHERE id = ?" },
        },
        {
          spanId: stripeId,
          parentSpanId: rootId,
          serviceName: "billing-worker",
          spanName: "stripe.paymentIntents.create",
          kind: "CLIENT",
          startTimeMs: t0 + 135,
          endTimeMs: t0 + 376,
          status: "ERROR",
          statusMessage: "Upstream gateway timeout after 241ms",
          attributes: { "rpc.service": "StripeAPI", "error.type": "GatewayTimeout" },
        },
      ],
    });

    const tr = parsed[0];
    await db.insert(otelTraces).values({
      id: `trc_${crypto.randomUUID().replace(/-/g, "").slice(0, 14)}`,
      projectId,
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
    });

    await db.insert(otelSpans).values(
      tr.spans.map((sp) => ({
        id: `spn_${crypto.randomUUID().replace(/-/g, "").slice(0, 14)}`,
        projectId,
        traceId: sp.traceId,
        spanId: sp.spanId,
        parentSpanId: sp.parentSpanId,
        serviceName: sp.serviceName,
        spanName: sp.spanName,
        kind: sp.kind,
        statusCode: sp.statusCode,
        statusMessage: sp.statusMessage,
        startTimeMs: sp.startTimeMs,
        endTimeMs: sp.endTimeMs,
        durationMs: sp.durationMs,
        attributesJson: JSON.stringify(sp.attributes),
        eventsJson: null,
      }))
    );

    return NextResponse.json({ success: true, traceId: tr.traceId }, { status: 201 });
  } catch (err) {
    console.error("POST /api/v1/traces error:", err);
    return NextResponse.json({ error: "Failed to record sample trace" }, { status: 500 });
  }
}
