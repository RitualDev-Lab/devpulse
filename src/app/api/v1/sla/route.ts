import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { projects, uptimeChecks, uptimeIncidents, uptimeMonitors } from "@/db/schema";
import { and, desc, eq } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth";
import { resolveProjectAccess } from "@/lib/security/rbac";
import { recordAuditEvent } from "@/lib/security/audit";
import { computeMonthlySlaReport, renderSlaReportHtml } from "@/lib/monitors/sla";
import { isPublicDemoProject } from "@/lib/security/demo-project";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const projectId = req.nextUrl.searchParams.get("projectId");
    const month =
      req.nextUrl.searchParams.get("month") || new Date().toISOString().slice(0, 7);
    const format = req.nextUrl.searchParams.get("format") === "report" ? "report" : "json";

    if (!projectId) {
      return NextResponse.json({ error: "Missing projectId" }, { status: 400 });
    }

    let proj: typeof projects.$inferSelect | null = null;
    if (isPublicDemoProject(projectId)) {
      const [demoProj] = await db
        .select()
        .from(projects)
        .where(eq(projects.id, projectId))
        .limit(1);
      proj = demoProj || null;
    } else {
      const user = await getCurrentUser();
      if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      const access = await resolveProjectAccess(projectId, user);
      if (!access) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      proj = access.project;
    }

    if (!proj) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    const [monitors, checks, incidents] = await Promise.all([
      db.select().from(uptimeMonitors).where(eq(uptimeMonitors.projectId, proj.id)).limit(30),
      db
        .select()
        .from(uptimeChecks)
        .where(eq(uptimeChecks.projectId, proj.id))
        .orderBy(desc(uptimeChecks.checkedAt))
        .limit(1500),
      db
        .select()
        .from(uptimeIncidents)
        .where(eq(uptimeIncidents.projectId, proj.id))
        .orderBy(desc(uptimeIncidents.startedAt))
        .limit(100),
    ]);

    const report = computeMonthlySlaReport({
      projectName: proj.name,
      projectSlug: proj.slug,
      month,
      monitors,
      checks,
      incidents,
    });

    if (format === "report") {
      return new NextResponse(renderSlaReportHtml(report), {
        status: 200,
        headers: {
          "Content-Type": "text/html; charset=utf-8",
          "Cache-Control": "no-store",
        },
      });
    }

    return NextResponse.json({
      report,
      allIncidents: incidents,
    });
  } catch (err) {
    console.error("GET /api/v1/sla error:", err);
    return NextResponse.json({ error: "Failed to load SLA report" }, { status: 500 });
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
    const action = String(body.action || "");

    if (!projectId) {
      return NextResponse.json({ error: "Missing projectId" }, { status: 400 });
    }

    const access = await resolveProjectAccess(projectId, user);
    if (!access || !access.canWrite) {
      return NextResponse.json(
        { error: "Forbidden: Developer, Admin, or Owner role required." },
        { status: 403 }
      );
    }

    if (action === "update_sla_target") {
      const monitorId = String(body.monitorId || "");
      const slaTargetBp = Math.max(9000, Math.min(10000, Number(body.slaTargetBp || 9990)));
      await db
        .update(uptimeMonitors)
        .set({ slaTargetBp, updatedAt: new Date().toISOString() })
        .where(and(eq(uptimeMonitors.id, monitorId), eq(uptimeMonitors.projectId, projectId)));

      await recordAuditEvent({
        userId: user.id,
        actorUsername: user.githubUsername,
        organizationId: access.project.organizationId,
        workspaceId: access.project.workspaceId,
        projectId,
        action: "sla.target_updated",
        resourceType: "uptime_monitor",
        resourceId: monitorId,
        headers: req.headers,
        metadata: { slaTargetBp },
      });

      return NextResponse.json({ success: true });
    }

    if (action === "create_incident") {
      const title = String(body.title || "").trim().slice(0, 140);
      if (!title) {
        return NextResponse.json({ error: "Incident title is required" }, { status: 400 });
      }
      const severity = (["minor", "major", "critical"].includes(body.severity)
        ? body.severity
        : "major") as "minor" | "major" | "critical";
      const status = (["investigating", "identified", "monitoring", "resolved"].includes(body.status)
        ? body.status
        : "investigating") as "investigating" | "identified" | "monitoring" | "resolved";
      const startedAt = body.startedAt
        ? new Date(String(body.startedAt)).toISOString()
        : new Date().toISOString();
      const resolvedAt = status === "resolved" ? new Date().toISOString() : null;
      const durationMinutes =
        body.durationMinutes !== undefined
          ? Math.max(0, Number(body.durationMinutes))
          : resolvedAt
          ? Math.max(1, Math.round((Date.parse(resolvedAt) - Date.parse(startedAt)) / 60000))
          : 0;

      const incId = `inc_${crypto.randomUUID().replace(/-/g, "").slice(0, 14)}`;
      await db.insert(uptimeIncidents).values({
        id: incId,
        projectId,
        monitorId: body.monitorId ? String(body.monitorId) : null,
        title,
        severity,
        status,
        rcaText: body.rcaText ? String(body.rcaText).slice(0, 4000) : null,
        impactSummary: body.impactSummary ? String(body.impactSummary).slice(0, 500) : null,
        startedAt,
        resolvedAt,
        durationMinutes,
        isPublic: body.isPublic !== false,
        createdByUserId: user.id,
      });

      await recordAuditEvent({
        userId: user.id,
        actorUsername: user.githubUsername,
        organizationId: access.project.organizationId,
        workspaceId: access.project.workspaceId,
        projectId,
        action: "sla.incident_created",
        resourceType: "uptime_incident",
        resourceId: incId,
        headers: req.headers,
        metadata: { title, severity, status },
      });

      return NextResponse.json({ success: true, incidentId: incId }, { status: 201 });
    }

    if (action === "update_incident") {
      const incidentId = String(body.incidentId || "");
      const [existing] = await db
        .select()
        .from(uptimeIncidents)
        .where(and(eq(uptimeIncidents.id, incidentId), eq(uptimeIncidents.projectId, projectId)))
        .limit(1);

      if (!existing) {
        return NextResponse.json({ error: "Incident not found" }, { status: 404 });
      }

      const nextStatus = (["investigating", "identified", "monitoring", "resolved"].includes(
        body.status
      )
        ? body.status
        : existing.status) as "investigating" | "identified" | "monitoring" | "resolved";
      const nowIso = new Date().toISOString();
      const resolvedAt =
        nextStatus === "resolved" ? existing.resolvedAt || nowIso : null;
      const durationMinutes =
        body.durationMinutes !== undefined
          ? Math.max(0, Number(body.durationMinutes))
          : resolvedAt
          ? Math.max(
              1,
              Math.round((Date.parse(resolvedAt) - Date.parse(existing.startedAt)) / 60000)
            )
          : existing.durationMinutes;

      await db
        .update(uptimeIncidents)
        .set({
          status: nextStatus,
          rcaText:
            body.rcaText !== undefined
              ? String(body.rcaText || "").slice(0, 4000) || null
              : existing.rcaText,
          impactSummary:
            body.impactSummary !== undefined
              ? String(body.impactSummary || "").slice(0, 500) || null
              : existing.impactSummary,
          resolvedAt,
          durationMinutes,
          updatedAt: nowIso,
        })
        .where(eq(uptimeIncidents.id, incidentId));

      await recordAuditEvent({
        userId: user.id,
        actorUsername: user.githubUsername,
        organizationId: access.project.organizationId,
        workspaceId: access.project.workspaceId,
        projectId,
        action: "sla.incident_updated",
        resourceType: "uptime_incident",
        resourceId: incidentId,
        headers: req.headers,
        metadata: {
          status: nextStatus,
          hasRca: Boolean(body.rcaText || existing.rcaText),
          durationMinutes,
        },
      });

      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ error: "Unsupported SLA action" }, { status: 400 });
  } catch (err) {
    console.error("POST /api/v1/sla error:", err);
    return NextResponse.json({ error: "SLA operation failed" }, { status: 500 });
  }
}
