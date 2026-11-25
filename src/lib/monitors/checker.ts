import { db } from "@/db";
import { projects, statusSubscribers, uptimeChecks, uptimeMonitors } from "@/db/schema";
import { and, desc, eq } from "drizzle-orm";
import { dispatchCrashAlerts, resolveDecryptedWebhookConfig } from "@/lib/alerts/webhook";
import { decryptSecret } from "@/lib/security/crypto";
import { buildDowntimeEmailHtml, sendTransactionalEmail } from "@/lib/alerts/email";
import { validatePublicUrl } from "@/lib/security/ssrf";

export function isValidPublicMonitorUrl(rawUrl: string): { valid: boolean; reason?: string; normalized?: string } {
  return validatePublicUrl(rawUrl, { allowHttp: true });
}

/**
 * Compute exact P95 latency (95th percentile, nearest-rank) in milliseconds.
 */
export function computeP95Latency(latencies: number[]): number {
  const valid = latencies.filter((n) => typeof n === "number" && Number.isFinite(n) && n >= 0);
  if (valid.length === 0) return 0;
  const sorted = [...valid].sort((a, b) => a - b);
  const rankIdx = Math.max(0, Math.ceil(0.95 * sorted.length) - 1);
  return Math.round(sorted[rankIdx]);
}

/**
 * Compute availability basis points (10000 = 100.00%, 9995 = 99.95%).
 */
export function computeUptimeBasisPoints(
  statuses: Array<"up" | "degraded" | "down" | string>
): number {
  if (statuses.length === 0) return 10000;
  const upCount = statuses.filter((s) => s === "up" || s === "degraded").length;
  return Math.round((upCount / statuses.length) * 10000);
}

export async function runMonitorCheck(monitorId: string, edgeRegion = "cf-edge") {
  const [monitor] = await db
    .select()
    .from(uptimeMonitors)
    .where(eq(uptimeMonitors.id, monitorId))
    .limit(1);

  if (!monitor) {
    throw new Error("Monitor not found");
  }

  const start = Date.now();
  let status: "up" | "degraded" | "down" = "up";
  let statusCode: number | null = null;
  let errorMessage: string | null = null;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    const res = await fetch(monitor.url, {
      method: monitor.method,
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "User-Agent": "DevPulse-EdgeMonitor/1.0 (+https://devpulse.ritualdev.in)",
        "Cache-Control": "no-cache",
      },
    });
    clearTimeout(timer);
    statusCode = res.status;

    const latencyMs = Math.max(1, Date.now() - start);
    if (res.status !== monitor.expectedStatus && !(monitor.expectedStatus === 200 && res.status >= 200 && res.status < 300)) {
      status = "down";
      errorMessage = `Expected HTTP ${monitor.expectedStatus}, received ${res.status}`;
    } else if (latencyMs > 2500) {
      status = "degraded";
      errorMessage = `High response latency (${latencyMs}ms > 2500ms)`;
    }

    return await persistCheckResult(monitor, status, statusCode, latencyMs, edgeRegion, errorMessage);
  } catch (err: any) {
    const latencyMs = Math.max(1, Date.now() - start);
    status = "down";
    errorMessage = err?.name === "AbortError" ? "Request timed out (>8000ms)" : err?.message || "Connection failed";
    return await persistCheckResult(monitor, status, null, latencyMs, edgeRegion, errorMessage);
  }
}

async function persistCheckResult(
  monitor: typeof uptimeMonitors.$inferSelect,
  status: "up" | "degraded" | "down",
  statusCode: number | null,
  latencyMs: number,
  edgeRegion: string,
  errorMessage: string | null
) {
  const checkId = `chk_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
  const nowIso = new Date().toISOString();

  await db.insert(uptimeChecks).values({
    id: checkId,
    monitorId: monitor.id,
    projectId: monitor.projectId,
    status,
    statusCode,
    latencyMs,
    edgeRegion,
    errorMessage,
    checkedAt: nowIso,
  });

  const recentChecks = await db
    .select()
    .from(uptimeChecks)
    .where(eq(uptimeChecks.monitorId, monitor.id))
    .orderBy(desc(uptimeChecks.checkedAt))
    .limit(100);

  const p95LatencyMs = computeP95Latency(recentChecks.map((c) => c.latencyMs));
  const uptimeBasisPoints = computeUptimeBasisPoints(recentChecks.map((c) => c.status));

  await db
    .update(uptimeMonitors)
    .set({
      lastStatus: status,
      lastStatusCode: statusCode,
      lastLatencyMs: latencyMs,
      p95LatencyMs,
      uptimeBasisPoints,
      lastError: errorMessage,
      lastCheckedAt: nowIso,
      updatedAt: nowIso,
    })
    .where(eq(uptimeMonitors.id, monitor.id));

  // Dispatch alerts when endpoint fails health check (or newly goes down)
  if (status === "down" && monitor.alertOnDown) {
    const [project] = await db
      .select()
      .from(projects)
      .where(eq(projects.id, monitor.projectId))
      .limit(1);

    if (project) {
      const webhookConfig = await resolveDecryptedWebhookConfig(project);
      await dispatchCrashAlerts(
        webhookConfig,
        {
          eventId: checkId,
          projectName: project.name,
          projectSlug: project.slug,
          errorName: `Uptime Monitor Down: ${monitor.name}`,
          message: `${monitor.url}\n${errorMessage || `HTTP ${statusCode}`}`,
          runtime: "uptime-edge",
          environment: "production",
          dashboardUrl: `https://devpulse.ritualdev.in`,
        }
      ).catch(() => {});

      if (project.notificationEmail) {
        const emailKey = await decryptSecret(project.emailApiKeyEncrypted);
        await sendTransactionalEmail({
          to: project.notificationEmail,
          subject: `[DevPulse Alert] ${monitor.name} is DOWN (${project.name})`,
          html: buildDowntimeEmailHtml({
            projectName: project.name,
            monitorName: monitor.name,
            url: monitor.url,
            statusCode,
            latencyMs,
            errorMessage,
          }),
          provider: project.emailProvider,
          apiKey: emailKey,
        }).catch(() => {});
      }

      // Notify confirmed public status page subscribers
      const subscribers = await db
        .select()
        .from(statusSubscribers)
        .where(and(eq(statusSubscribers.projectId, project.id), eq(statusSubscribers.isActive, true)))
        .limit(25)
        .catch(() => []);

      if (subscribers.length > 0) {
        const emailKey = await decryptSecret(project.emailApiKeyEncrypted).catch(() => null);
        const baseHtml = buildDowntimeEmailHtml({
          projectName: project.name,
          monitorName: monitor.name,
          url: monitor.url,
          statusCode,
          latencyMs,
          errorMessage,
        });
        await Promise.allSettled(
          subscribers.map((sub) =>
            sendTransactionalEmail({
              to: sub.email,
              subject: `[Status Update] ${project.name}: ${monitor.name} Disruption Detected`,
              html: `${baseHtml}<p style="font-size:12px;color:#71717a;margin-top:16px;"><a href="https://devpulse.ritualdev.in/api/v1/status/subscribe?token=${encodeURIComponent(sub.unsubscribeToken)}">Unsubscribe from ${project.name} status notifications</a></p>`,
              provider: project.emailProvider,
              apiKey: emailKey,
            })
          )
        );
      }
    }
  }

  return {
    checkId,
    monitorId: monitor.id,
    status,
    statusCode,
    latencyMs,
    p95LatencyMs,
    uptimeBasisPoints,
    errorMessage,
    checkedAt: nowIso,
  };
}

export async function runDueUptimeChecks(maxConcurrent = 15) {
  const activeMonitors = await db
    .select()
    .from(uptimeMonitors)
    .where(eq(uptimeMonitors.isActive, true))
    .limit(maxConcurrent);

  const now = Date.now();
  const due = activeMonitors.filter((m) => {
    if (!m.lastCheckedAt) return true;
    const elapsedMs = now - new Date(m.lastCheckedAt).getTime();
    return elapsedMs >= m.intervalMinutes * 60 * 1000 - 15000;
  });

  const results = await Promise.allSettled(
    due.map((m) => runMonitorCheck(m.id, "cf-cron"))
  );

  return {
    checked: due.length,
    totalActive: activeMonitors.length,
    results: results.map((r) => (r.status === "fulfilled" ? r.value : { error: String(r.reason) })),
  };
}
