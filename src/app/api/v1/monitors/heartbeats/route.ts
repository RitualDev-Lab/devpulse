import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { db } from "@/db";
import { projectConnectors } from "@/db/schema";
import { and, desc, eq } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth";
import { resolveProjectAccess } from "@/lib/security/rbac";
import { isPublicDemoProject } from "@/lib/security/demo-project";
import { parseHeartbeatMetadata, type CronHeartbeatMetadata } from "@/lib/monitors/heartbeat";
import { recordAuditEvent } from "@/lib/security/audit";
import { PUBLIC_APP_URL } from "@/lib/config/app-url";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const projectId = req.nextUrl.searchParams.get("projectId") || "";
    if (!projectId) return NextResponse.json({ error: "Missing projectId" }, { status: 400 });

    if (!isPublicDemoProject(projectId)) {
      const user = await getCurrentUser();
      if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      const access = await resolveProjectAccess(projectId, user);
      if (!access) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const rows = await db
      .select()
      .from(projectConnectors)
      .where(
        and(
          eq(projectConnectors.projectId, projectId),
          eq(projectConnectors.category, "telemetry"),
          eq(projectConnectors.provider, "cron_heartbeat")
        )
      )
      .orderBy(desc(projectConnectors.createdAt))
      .limit(30);

    const heartbeats = rows.map((r) => {
      const meta = parseHeartbeatMetadata(r.metadataJson);
      return {
        id: r.id,
        name: r.label,
        monitorKey: r.identifier,
        pingUrl: `${PUBLIC_APP_URL}/api/v1/ping/${r.identifier}`,
        ...meta,
      };
    });

    return NextResponse.json({ heartbeats });
  } catch (err) {
    console.error("GET /api/v1/monitors/heartbeats error:", err);
    return NextResponse.json({ error: "Failed to load cron heartbeats" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await req.json();
    const projectId = String(body.projectId || "");
    const action = String(body.action || "create");
    if (!projectId) return NextResponse.json({ error: "Missing projectId" }, { status: 400 });

    const access = await resolveProjectAccess(projectId, user);
    if (!access || !access.canWrite) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    if (action === "delete") {
      const id = String(body.id || "");
      await db
        .delete(projectConnectors)
        .where(
          and(
            eq(projectConnectors.id, id),
            eq(projectConnectors.projectId, projectId),
            eq(projectConnectors.provider, "cron_heartbeat")
          )
        );
      return NextResponse.json({ success: true });
    }

    const name = String(body.name || "").trim().slice(0, 80);
    if (!name) return NextResponse.json({ error: "Monitor name required" }, { status: 400 });

    const intervalMinutes = Math.max(1, Math.min(43200, Number(body.intervalMinutes || 60)));
    const graceMinutes = Math.max(1, Math.min(1440, Number(body.graceMinutes || 5)));
    const maxDurationSeconds =
      body.maxDurationSeconds && Number(body.maxDurationSeconds) > 0
        ? Math.min(86400, Number(body.maxDurationSeconds))
        : null;

    const monitorKey = `hb_${crypto.randomBytes(10).toString("hex")}`;
    const id = `con_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
    const nowMs = Date.now();
    const initialMeta: CronHeartbeatMetadata = {
      intervalMinutes,
      graceMinutes,
      maxDurationSeconds,
      state: "pending",
      startedAt: null,
      lastPingAt: null,
      lastDurationMs: null,
      nextDueAt: new Date(nowMs + intervalMinutes * 60 * 1000).toISOString(),
      alertSent: false,
      lastMessage: null,
    };

    await db.insert(projectConnectors).values({
      id,
      projectId,
      category: "telemetry",
      provider: "cron_heartbeat",
      label: name,
      targetUrl: `/api/v1/ping/${monitorKey}`,
      identifier: monitorKey,
      metadataJson: JSON.stringify(initialMeta),
      lastSyncedAt: new Date(nowMs).toISOString(),
    });

    await recordAuditEvent({
      userId: user.id,
      actorUsername: user.githubUsername,
      organizationId: access.project.organizationId,
      projectId,
      action: "monitor.heartbeat_created",
      resourceType: "project_connector",
      resourceId: id,
      headers: req.headers,
      metadata: { name, intervalMinutes, graceMinutes },
    });

    return NextResponse.json(
      {
        success: true,
        heartbeat: {
          id,
          name,
          monitorKey,
          pingUrl: `${PUBLIC_APP_URL}/api/v1/ping/${monitorKey}`,
          ...initialMeta,
        },
      },
      { status: 201 }
    );
  } catch (err) {
    console.error("POST /api/v1/monitors/heartbeats error:", err);
    return NextResponse.json({ error: "Failed to save cron heartbeat" }, { status: 500 });
  }
}
