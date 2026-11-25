import { db } from "@/db";
import {
  alertIncidents,
  alertRules,
  errorEvents,
  escalationPolicies,
  pageviews,
  projects,
  uptimeMonitors,
} from "@/db/schema";
import { and, desc, eq, gte, isNotNull } from "drizzle-orm";
import { decryptSecret } from "@/lib/security/crypto";
import { dispatchTargetedChannels, resolveDecryptedWebhookConfig, type WebhookConfig } from "./webhook";
import { sendTransactionalEmail } from "./email";
import { recordAuditEvent } from "@/lib/security/audit";

export interface AnomalyDetectionResult {
  currentValue: number;
  baselineMean: number;
  stdDev: number;
  ewma: number;
  zScore: number;
  multiplier: number;
  isAnomaly: boolean;
  reason: string;
}

/**
 * Statistical / ML-based Anomaly Detector (Z-Score + EWMA hybrid)
 * Compares the current time bucket against a rolling historical baseline.
 * Uses a minimum stdDev floor (1.0) and count guard (>= 3) to avoid noisy alerts on low-volume repos.
 */
export function detectErrorAnomaly(
  baselineCounts: number[],
  currentCount: number,
  zThreshold = 2.5
): AnomalyDetectionResult {
  if (baselineCounts.length === 0) {
    return {
      currentValue: currentCount,
      baselineMean: 0,
      stdDev: 1,
      ewma: currentCount,
      zScore: currentCount >= 5 ? currentCount : 0,
      multiplier: currentCount,
      isAnomaly: currentCount >= 5,
      reason:
        currentCount >= 5
          ? `Cold-start spike detected (${currentCount} errors with zero prior baseline)`
          : "Insufficient baseline history",
    };
  }

  const n = baselineCounts.length;
  const mean = baselineCounts.reduce((s, v) => s + v, 0) / n;
  const variance =
    baselineCounts.reduce((s, v) => s + (v - mean) * (v - mean), 0) / n;
  const stdDev = Math.max(1.0, Math.sqrt(variance));

  // Exponentially Weighted Moving Average (alpha = 0.30 weights recent buckets heavier)
  const alpha = 0.3;
  let ewma = baselineCounts[0];
  for (let i = 1; i < n; i++) {
    ewma = alpha * baselineCounts[i] + (1 - alpha) * ewma;
  }

  const zScore = (currentCount - mean) / stdDev;
  const multiplier = currentCount / Math.max(1, ewma);
  const isAnomaly =
    currentCount >= 3 && (zScore >= zThreshold || (multiplier >= 3.0 && currentCount > mean + 2));

  return {
    currentValue: currentCount,
    baselineMean: Math.round(mean * 100) / 100,
    stdDev: Math.round(stdDev * 100) / 100,
    ewma: Math.round(ewma * 100) / 100,
    zScore: Math.round(zScore * 100) / 100,
    multiplier: Math.round(multiplier * 100) / 100,
    isAnomaly,
    reason: isAnomaly
      ? `Anomaly spike: ${currentCount} errors (Z-score ${zScore.toFixed(2)}σ, ${multiplier.toFixed(1)}x EWMA baseline)`
      : `Normal range (${currentCount} vs mean ${mean.toFixed(1)}, Z=${zScore.toFixed(2)}σ)`,
  };
}

/**
 * Computes hourly error counts for the past 24 hours (oldest -> newest baseline + current hour).
 */
export function buildHourlyErrorBuckets(
  events: Array<{ createdAt: string }>,
  nowMs = Date.now()
): { baseline23h: number[]; currentHour: number } {
  const buckets = new Array(24).fill(0);
  const currentHourStart = Math.floor(nowMs / 3600_000) * 3600_000;
  const windowStart = currentHourStart - 23 * 3600_000;

  for (const ev of events) {
    const t = Date.parse(ev.createdAt);
    if (!Number.isFinite(t) || t < windowStart || t > nowMs) continue;
    const idx = Math.min(23, Math.max(0, Math.floor((t - windowStart) / 3600_000)));
    buckets[idx]++;
  }

  return {
    baseline23h: buckets.slice(0, 23),
    currentHour: buckets[23],
  };
}

function parseChannelsJson(raw?: string | null): string[] {
  if (!raw) return ["slack", "email"];
  try {
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.map(String) : ["slack", "email"];
  } catch {
    return ["slack", "email"];
  }
}

async function resolveProjectWebhookConfig(
  proj: typeof projects.$inferSelect
): Promise<WebhookConfig & { emailKey: string | null }> {
  const [cfg, emailKey] = await Promise.all([
    resolveDecryptedWebhookConfig(proj),
    proj.emailApiKeyEncrypted ? decryptSecret(proj.emailApiKeyEncrypted).catch(() => null) : Promise.resolve(null),
  ]);
  return {
    ...cfg,
    emailKey,
  };
}

async function notifyStepChannels(params: {
  proj: typeof projects.$inferSelect;
  channels: string[];
  targetLabel: string;
  incidentTitle: string;
  details: string;
  step: number;
  incidentId: string;
}) {
  const { proj, channels, targetLabel, incidentTitle, details, step, incidentId } = params;
  const cfg = await resolveProjectWebhookConfig(proj);
  const dashboardUrl = `https://devpulse.ritualdev.in/dashboard/crashes?project=${proj.slug}`;

  await dispatchTargetedChannels(cfg, channels, {
    eventId: incidentId,
    projectName: proj.name,
    projectSlug: proj.slug,
    errorName: `[Step ${step} On-Call -> ${targetLabel}] ${incidentTitle}`,
    message: details,
    runtime: "smart-alert-engine",
    environment: "production",
    dashboardUrl,
  });

  if (channels.includes("email")) {
    const recipient = targetLabel.includes("@") ? targetLabel : proj.notificationEmail;
    if (recipient) {
      await sendTransactionalEmail({
        to: recipient,
        subject: `[DevPulse Step ${step} Alert] ${proj.name}: ${incidentTitle}`,
        html: `<div style="font-family:sans-serif"><h3>${incidentTitle}</h3><p><strong>Target:</strong> ${targetLabel}</p><p>${details}</p><p><a href="${dashboardUrl}">Acknowledge or Resolve in DevPulse</a></p></div>`,
        provider: proj.emailProvider,
        apiKey: cfg.emailKey,
      }).catch(() => {});
    }
  }
}

/**
 * Evaluates all active smart alert rules for a project (crash_rate, anomaly spike, uptime_down, latency_p95).
 */
export async function evaluateProjectAlertRules(projectId: string) {
  const [proj] = await db.select().from(projects).where(eq(projects.id, projectId)).limit(1);
  if (!proj) return { triggered: 0, anomalySnapshot: null };

  const rules = await db
    .select()
    .from(alertRules)
    .where(and(eq(alertRules.projectId, projectId), eq(alertRules.isEnabled, true)));

  const cutoff24h = new Date(Date.now() - 24 * 3600_000).toISOString();
  const [recentErrors, recentViews, monitors, policies] = await Promise.all([
    db
      .select({ id: errorEvents.id, createdAt: errorEvents.createdAt })
      .from(errorEvents)
      .where(and(eq(errorEvents.projectId, projectId), gte(errorEvents.createdAt, cutoff24h)))
      .limit(1000),
    db
      .select({ id: pageviews.id, createdAt: pageviews.createdAt })
      .from(pageviews)
      .where(and(eq(pageviews.projectId, projectId), gte(pageviews.createdAt, cutoff24h)))
      .limit(2000),
    db.select().from(uptimeMonitors).where(eq(uptimeMonitors.projectId, projectId)),
    db.select().from(escalationPolicies).where(eq(escalationPolicies.projectId, projectId)),
  ]);

  const { baseline23h, currentHour } = buildHourlyErrorBuckets(recentErrors);
  const anomalySnapshot = detectErrorAnomaly(baseline23h, currentHour, 2.5);

  if (rules.length === 0) {
    return { triggered: 0, anomalySnapshot };
  }

  let triggered = 0;
  const nowMs = Date.now();
  const nowIso = new Date(nowMs).toISOString();

  for (const rule of rules) {
    // Respect cooldown window so rules don't double-fire within windowMinutes
    const cooldownMs = Math.max(5, rule.windowMinutes) * 60_000;
    if (rule.lastTriggeredAt && nowMs - Date.parse(rule.lastTriggeredAt) < cooldownMs) {
      continue;
    }

    let fired = false;
    let triggerValue = "";
    let anomalyScoreStr: string | null = null;
    let details = "";

    if (rule.ruleType === "crash_rate") {
      const winStartIso = new Date(nowMs - rule.windowMinutes * 60_000).toISOString();
      const winErrs = recentErrors.filter((e) => e.createdAt >= winStartIso).length;
      const winTraffic = Math.max(
        1,
        recentViews.filter((v) => v.createdAt >= winStartIso).length
      );
      const crashRatePct = (winErrs / winTraffic) * 100;
      if (winErrs >= 2 && crashRatePct > rule.thresholdPercent) {
        fired = true;
        triggerValue = `${crashRatePct.toFixed(1)}% (${winErrs}/${winTraffic} in ${rule.windowMinutes}m)`;
        details = `Crash rate ${triggerValue} exceeded ${rule.thresholdPercent}% threshold.`;
      }
    } else if (rule.ruleType === "error_spike_anomaly") {
      const zThresh = (rule.anomalyZScoreBp || 250) / 100;
      const res = detectErrorAnomaly(baseline23h, currentHour, zThresh);
      if (res.isAnomaly) {
        fired = true;
        triggerValue = `${res.currentValue} errors/hr`;
        anomalyScoreStr = `z=${res.zScore} (${res.multiplier}x EWMA)`;
        details = res.reason;
      }
    } else if (rule.ruleType === "uptime_down") {
      const downMons = monitors.filter((m) => m.lastStatus === "down");
      if (downMons.length > 0) {
        fired = true;
        triggerValue = `${downMons.length} endpoint(s) DOWN`;
        details = `Down monitors: ${downMons.map((m) => `${m.name} (${m.url})`).join(", ")}`;
      }
    } else if (rule.ruleType === "latency_p95") {
      const slowMons = monitors.filter((m) => m.p95LatencyMs > rule.thresholdPercent);
      if (slowMons.length > 0) {
        fired = true;
        triggerValue = `P95 ${Math.max(...slowMons.map((m) => m.p95LatencyMs))}ms`;
        details = `Latency exceeded ${rule.thresholdPercent}ms on ${slowMons.map((m) => m.name).join(", ")}`;
      }
    }

    if (!fired) continue;

    triggered++;
    const policy = policies.find((p) => p.id === rule.escalationPolicyId) || null;
    const channels = policy
      ? parseChannelsJson(policy.step1ChannelsJson)
      : parseChannelsJson(rule.channelsJson);
    const ackMinutes = policy ? Math.max(1, policy.ackTimeoutMinutes) : 15;
    const escalateAt = policy ? new Date(nowMs + ackMinutes * 60_000).toISOString() : null;

    const incId = `alrt_${crypto.randomUUID().replace(/-/g, "").slice(0, 14)}`;
    await db.insert(alertIncidents).values({
      id: incId,
      projectId,
      ruleId: rule.id,
      policyId: policy?.id || null,
      title: rule.name,
      severity: "critical",
      triggerValue,
      anomalyScore: anomalyScoreStr,
      status: "triggered",
      currentStep: 1,
      escalateAt,
    });

    await db
      .update(alertRules)
      .set({ lastTriggeredAt: nowIso, updatedAt: nowIso })
      .where(eq(alertRules.id, rule.id));

    await notifyStepChannels({
      proj,
      channels,
      targetLabel: policy?.step1Target || "Primary On-Call",
      incidentTitle: rule.name,
      details,
      step: 1,
      incidentId: incId,
    });

    await recordAuditEvent({
      userId: proj.userId,
      actorUsername: "smart-alert-engine",
      organizationId: proj.organizationId,
      workspaceId: proj.workspaceId,
      projectId,
      action: "alert.rule_triggered",
      resourceType: "alert_incident",
      resourceId: incId,
      metadata: { ruleName: rule.name, ruleType: rule.ruleType, triggerValue, anomalyScoreStr },
    });
  }

  return { triggered, anomalySnapshot };
}

/**
 * Escalates unacknowledged Step-1 alert incidents whose ack timeout has elapsed to Step-2 Lead targets.
 */
export async function processPendingEscalations(): Promise<{ escalated: number }> {
  const nowIso = new Date().toISOString();
  const dueIncidents = await db
    .select()
    .from(alertIncidents)
    .where(
      and(
        eq(alertIncidents.status, "triggered"),
        eq(alertIncidents.currentStep, 1),
        isNotNull(alertIncidents.escalateAt)
      )
    )
    .limit(50);

  let escalated = 0;

  for (const inc of dueIncidents) {
    if (!inc.escalateAt || inc.escalateAt > nowIso) continue;
    if (!inc.policyId) continue;

    const [[policy], [proj]] = await Promise.all([
      db.select().from(escalationPolicies).where(eq(escalationPolicies.id, inc.policyId)).limit(1),
      db.select().from(projects).where(eq(projects.id, inc.projectId)).limit(1),
    ]);

    if (!policy || !proj) continue;

    await db
      .update(alertIncidents)
      .set({ status: "escalated", currentStep: 2 })
      .where(eq(alertIncidents.id, inc.id));

    const step2Channels = parseChannelsJson(policy.step2ChannelsJson);
    await notifyStepChannels({
      proj,
      channels: step2Channels,
      targetLabel: policy.step2Target,
      incidentTitle: `ESCALATED: ${inc.title}`,
      details: `Unacknowledged after ${policy.ackTimeoutMinutes}m! Trigger: ${inc.triggerValue}${inc.anomalyScore ? ` (${inc.anomalyScore})` : ""}`,
      step: 2,
      incidentId: inc.id,
    });

    await recordAuditEvent({
      userId: proj.userId,
      actorUsername: "escalation-scheduler",
      organizationId: proj.organizationId,
      workspaceId: proj.workspaceId,
      projectId: proj.id,
      action: "alert.escalated",
      resourceType: "alert_incident",
      resourceId: inc.id,
      metadata: { step2Target: policy.step2Target, ackTimeoutMinutes: policy.ackTimeoutMinutes },
    });

    escalated++;
  }

  return { escalated };
}
