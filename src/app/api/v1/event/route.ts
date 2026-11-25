import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { errorEvents, projectReleases } from "@/db/schema";
import { eq, and, sql } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth";
import { dispatchCrashAlerts } from "@/lib/alerts/webhook";
import { checkAndReserveStorageQuota } from "@/lib/storage/quota";
import { putR2Object } from "@/lib/storage/r2";
import { hashApiKey, verifyTelemetryApiKey } from "@/lib/security/api-keys";
import { checkRateLimit } from "@/lib/security/rate-limit";
import { resolveProjectAccess } from "@/lib/security/rbac";
import { recordAuditEvent } from "@/lib/security/audit";
import { decryptSecret } from "@/lib/security/crypto";
import { buildFatalCrashEmailHtml, sendTransactionalEmail } from "@/lib/alerts/email";

const R2_OFFLOAD_THRESHOLD_BYTES = 4096; // Offload payloads > 4KB (e.g. 100KB+ traces & terminal dumps) to R2
const MAX_TURSO_PREVIEW_CHARS = 2000;

// Enable CORS for telemetry beacons from any client
export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, PATCH, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    },
  });
}

export async function POST(req: NextRequest) {
  try {
    const authHeader = req.headers.get("authorization");
    let body: any = {};
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    // Extract API key either from Authorization header or body
    const apiKey = authHeader?.replace(/^Bearer\s+/i, "") || body.apiKey || body.key || body.api_key;
    if (!apiKey) {
      return NextResponse.json({ error: "Missing telemetry apiKey" }, { status: 401 });
    }

    const rawKeyStr = String(apiKey);
    const keyHashPrefix = (await hashApiKey(rawKeyStr)).slice(0, 16);

    // Rate limit: max 500 telemetry beacons / min per API key
    const rl = await checkRateLimit({
      key: `event:${keyHashPrefix}`,
      limit: 500,
      windowSeconds: 60,
    });

    if (!rl.allowed) {
      return NextResponse.json(
        {
          error: "Telemetry rate limit exceeded (max 500 beacons/min per API key).",
          code: "RATE_LIMIT_EXCEEDED",
          retryAfterSeconds: rl.retryAfterSeconds,
        },
        {
          status: 429,
          headers: {
            "Access-Control-Allow-Origin": "*",
            "Retry-After": String(rl.retryAfterSeconds),
            "X-RateLimit-Limit": String(rl.limit),
            "X-RateLimit-Remaining": "0",
            "X-RateLimit-Reset": String(rl.resetAtEpoch),
          },
        }
      );
    }

    // Verify project via SHA-256 key hash lookup (rejects rotated/revoked keys)
    const project = await verifyTelemetryApiKey(rawKeyStr);

    if (!project) {
      return NextResponse.json(
        { error: "Invalid, rotated, or revoked telemetry apiKey" },
        { status: 403 }
      );
    }

    const eventId = `err_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const errorName = String(body.errorName || body.error_name || body.name || "RuntimeError").slice(0, 255);
    const message = String(body.message || "An unexpected error occurred").slice(0, 2000);
    const rawStack = body.stackTrace || body.stack_trace || body.stack ? String(body.stackTrace || body.stack_trace || body.stack) : "";
    const rawLogs = body.terminalLogs || body.terminal_logs || body.logs ? String(body.terminalLogs || body.terminal_logs || body.logs) : "";
    const runtime = String(body.runtime || "node").slice(0, 50);
    const version = (body.version || body.release) ? String(body.version || body.release).slice(0, 50) : null;
    const os = body.os ? String(body.os).slice(0, 100) : null;
    const environment = String(body.environment || "production").slice(0, 50);
    const reporterEmail = body.reporterEmail || body.reporter_email ? String(body.reporterEmail || body.reporter_email).slice(0, 255) : null;
    const attachmentUrl = body.attachmentKey || body.attachmentUrl || body.attachment_url
      ? String(body.attachmentKey || body.attachmentUrl || body.attachment_url).slice(0, 512)
      : null;

    const rawBreadcrumbs = Array.isArray(body.breadcrumbs) ? body.breadcrumbs.slice(-50) : null;
    const breadcrumbsJson = rawBreadcrumbs ? JSON.stringify(rawBreadcrumbs).slice(0, 12000) : null;
    let commitSha: string | null = body.commitSha || body.commit_sha ? String(body.commitSha || body.commit_sha).slice(0, 64) : null;

    // Release Health & Commit Attribution correlation
    if (version) {
      const [rel] = await db
        .select()
        .from(projectReleases)
        .where(and(eq(projectReleases.projectId, project.id), eq(projectReleases.version, version)))
        .limit(1);

      if (rel) {
        if (!commitSha && rel.commitSha) commitSha = rel.commitSha;
        await db
          .update(projectReleases)
          .set({ crashCount: sql`${projectReleases.crashCount} + 1` })
          .where(eq(projectReleases.id, rel.id))
          .catch(() => {});
      } else {
        await db
          .insert(projectReleases)
          .values({
            id: `rel_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`,
            projectId: project.id,
            version,
            commitSha,
            source: "sdk",
            totalSessions: 1,
            crashCount: 1,
          })
          .catch(() => {});
      }
    }

    // Combine heavy diagnostic payload (stackTrace + terminal output logs)
    const combinedPayload = rawLogs
      ? `${rawStack ? rawStack + "\n\n" : ""}--- TERMINAL OUTPUT LOGS ---\n${rawLogs}`
      : rawStack;

    const payloadBytes = combinedPayload ? new TextEncoder().encode(combinedPayload).byteLength : 0;

    let storedInlinePreview: string | null = combinedPayload ? combinedPayload.slice(0, MAX_TURSO_PREVIEW_CHARS) : null;
    let r2ObjectKey: string | null = null;
    let storageProvider: string = "turso";
    let quotaExceeded = false;

    // Tiered Storage Architecture: Offload heavy 4KB-100KB+ payloads to Cloudflare R2 / BYOS
    if (payloadBytes > R2_OFFLOAD_THRESHOLD_BYTES || rawLogs.length > 0) {
      const quota = await checkAndReserveStorageQuota(project.userId, payloadBytes);
      if (quota.allowed && quota.context.credentials) {
        const key = `${quota.context.prefix}/${project.userId}/${project.id}/crashes/${eventId}.log`;
        const putRes = await putR2Object(
          quota.context.credentials,
          key,
          combinedPayload,
          "text/plain; charset=utf-8"
        );

        if (putRes.ok) {
          r2ObjectKey = key;
          storageProvider = quota.context.provider;
          if (combinedPayload.length > MAX_TURSO_PREVIEW_CHARS) {
            storedInlinePreview = `${combinedPayload.slice(0, MAX_TURSO_PREVIEW_CHARS)}\n\n... [Truncated preview — full ${Math.round(payloadBytes / 1024)} KB crash dump stored in R2]`;
          }
        }
      } else if (!quota.allowed) {
        quotaExceeded = true;
      }
    }

    await db.insert(errorEvents).values({
      id: eventId,
      projectId: project.id,
      errorName,
      message,
      stackTrace: storedInlinePreview,
      runtime,
      version,
      os,
      environment,
      status: "unresolved",
      attachmentUrl,
      r2ObjectKey,
      payloadSizeBytes: payloadBytes,
      storageProvider,
      reporterEmail,
      breadcrumbsJson,
      commitSha,
    });

    // Fire instant crash alerts to Discord / Slack / Telegram / Generic Webhook
    const hasWebhooks = Boolean(
      project.discordWebhookUrl ||
      project.slackWebhookUrl ||
      (project.telegramBotToken && project.telegramChatId) ||
      project.genericWebhookUrl ||
      project.pagerdutyRoutingKey
    );

    if (hasWebhooks) {
      await dispatchCrashAlerts(
        {
          discordWebhookUrl: project.discordWebhookUrl,
          slackWebhookUrl: project.slackWebhookUrl,
          telegramBotToken: project.telegramBotToken,
          telegramChatId: project.telegramChatId,
          genericWebhookUrl: project.genericWebhookUrl,
          pagerdutyRoutingKey: project.pagerdutyRoutingKey,
        },
        {
          eventId,
          projectName: project.name,
          projectSlug: project.slug,
          errorName,
          message,
          runtime,
          version,
          os,
          environment,
          reporterEmail,
          r2ObjectKey,
          payloadSizeBytes: payloadBytes,
          dashboardUrl: `https://devpulse.ritualdev.in/dashboard?project=${project.slug}`,
        }
      ).catch((err) => console.error("Webhook alert error:", err));
    }

    if (project.notificationEmail) {
      const emailKey = await decryptSecret(project.emailApiKeyEncrypted);
      await sendTransactionalEmail({
        to: project.notificationEmail,
        subject: `[DevPulse Fatal Crash] ${errorName} in ${project.name} (${version || runtime})`,
        html: buildFatalCrashEmailHtml({
          projectName: project.name,
          errorName,
          message,
          runtime,
          version,
          environment,
          dashboardUrl: `https://devpulse.ritualdev.in/dashboard?project=${project.slug}`,
        }),
        provider: project.emailProvider,
        apiKey: emailKey,
      }).catch((err) => console.error("Email alert error:", err));
    }

    return NextResponse.json(
      {
        success: true,
        eventId,
        project: project.name,
        storage: {
          provider: storageProvider,
          r2ObjectKey,
          payloadSizeBytes: payloadBytes,
          quotaExceeded,
        },
      },
      {
        status: 201,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "X-RateLimit-Limit": String(rl.limit),
          "X-RateLimit-Remaining": String(rl.remaining),
          "X-RateLimit-Reset": String(rl.resetAtEpoch),
        },
      }
    );
  } catch (err: any) {
    console.error("Error ingesting telemetry event:", err);
    return NextResponse.json(
      { error: "Internal Server Error", details: err?.message },
      { status: 500 }
    );
  }
}

/**
 * Update error event status (unresolved | resolved | ignored) scoped to project owner
 */
export async function PATCH(req: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const { eventId, projectId, status } = body;

    if (!eventId || !projectId || !["unresolved", "resolved", "ignored"].includes(status)) {
      return NextResponse.json({ error: "Invalid eventId, projectId, or status" }, { status: 400 });
    }

    // Enforce RBAC: Viewer is read-only; Maintainer/Owner can triage errors
    const access = await resolveProjectAccess(String(projectId), user);
    if (!access || !access.canWrite) {
      await recordAuditEvent({
        userId: user.id,
        actorUsername: user.githubUsername,
        projectId: String(projectId),
        action: "crash.status_changed",
        resourceType: "error_event",
        resourceId: String(eventId),
        status: "denied",
        headers: req.headers,
        metadata: { targetStatus: status, role: access?.role || "none" },
      });
      return NextResponse.json(
        { error: "Forbidden: Viewer role cannot modify crash statuses." },
        { status: 403 }
      );
    }

    await db
      .update(errorEvents)
      .set({ status })
      .where(and(eq(errorEvents.id, eventId), eq(errorEvents.projectId, projectId)));

    await recordAuditEvent({
      userId: user.id,
      actorUsername: user.githubUsername,
      organizationId: access.project.organizationId,
      projectId: access.project.id,
      action: "crash.status_changed",
      resourceType: "error_event",
      resourceId: String(eventId),
      headers: req.headers,
      metadata: { status },
    });

    return NextResponse.json({ success: true, eventId, status });
  } catch (err: any) {
    console.error("PATCH /api/v1/event error:", err);
    return NextResponse.json(
      { error: "Failed to update event status", details: err?.message },
      { status: 500 }
    );
  }
}
