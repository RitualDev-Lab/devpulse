import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { deployments, errorEvents, projects, uptimeChecks, uptimeIncidents, uptimeMonitors } from "@/db/schema";
import { and, desc, eq, gte, lt } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth";
import { resolveProjectAccess } from "@/lib/security/rbac";
import { recordAuditEvent } from "@/lib/security/audit";
import { computeMonthlySlaReport, monthBounds, renderSlaReportHtml } from "@/lib/monitors/sla";
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

    const bounds = monthBounds(month);
    if (!bounds) {
      return NextResponse.json({ error: "month must be YYYY-MM" }, { status: 400 });
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
        .where(
          and(
            eq(uptimeChecks.projectId, proj.id),
            gte(uptimeChecks.checkedAt, bounds.start),
            lt(uptimeChecks.checkedAt, bounds.end)
          )
        )
        .orderBy(desc(uptimeChecks.checkedAt)),
      db
        .select()
        .from(uptimeIncidents)
        .where(
          and(
            eq(uptimeIncidents.projectId, proj.id),
            gte(uptimeIncidents.startedAt, bounds.start),
            lt(uptimeIncidents.startedAt, bounds.end)
          )
        )
        .orderBy(desc(uptimeIncidents.startedAt)),
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
          isPublic:
            body.isPublic !== undefined ? Boolean(body.isPublic) : existing.isPublic,
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

    if (action === "generate_postmortem") {
      const incidentId = String(body.incidentId || "");
      const [existing] = await db
        .select()
        .from(uptimeIncidents)
        .where(and(eq(uptimeIncidents.id, incidentId), eq(uptimeIncidents.projectId, projectId)))
        .limit(1);

      if (!existing) {
        return NextResponse.json({ error: "Incident not found" }, { status: 404 });
      }

      const [recentDeploys, recentCrashes] = await Promise.all([
        db
          .select({
            environment: deployments.environment,
            version: deployments.version,
            commitSha: deployments.commitSha,
            deployedAt: deployments.deployedAt,
          })
          .from(deployments)
          .where(eq(deployments.projectId, projectId))
          .orderBy(desc(deployments.deployedAt))
          .limit(3),
        db
          .select({
            errorName: errorEvents.errorName,
            message: errorEvents.message,
            createdAt: errorEvents.createdAt,
          })
          .from(errorEvents)
          .where(eq(errorEvents.projectId, projectId))
          .orderBy(desc(errorEvents.createdAt))
          .limit(4),
      ]);

      const deterministicDraft = [
        `Incident: ${existing.title} (${existing.severity.toUpperCase()})`,
        `Timeline: Started ${existing.startedAt}${existing.resolvedAt ? `, resolved ${existing.resolvedAt}` : " (ongoing)"}${existing.durationMinutes ? ` (${existing.durationMinutes}m duration)` : ""}.`,
        recentDeploys.length > 0
          ? `Correlated Deployments: ${recentDeploys.map((d) => `${d.version || "release"} on ${d.environment} (${d.commitSha?.slice(0, 7) || "no-sha"})`).join("; ")}.`
          : `Correlated Deployments: None recorded near outage window.`,
        recentCrashes.length > 0
          ? `Related Crash Signals: ${recentCrashes.map((c) => `${c.errorName}: ${c.message.slice(0, 80)}`).join(" | ")}.`
          : `Related Crash Signals: Zero matching unhandled exceptions during window.`,
        existing.impactSummary ? `Customer Impact: ${existing.impactSummary}` : `Customer Impact: Monitored endpoints experienced elevated errors/latency.`,
        `Follow-up Action Items: Verify cron heartbeat alerts, add synthetic edge probe assertion, and link rollback target.`,
      ].join("\n");

      let postmortem = deterministicDraft;
      const geminiKey = process.env.GEMINI_API_KEY?.trim();
      if (geminiKey) {
        try {
          const aiRes = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${geminiKey}`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                contents: [
                  {
                    parts: [
                      {
                        text: `Write a crisp, factual public-ready Root Cause Analysis & Postmortem summary (max 120 words) from these telemetry facts:\n\n${deterministicDraft}`,
                      },
                    ],
                  },
                ],
              }),
            }
          );
          if (aiRes.ok) {
            const aiData = (await aiRes.json()) as {
              candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
            };
            const text = aiData.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
            if (text) postmortem = text.slice(0, 3500);
          }
        } catch {
          // keep deterministic draft
        }
      }

      await db
        .update(uptimeIncidents)
        .set({ rcaText: postmortem, updatedAt: new Date().toISOString() })
        .where(eq(uptimeIncidents.id, incidentId));

      await recordAuditEvent({
        userId: user.id,
        actorUsername: user.githubUsername,
        organizationId: access.project.organizationId,
        workspaceId: access.project.workspaceId,
        projectId,
        action: "sla.postmortem_generated",
        resourceType: "uptime_incident",
        resourceId: incidentId,
        headers: req.headers,
        metadata: { aiAssisted: Boolean(geminiKey) },
      });

      return NextResponse.json({ success: true, postmortem });
    }

    return NextResponse.json({ error: "Unsupported SLA action" }, { status: 400 });
  } catch (err) {
    console.error("POST /api/v1/sla error:", err);
    return NextResponse.json({ error: "SLA operation failed" }, { status: 500 });
  }
}
