import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { errorEvents, workspaces } from "@/db/schema";
import { and, eq, lt, sql } from "drizzle-orm";
import { verifyTelemetryApiKey, hashApiKey } from "@/lib/security/api-keys";
import { checkRateLimit } from "@/lib/security/rate-limit";
import { getMaxEventBytes, readBoundedRequestText, reserveAtomicEventQuotaSlot } from "@/lib/validation/event-ingest";
import { extractSentryKeyFromHeaders, parseSentryEnvelope } from "@/lib/telemetry/sentry-envelope";
import { computeSemanticGroupKey } from "@/lib/crashes/impact";

export const dynamic = "force-dynamic";

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ projectId: string }> }
) {
  const { projectId } = await context.params;
  const maxBytes = getMaxEventBytes();
  const sentryKey = extractSentryKeyFromHeaders(req.headers, req.nextUrl.searchParams.get("sentry_key"));

  if (!sentryKey) {
    return NextResponse.json({ error: "Missing sentry_key or Authorization header" }, { status: 401 });
  }

  const keyHashPrefix = (await hashApiKey(sentryKey)).slice(0, 16);
  const rl = await checkRateLimit({
    key: `sentry_env:${keyHashPrefix}`,
    limit: 500,
    windowSeconds: 60,
  });
  if (!rl.allowed) {
    return NextResponse.json({ error: "Rate limit exceeded" }, { status: 429 });
  }

  const bounded = await readBoundedRequestText(req, maxBytes);
  if (!bounded.ok) {
    return NextResponse.json({ error: bounded.error }, { status: bounded.status });
  }

  const project = await verifyTelemetryApiKey(sentryKey);
  if (!project || (projectId && project.id !== projectId && project.slug !== projectId)) {
    return NextResponse.json({ error: "Invalid telemetry key for target project" }, { status: 403 });
  }

  const parsed = parseSentryEnvelope(bounded.text);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  if (project.workspaceId) {
    const wsId = project.workspaceId;
    const slot = await reserveAtomicEventQuotaSlot(async () => {
      const [row] = await db
        .update(workspaces)
        .set({ monthlyEventsUsed: sql`${workspaces.monthlyEventsUsed} + 1` })
        .where(and(eq(workspaces.id, wsId), lt(workspaces.monthlyEventsUsed, workspaces.monthlyEventLimit)))
        .returning({ id: workspaces.id });
      return Boolean(row);
    });
    if (!slot.allowed) {
      return NextResponse.json({ error: "Workspace monthly event limit exceeded" }, { status: 429 });
    }
  }

  let ingested = 0;
  for (const ev of parsed.events.slice(0, 20)) {
    if (ev.itemType === "event") {
      await db.insert(errorEvents).values({
        id: `sen_${ev.eventId.slice(0, 20)}`,
        projectId: project.id,
        errorName: ev.errorName,
        message: ev.message,
        stackTrace: ev.stackTrace.slice(0, 2000),
        runtime: ev.runtime,
        version: ev.version,
        environment: ev.environment,
        status: "unresolved",
        routePath: ev.routePath,
        aiGroupKey: computeSemanticGroupKey(ev.errorName, ev.message, ev.stackTrace),
        createdAt: ev.timestampIso,
      });
      ingested++;
    }
  }

  return NextResponse.json({ id: parsed.events[0]?.eventId || "accepted", ingested }, { status: 200 });
}
