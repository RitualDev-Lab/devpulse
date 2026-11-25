import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { uptimeChecks, uptimeMonitors } from "@/db/schema";
import { and, desc, eq } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth";
import { resolveProjectAccess } from "@/lib/security/rbac";
import { recordAuditEvent } from "@/lib/security/audit";
import {
  computeP95Latency,
  computeUptimeBasisPoints,
  isValidPublicMonitorUrl,
  runMonitorCheck,
} from "@/lib/monitors/checker";
import { isPublicDemoProject } from "@/lib/security/demo-project";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const projectId = req.nextUrl.searchParams.get("projectId");
    if (!projectId) {
      return NextResponse.json({ error: "Missing projectId" }, { status: 400 });
    }

    if (!isPublicDemoProject(projectId)) {
      const user = await getCurrentUser();
      if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      const access = await resolveProjectAccess(projectId, user);
      if (!access) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const monitors = await db
      .select()
      .from(uptimeMonitors)
      .where(eq(uptimeMonitors.projectId, projectId))
      .orderBy(desc(uptimeMonitors.createdAt))
      .limit(25);

    const recentChecks = await db
      .select()
      .from(uptimeChecks)
      .where(eq(uptimeChecks.projectId, projectId))
      .orderBy(desc(uptimeChecks.checkedAt))
      .limit(80);

    const overallP95Ms = computeP95Latency(recentChecks.map((c) => c.latencyMs));
    const overallUptimeBp = computeUptimeBasisPoints(recentChecks.map((c) => c.status));

    return NextResponse.json({
      monitors,
      recentChecks: recentChecks.slice(0, 40).reverse(),
      summary: {
        totalMonitors: monitors.length,
        upCount: monitors.filter((m) => m.lastStatus === "up").length,
        degradedCount: monitors.filter((m) => m.lastStatus === "degraded").length,
        downCount: monitors.filter((m) => m.lastStatus === "down").length,
        overallP95Ms,
        overallUptimePercent: (overallUptimeBp / 100).toFixed(2),
      },
    });
  } catch (err: any) {
    console.error("GET /api/v1/monitors error:", err);
    return NextResponse.json({ error: "Failed to load monitors" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const projectId = String(body.projectId || "");
    const action = String(body.action || "create");

    if (!projectId) {
      return NextResponse.json({ error: "Missing projectId" }, { status: 400 });
    }

    const access = await resolveProjectAccess(projectId, user);
    if (!access || !access.canWrite) {
      return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });
    }

    if (action === "create") {
      const name = String(body.name || "Health Endpoint").trim().slice(0, 80);
      const rawUrl = String(body.url || "");
      const method = ["GET", "HEAD", "POST"].includes(body.method) ? body.method : "GET";
      const expectedStatus = Math.max(100, Math.min(599, Number(body.expectedStatus || 200)));
      const intervalMinutes = Math.max(1, Math.min(60, Number(body.intervalMinutes || 5)));

      const urlCheck = isValidPublicMonitorUrl(rawUrl);
      if (!urlCheck.valid || !urlCheck.normalized) {
        return NextResponse.json({ error: urlCheck.reason || "Invalid monitor URL" }, { status: 400 });
      }

      const id = `mon_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
      await db.insert(uptimeMonitors).values({
        id,
        projectId,
        name,
        url: urlCheck.normalized,
        method,
        expectedStatus,
        intervalMinutes,
        isActive: true,
        lastStatus: "pending",
        alertOnDown: body.alertOnDown !== false,
      });

      // Perform immediate initial heartbeat check so dashboard gets real latency right away
      const initialCheck = await runMonitorCheck(id, "instant").catch(() => null);

      await recordAuditEvent({
        userId: user.id,
        actorUsername: user.githubUsername,
        organizationId: access.project.organizationId,
        projectId,
        action: "monitor.create",
        resourceType: "uptime_monitor",
        resourceId: id,
        metadata: { name, url: urlCheck.normalized, expectedStatus },
      });

      return NextResponse.json({ success: true, monitorId: id, initialCheck }, { status: 201 });
    }

    if (action === "ping") {
      const monitorId = String(body.monitorId || "");
      if (!monitorId) {
        return NextResponse.json({ error: "Missing monitorId" }, { status: 400 });
      }
      const [mon] = await db
        .select()
        .from(uptimeMonitors)
        .where(and(eq(uptimeMonitors.id, monitorId), eq(uptimeMonitors.projectId, projectId)))
        .limit(1);
      if (!mon) {
        return NextResponse.json({ error: "Monitor not found" }, { status: 404 });
      }
      const result = await runMonitorCheck(monitorId, "manual");
      return NextResponse.json({ success: true, result });
    }

    if (action === "toggle") {
      const monitorId = String(body.monitorId || "");
      const isActive = Boolean(body.isActive);
      await db
        .update(uptimeMonitors)
        .set({ isActive, updatedAt: new Date().toISOString() })
        .where(and(eq(uptimeMonitors.id, monitorId), eq(uptimeMonitors.projectId, projectId)));
      return NextResponse.json({ success: true, isActive });
    }

    if (action === "delete") {
      const monitorId = String(body.monitorId || "");
      await db
        .delete(uptimeMonitors)
        .where(and(eq(uptimeMonitors.id, monitorId), eq(uptimeMonitors.projectId, projectId)));

      await recordAuditEvent({
        userId: user.id,
        actorUsername: user.githubUsername,
        organizationId: access.project.organizationId,
        projectId,
        action: "monitor.delete",
        resourceType: "uptime_monitor",
        resourceId: monitorId,
      });

      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ error: "Unsupported monitor action" }, { status: 400 });
  } catch (err: any) {
    console.error("POST /api/v1/monitors error:", err);
    return NextResponse.json({ error: "Monitor operation failed" }, { status: 500 });
  }
}
