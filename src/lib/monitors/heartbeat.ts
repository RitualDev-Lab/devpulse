import { db } from "@/db";
import { projectConnectors, projects } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { dispatchCrashAlerts, resolveDecryptedWebhookConfig } from "@/lib/alerts/webhook";
import { sendTransactionalEmail } from "@/lib/alerts/email";
import { decryptSecret } from "@/lib/security/crypto";
import { PUBLIC_APP_URL } from "@/lib/config/app-url";
import {
  evaluateHeartbeatDue,
  parseHeartbeatMetadata,
  type CronHeartbeatMetadata,
  type HeartbeatState,
} from "./heartbeat-eval";

export {
  evaluateHeartbeatDue,
  parseHeartbeatMetadata,
  type CronHeartbeatMetadata,
  type HeartbeatState,
};

async function dispatchHeartbeatAlert(projectId: string, monitorName: string, reason: string) {
  const [proj] = await db.select().from(projects).where(eq(projects.id, projectId)).limit(1);
  if (!proj) return;

  const dashboardUrl = `${PUBLIC_APP_URL}/dashboard/uptime?project=${encodeURIComponent(proj.slug)}`;
  const cfg = await resolveDecryptedWebhookConfig(proj).catch(() => null);
  if (cfg) {
    await dispatchCrashAlerts(cfg, {
      projectName: proj.name,
      projectSlug: proj.slug,
      errorName: "CronHeartbeatMissed",
      message: `${monitorName}: ${reason}`,
      runtime: "cron-heartbeat",
      dashboardUrl,
    }).catch(() => {});
  }

  if (proj.notificationEmail) {
    const emailApiKey = proj.emailApiKeyEncrypted
      ? await decryptSecret(proj.emailApiKeyEncrypted).catch(() => null)
      : null;
    await sendTransactionalEmail({
      to: proj.notificationEmail,
      subject: `[${proj.name}] Cron Heartbeat Alert: ${monitorName}`,
      text: `${monitorName}: ${reason}. Inspect at ${dashboardUrl}`,
      html: `<p><strong>${proj.name}</strong> Cron Heartbeat alert for <strong>${monitorName}</strong>:</p><p>${reason}</p><p><a href="${dashboardUrl}">Open Uptime &amp; Heartbeats</a></p>`,
      provider: (proj.emailProvider as any) || undefined,
      apiKey: emailApiKey || undefined,
    }).catch(() => {});
  }
}

export async function processHeartbeatPing(params: {
  monitorKey: string;
  state: "start" | "finish" | "fail";
  durationMs?: number | null;
  message?: string | null;
}) {
  const [conn] = await db
    .select()
    .from(projectConnectors)
    .where(
      and(
        eq(projectConnectors.category, "telemetry"),
        eq(projectConnectors.provider, "cron_heartbeat"),
        eq(projectConnectors.identifier, params.monitorKey)
      )
    )
    .limit(1);

  if (!conn) return null;

  const meta = parseHeartbeatMetadata(conn.metadataJson);
  const nowMs = Date.now();
  const nowIso = new Date(nowMs).toISOString();

  let measuredDurationMs =
    typeof params.durationMs === "number" && Number.isFinite(params.durationMs)
      ? Math.max(0, Math.round(params.durationMs))
      : meta.lastDurationMs;

  if (params.state === "finish" && typeof params.durationMs !== "number" && meta.startedAt) {
    const startMs = Date.parse(meta.startedAt);
    if (Number.isFinite(startMs)) {
      measuredDurationMs = Math.max(0, nowMs - startMs);
    }
  }

  const exceededMax =
    params.state === "finish" &&
    meta.maxDurationSeconds !== null &&
    typeof measuredDurationMs === "number" &&
    measuredDurationMs > meta.maxDurationSeconds * 1000;

  const nextDueIso = new Date(nowMs + meta.intervalMinutes * 60 * 1000).toISOString();

  let nextState: HeartbeatState = "up";
  if (params.state === "start") nextState = "running";
  else if (params.state === "fail" || exceededMax) nextState = "failed";

  const nextMeta: CronHeartbeatMetadata = {
    ...meta,
    state: nextState,
    startedAt: params.state === "start" ? nowIso : params.state === "finish" ? null : meta.startedAt,
    lastPingAt: nowIso,
    lastDurationMs: measuredDurationMs,
    nextDueAt: params.state === "finish" ? nextDueIso : meta.nextDueAt || nextDueIso,
    alertSent: params.state === "fail" || exceededMax,
    lastMessage: params.message ? params.message.slice(0, 240) : null,
  };

  await db
    .update(projectConnectors)
    .set({
      metadataJson: JSON.stringify(nextMeta),
      lastSyncedAt: nowIso,
      updatedAt: nowIso,
    })
    .where(eq(projectConnectors.id, conn.id));

  if (params.state === "fail") {
    await dispatchHeartbeatAlert(
      conn.projectId,
      conn.label,
      params.message || "Worker reported an explicit job failure ping"
    );
  } else if (exceededMax) {
    await dispatchHeartbeatAlert(
      conn.projectId,
      conn.label,
      `Duration ${Math.round((measuredDurationMs || 0) / 1000)}s exceeded max ${meta.maxDurationSeconds}s`
    );
  }

  return { connectorId: conn.id, name: conn.label, ...nextMeta };
}

export async function checkOverdueCronHeartbeats(): Promise<{ checked: number; alerted: number }> {
  const rows = await db
    .select()
    .from(projectConnectors)
    .where(
      and(eq(projectConnectors.category, "telemetry"), eq(projectConnectors.provider, "cron_heartbeat"))
    )
    .limit(100);

  let alerted = 0;
  const nowMs = Date.now();
  const nowIso = new Date(nowMs).toISOString();

  for (const row of rows) {
    const meta = parseHeartbeatMetadata(row.metadataJson);
    if (meta.alertSent) continue;
    const { overdue, reason } = evaluateHeartbeatDue(meta, nowMs);
    if (!overdue || !reason) continue;

    const updated: CronHeartbeatMetadata = { ...meta, state: "late", alertSent: true };
    await db
      .update(projectConnectors)
      .set({ metadataJson: JSON.stringify(updated), updatedAt: nowIso })
      .where(eq(projectConnectors.id, row.id))
      .catch(() => {});

    await dispatchHeartbeatAlert(row.projectId, row.label, reason);
    alerted++;
  }

  return { checked: rows.length, alerted };
}
