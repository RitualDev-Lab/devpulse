import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { projects, errorEvents } from "@/db/schema";
import { eq } from "drizzle-orm";
import { checkRateLimit, getClientIp, verifyTurnstileToken } from "@/lib/security/rate-limit";
import { checkAndReserveStorageQuota, confirmPendingUpload } from "@/lib/storage/quota";
import { putR2Object } from "@/lib/storage/r2";
import { dispatchCrashAlerts, resolveDecryptedWebhookConfig } from "@/lib/alerts/webhook";
import { isValidProjectR2ObjectKey } from "@/lib/security/ssrf";
import { recordCrashIssueOccurrence } from "@/lib/crashes/issues";
import { apiError } from "@/lib/security/api-error";
import { scrubTelemetryText } from "@/lib/security/ingest-scrub";
import { PUBLIC_APP_URL } from "@/lib/config/app-url";

const R2_OFFLOAD_THRESHOLD_BYTES = 4096;
const MAX_TURSO_PREVIEW_CHARS = 2000;

export async function POST(req: NextRequest) {
  try {
    const ip = getClientIp(req.headers);

    // Rate limit public bug reports to 20 per minute per IP
    const rl = await checkRateLimit({
      key: `report:${ip}`,
      limit: 20,
      windowSeconds: 60,
    });
    if (!rl.allowed) {
      return NextResponse.json(
        { error: "Too many bug reports from this IP. Please retry in a minute." },
        {
          status: 429,
          headers: {
            "Retry-After": String(rl.retryAfterSeconds),
            "X-RateLimit-Limit": String(rl.limit),
            "X-RateLimit-Remaining": "0",
          },
        }
      );
    }

    const body = await req.json();
    const {
      projectSlug,
      turnstileToken,
      errorName,
      message,
      stackTrace,
      runtime,
      attachmentKey,
    } = body;

    if (!projectSlug || !message) {
      return NextResponse.json(
        { error: "Missing projectSlug or description message." },
        { status: 400 }
      );
    }

    // Verify Cloudflare Turnstile bot challenge
    const turnstileCheck = await verifyTurnstileToken(turnstileToken, ip);
    if (!turnstileCheck.ok) {
      return NextResponse.json(
        { error: turnstileCheck.error || "Bot verification failed.", code: "TURNSTILE_FAILED" },
        { status: 403 }
      );
    }

    const [project] = await db
      .select()
      .from(projects)
      .where(eq(projects.slug, String(projectSlug)))
      .limit(1);

    if (!project) {
      return NextResponse.json({ error: "Project not found." }, { status: 404 });
    }

    const eventId = `err_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const safeErrorName = String(errorName || "UserReportedBug").slice(0, 255);
    const safeMessage = scrubTelemetryText(String(message)).slice(0, 2000);
    const rawStack = stackTrace ? String(stackTrace) : "";
    const payloadBytes = rawStack ? new TextEncoder().encode(rawStack).byteLength : 0;

    let storedInlinePreview: string | null = rawStack
      ? rawStack.slice(0, MAX_TURSO_PREVIEW_CHARS)
      : null;
    let r2ObjectKey: string | null = null;
    let storageProvider = "turso";

    if (payloadBytes > R2_OFFLOAD_THRESHOLD_BYTES) {
      const quota = await checkAndReserveStorageQuota(project.userId, payloadBytes);
      if (quota.allowed && quota.context.credentials) {
        const key = `${quota.context.prefix}/${project.userId}/${project.id}/crashes/${eventId}.log`;
        const putRes = await putR2Object(
          quota.context.credentials,
          key,
          rawStack,
          "text/plain; charset=utf-8"
        );
        if (putRes.ok) {
          r2ObjectKey = key;
          storageProvider = quota.context.provider;
          if (rawStack.length > MAX_TURSO_PREVIEW_CHARS) {
            storedInlinePreview = `${rawStack.slice(0, MAX_TURSO_PREVIEW_CHARS)}\n\n... [Full dump stored in R2]`;
          }
        }
      }
    }

    let validatedAttachmentKey: string | null = null;
    if (attachmentKey) {
      if (!isValidProjectR2ObjectKey(attachmentKey, project.id, project.userId)) {
        return NextResponse.json(
          { error: "Invalid attachmentKey: must be a project-scoped R2 object key." },
          { status: 400 }
        );
      }
      validatedAttachmentKey = attachmentKey.trim();
      await confirmPendingUpload(validatedAttachmentKey, project.userId);
    }

    const issueSummary = await recordCrashIssueOccurrence({
      projectId: project.id,
      errorName: safeErrorName,
      stackTrace: rawStack,
    });

    await db.insert(errorEvents).values({
      id: eventId,
      projectId: project.id,
      errorName: safeErrorName,
      message: safeMessage,
      stackTrace: storedInlinePreview,
      runtime: String(runtime || "cli").slice(0, 50),
      environment: "production",
      status: "unresolved",
      attachmentUrl: validatedAttachmentKey,
      r2ObjectKey,
      payloadSizeBytes: payloadBytes,
      storageProvider,
      fingerprint: issueSummary.fingerprint,
      // Not stored: no read path uses it, and it is personal data from anonymous reporters.
      reporterEmail: null,
    });

    if (
      issueSummary.shouldAlert &&
      (project.discordWebhookUrl ||
        project.slackWebhookUrl ||
        (project.telegramBotToken && project.telegramChatId) ||
        project.genericWebhookUrl ||
        project.pagerdutyRoutingKey ||
        project.opsgenieApiKeyEncrypted ||
        project.teamsWebhookUrl)
    ) {
      const webhookConfig = await resolveDecryptedWebhookConfig(project);
      await dispatchCrashAlerts(
        webhookConfig,
        {
          eventId,
          fingerprint: issueSummary.fingerprint,
          occurrenceCount: issueSummary.occurrenceCount,
          projectName: project.name,
          projectSlug: project.slug,
          errorName: safeErrorName,
          message: safeMessage,
          runtime: String(runtime || "cli"),
          environment: "production",
          r2ObjectKey,
          payloadSizeBytes: payloadBytes,
          dashboardUrl: `${PUBLIC_APP_URL}/dashboard?project=${project.slug}`,
        }
      ).catch(() => {});
    }

    return NextResponse.json({ success: true, eventId }, { status: 201 });
  } catch (err: any) {
    console.error("POST /api/v1/report error:", err);
    return apiError(err, "Failed to submit bug report", 500);
  }
}
