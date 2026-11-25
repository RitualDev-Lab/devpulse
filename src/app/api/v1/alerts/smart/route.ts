import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import {
  alertIncidents,
  alertRules,
  errorEvents,
  escalationPolicies,
} from "@/db/schema";
import { and, desc, eq, gte } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth";
import { resolveProjectAccess } from "@/lib/security/rbac";
import { recordAuditEvent } from "@/lib/security/audit";
import {
  buildHourlyErrorBuckets,
  detectErrorAnomaly,
  evaluateProjectAlertRules,
  processPendingEscalations,
} from "@/lib/alerts/smart-engine";
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

    const cutoff24h = new Date(Date.now() - 24 * 3600_000).toISOString();
    const [rules, policies, incidents, recentErrors] = await Promise.all([
      db
        .select()
        .from(alertRules)
        .where(eq(alertRules.projectId, projectId))
        .orderBy(desc(alertRules.createdAt))
        .limit(30),
      db
        .select()
        .from(escalationPolicies)
        .where(eq(escalationPolicies.projectId, projectId))
        .orderBy(desc(escalationPolicies.createdAt))
        .limit(20),
      db
        .select()
        .from(alertIncidents)
        .where(eq(alertIncidents.projectId, projectId))
        .orderBy(desc(alertIncidents.createdAt))
        .limit(40),
      db
        .select({ createdAt: errorEvents.createdAt })
        .from(errorEvents)
        .where(and(eq(errorEvents.projectId, projectId), gte(errorEvents.createdAt, cutoff24h)))
        .limit(1000),
    ]);

    const { baseline23h, currentHour } = buildHourlyErrorBuckets(recentErrors);
    const anomalySnapshot = detectErrorAnomaly(baseline23h, currentHour, 2.5);

    return NextResponse.json({
      rules,
      policies,
      incidents,
      anomalySnapshot,
    });
  } catch (err) {
    console.error("GET /api/v1/alerts/smart error:", err);
    return NextResponse.json({ error: "Failed to load smart alert config" }, { status: 500 });
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
        { error: "Forbidden: Developer, Admin, or Owner permissions required." },
        { status: 403 }
      );
    }

    if (action === "create_policy") {
      const name = String(body.name || "").trim().slice(0, 80) || "Default On-Call Escalation";
      const step1Target = String(body.step1Target || "Primary On-Call Dev").trim().slice(0, 100);
      const step2Target = String(body.step2Target || "Engineering Lead").trim().slice(0, 100);
      const ackTimeoutMinutes = Math.max(1, Math.min(240, Number(body.ackTimeoutMinutes || 15)));
      const step1Channels = Array.isArray(body.step1Channels)
        ? body.step1Channels.map(String)
        : ["slack", "discord", "email"];
      const step2Channels = Array.isArray(body.step2Channels)
        ? body.step2Channels.map(String)
        : ["pagerduty", "opsgenie", "teams", "email"];

      const polId = `pol_${crypto.randomUUID().replace(/-/g, "").slice(0, 14)}`;
      await db.insert(escalationPolicies).values({
        id: polId,
        projectId,
        name,
        step1Target,
        step1ChannelsJson: JSON.stringify(step1Channels),
        ackTimeoutMinutes,
        step2Target,
        step2ChannelsJson: JSON.stringify(step2Channels),
      });

      await recordAuditEvent({
        userId: user.id,
        actorUsername: user.githubUsername,
        organizationId: access.project.organizationId,
        workspaceId: access.project.workspaceId,
        projectId,
        action: "alert.policy_created",
        resourceType: "escalation_policy",
        resourceId: polId,
        headers: req.headers,
        metadata: { name, step1Target, ackTimeoutMinutes, step2Target },
      });

      return NextResponse.json({ success: true, policyId: polId }, { status: 201 });
    }

    if (action === "create_rule") {
      const name = String(body.name || "").trim().slice(0, 100) || "Crash Rate Spike";
      const ruleType = (
        ["crash_rate", "error_spike_anomaly", "uptime_down", "latency_p95"].includes(body.ruleType)
          ? body.ruleType
          : "crash_rate"
      ) as "crash_rate" | "error_spike_anomaly" | "uptime_down" | "latency_p95";

      const thresholdPercent = Math.max(1, Math.min(100000, Number(body.thresholdPercent || 5)));
      const windowMinutes = Math.max(1, Math.min(1440, Number(body.windowMinutes || 5)));
      const anomalyZScoreBp = Math.max(150, Math.min(600, Number(body.anomalyZScoreBp || 250)));
      const channels = Array.isArray(body.channels)
        ? body.channels.map(String)
        : ["slack", "pagerduty"];

      const ruleId = `rule_${crypto.randomUUID().replace(/-/g, "").slice(0, 14)}`;
      await db.insert(alertRules).values({
        id: ruleId,
        projectId,
        name,
        ruleType,
        thresholdPercent,
        windowMinutes,
        anomalyZScoreBp,
        escalationPolicyId: body.escalationPolicyId ? String(body.escalationPolicyId) : null,
        channelsJson: JSON.stringify(channels),
        isEnabled: true,
      });

      await recordAuditEvent({
        userId: user.id,
        actorUsername: user.githubUsername,
        organizationId: access.project.organizationId,
        workspaceId: access.project.workspaceId,
        projectId,
        action: "alert.rule_created",
        resourceType: "alert_rule",
        resourceId: ruleId,
        headers: req.headers,
        metadata: { name, ruleType, thresholdPercent, windowMinutes },
      });

      return NextResponse.json({ success: true, ruleId }, { status: 201 });
    }

    if (action === "toggle_rule") {
      const ruleId = String(body.ruleId || "");
      await db
        .update(alertRules)
        .set({ isEnabled: Boolean(body.isEnabled), updatedAt: new Date().toISOString() })
        .where(and(eq(alertRules.id, ruleId), eq(alertRules.projectId, projectId)));
      return NextResponse.json({ success: true });
    }

    if (action === "delete_rule") {
      const ruleId = String(body.ruleId || "");
      await db
        .delete(alertRules)
        .where(and(eq(alertRules.id, ruleId), eq(alertRules.projectId, projectId)));
      return NextResponse.json({ success: true });
    }

    if (action === "delete_policy") {
      const policyId = String(body.policyId || "");
      await db
        .delete(escalationPolicies)
        .where(
          and(
            eq(escalationPolicies.id, policyId),
            eq(escalationPolicies.projectId, projectId)
          )
        );
      return NextResponse.json({ success: true });
    }

    if (action === "ack_incident" || action === "resolve_incident") {
      const incidentId = String(body.incidentId || "");
      const nowIso = new Date().toISOString();
      const nextStatus = action === "ack_incident" ? "acknowledged" : "resolved";

      await db
        .update(alertIncidents)
        .set({
          status: nextStatus,
          ...(action === "ack_incident"
            ? { acknowledgedBy: user.githubUsername, acknowledgedAt: nowIso }
            : { resolvedAt: nowIso }),
        })
        .where(and(eq(alertIncidents.id, incidentId), eq(alertIncidents.projectId, projectId)));

      await recordAuditEvent({
        userId: user.id,
        actorUsername: user.githubUsername,
        organizationId: access.project.organizationId,
        workspaceId: access.project.workspaceId,
        projectId,
        action: action === "ack_incident" ? "alert.incident_acknowledged" : "alert.incident_resolved",
        resourceType: "alert_incident",
        resourceId: incidentId,
        headers: req.headers,
      });

      return NextResponse.json({ success: true });
    }

    if (action === "evaluate_now") {
      const [evalRes, escRes] = await Promise.all([
        evaluateProjectAlertRules(projectId),
        processPendingEscalations(),
      ]);
      return NextResponse.json({
        success: true,
        triggered: evalRes.triggered,
        escalated: escRes.escalated,
        anomalySnapshot: evalRes.anomalySnapshot,
      });
    }

    return NextResponse.json({ error: "Unsupported smart alert action" }, { status: 400 });
  } catch (err) {
    console.error("POST /api/v1/alerts/smart error:", err);
    return NextResponse.json({ error: "Smart alert operation failed" }, { status: 500 });
  }
}
