import { db } from "@/db";
import {
  dailyMetrics,
  errorEvents,
  projects,
  uptimeChecks,
  uptimeMonitors,
  users,
} from "@/db/schema";
import { and, desc, eq } from "drizzle-orm";
import { decryptSecret } from "@/lib/security/crypto";
import { computeP95Latency, computeUptimeBasisPoints } from "@/lib/monitors/checker";
import { buildWeeklyDigestEmailHtml, sendTransactionalEmail } from "@/lib/alerts/email";
import { fetchRevenueStats } from "@/lib/integrations/revenue";

export async function compileProjectDigest(projectId: string) {
  const [project] = await db
    .select()
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);

  if (!project) return null;

  const [owner] = await db
    .select({ githubUsername: users.githubUsername, email: users.email })
    .from(users)
    .where(eq(users.id, project.userId))
    .limit(1);

  const [metrics, unresolved, monitors, checks] = await Promise.all([
    db.select().from(dailyMetrics).where(eq(dailyMetrics.projectId, projectId)).limit(100),
    db
      .select({ id: errorEvents.id })
      .from(errorEvents)
      .where(and(eq(errorEvents.projectId, projectId), eq(errorEvents.status, "unresolved"))),
    db.select().from(uptimeMonitors).where(eq(uptimeMonitors.projectId, projectId)),
    db
      .select()
      .from(uptimeChecks)
      .where(eq(uptimeChecks.projectId, projectId))
      .orderBy(desc(uptimeChecks.checkedAt))
      .limit(100),
  ]);

  let stars = 0;
  let downloads = 0;
  for (const m of metrics) {
    if (m.metricType === "stars") stars = Math.max(stars, m.value);
    if (m.metricType === "downloads" || m.metricType === "installs" || m.metricType === "pulls") {
      downloads += m.value;
    }
  }

  let mrrUsd = 0;
  const plainStripe = await decryptSecret(project.stripeApiKey);
  const plainDodo = await decryptSecret(project.dodoPaymentsApiKey);
  if (plainStripe || plainDodo || project.githubSponsorsUsername) {
    const rev = await fetchRevenueStats({
      stripeKey: plainStripe,
      dodoKey: plainDodo,
      dodoEnv: project.dodoPaymentsEnvironment,
      githubSponsorsUsername: project.githubSponsorsUsername,
    }).catch(() => null);
    if (rev?.mrr) mrrUsd = rev.mrr;
  }

  const p95LatencyMs =
    checks.length > 0
      ? computeP95Latency(checks.map((c) => c.latencyMs))
      : monitors[0]?.p95LatencyMs || 0;
  const uptimeBp =
    checks.length > 0
      ? computeUptimeBasisPoints(checks.map((c) => c.status))
      : monitors[0]?.uptimeBasisPoints ?? 10000;

  return {
    project,
    maintainerUsername: owner?.githubUsername || "maintainer",
    recipientEmail: project.notificationEmail || owner?.email || null,
    stars,
    downloads,
    mrrUsd: Math.round(mrrUsd),
    unresolvedIssues: unresolved.length,
    uptimePercent: (uptimeBp / 100).toFixed(2),
    p95LatencyMs,
  };
}

export async function sendProjectDigest(projectId: string, overrideEmail?: string) {
  const compiled = await compileProjectDigest(projectId);
  if (!compiled) {
    return { sent: false, error: "Project not found" };
  }

  const toEmail = (overrideEmail || compiled.recipientEmail || "").trim();
  if (!toEmail) {
    return { sent: false, error: "No notification email configured for this project" };
  }

  const apiKey = await decryptSecret(compiled.project.emailApiKeyEncrypted);
  const res = await sendTransactionalEmail({
    to: toEmail,
    subject: `[DevPulse Weekly Digest] ${compiled.project.name} — ${compiled.uptimePercent}% uptime, ${compiled.unresolvedIssues} open issues`,
    html: buildWeeklyDigestEmailHtml({
      projectName: compiled.project.name,
      maintainerUsername: compiled.maintainerUsername,
      stars: compiled.stars,
      downloads: compiled.downloads,
      mrrUsd: compiled.mrrUsd,
      unresolvedIssues: compiled.unresolvedIssues,
      uptimePercent: compiled.uptimePercent,
      p95LatencyMs: compiled.p95LatencyMs,
    }),
    provider: compiled.project.emailProvider,
    apiKey,
  });

  if (res.sent) {
    await db
      .update(projects)
      .set({ lastDigestSentAt: new Date().toISOString() })
      .where(eq(projects.id, projectId));
  }

  return { ...res, summary: { stars: compiled.stars, downloads: compiled.downloads, mrrUsd: compiled.mrrUsd, unresolvedIssues: compiled.unresolvedIssues, uptimePercent: compiled.uptimePercent, p95LatencyMs: compiled.p95LatencyMs } };
}
