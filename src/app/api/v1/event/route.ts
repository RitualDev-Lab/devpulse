import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { crashIssues, deployments, errorEvents, otelTraces, projectReleases, projects, workspaces } from "@/db/schema";
import { eq, and, desc, gt, lt, or, sql } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth";
import { dispatchCrashAlerts, resolveDecryptedWebhookConfig } from "@/lib/alerts/webhook";
import { evaluateProjectAlertRules } from "@/lib/alerts/smart-engine";
import { checkAndAutoRollbackFlags } from "@/lib/flags/flag-engine";
import { buildFlagUserHash } from "@/lib/flags/user-hash";
import {
  computeBusinessImpact,
  computeSemanticGroupKey,
  extractCountryCode,
} from "@/lib/crashes/impact";
import { recordCrashIssueOccurrence } from "@/lib/crashes/issues";
import { maybeAutoEscalateGitHubIssue } from "@/lib/crashes/github-auto";
import { scrubBreadcrumbs, scrubTelemetryText } from "@/lib/security/ingest-scrub";
import { checkAndReserveStorageQuota, confirmPendingUpload } from "@/lib/storage/quota";
import { putR2Object } from "@/lib/storage/r2";
import { hashApiKey, verifyTelemetryApiKey } from "@/lib/security/api-keys";
import { checkRateLimit } from "@/lib/security/rate-limit";
import { resolveProjectAccess } from "@/lib/security/rbac";
import { recordAuditEvent } from "@/lib/security/audit";
import { decryptSecret } from "@/lib/security/crypto";
import { isValidProjectR2ObjectKey } from "@/lib/security/ssrf";
import { buildFatalCrashEmailHtml, sendTransactionalEmail } from "@/lib/alerts/email";
import { apiError } from "@/lib/security/api-error";
import { PUBLIC_APP_URL } from "@/lib/config/app-url";
import {
  getMaxEventBytes,
  readBoundedRequestText,
  reserveAtomicEventQuotaSlot,
  validateEventIngestPayload,
} from "@/lib/validation/event-ingest";

const R2_OFFLOAD_THRESHOLD_BYTES = 4096; // Offload payloads > 4KB (e.g. 100KB+ traces & terminal dumps) to R2
const MAX_TURSO_PREVIEW_CHARS = 2000;

// Enable CORS for telemetry beacons from any client
export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, PATCH, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    },
  });
}

/**
 * GET /api/v1/event?project=<id|slug>&status=...&limit=30&since=<iso>
 * Authenticated crash stream endpoint for `devpulse crashes [--tail] [--json]` CLI and dashboards.
 */
export async function GET(req: NextRequest) {
  try {
    const authHeader = req.headers.get("authorization");
    const bearerKey = authHeader?.replace(/^Bearer\s+/i, "").trim();
    const projectParam = req.nextUrl.searchParams.get("project")?.trim();
    const statusParam = (req.nextUrl.searchParams.get("status") || "all").toLowerCase();
    const sinceParam = req.nextUrl.searchParams.get("since")?.trim();
    const limit = Math.min(100, Math.max(1, Number(req.nextUrl.searchParams.get("limit") || 25)));

    let targetProject: { id: string; name: string; slug: string } | null = null;

    if (bearerKey) {
      const verified = await verifyTelemetryApiKey(bearerKey);
      if (!verified) {
        return NextResponse.json({ error: "Invalid or revoked telemetry API key" }, { status: 403 });
      }
      if (projectParam && verified.id !== projectParam && verified.slug !== projectParam) {
        return NextResponse.json(
          { error: "Forbidden: API key does not match requested project" },
          { status: 403 }
        );
      }
      targetProject = { id: verified.id, name: verified.name, slug: verified.slug };
    } else {
      const user = await getCurrentUser();
      if (!user) {
        return NextResponse.json(
          { error: "Unauthorized: pass Authorization: Bearer <apiKey> or sign in" },
          { status: 401 }
        );
      }
      if (!projectParam) {
        return NextResponse.json({ error: "Missing project parameter" }, { status: 400 });
      }
      const [found] = await db
        .select({ id: projects.id, name: projects.name, slug: projects.slug })
        .from(projects)
        .where(or(eq(projects.id, projectParam), eq(projects.slug, projectParam)))
        .limit(1);
      if (!found) {
        return NextResponse.json({ error: "Project not found" }, { status: 404 });
      }
      const access = await resolveProjectAccess(found.id, user);
      if (!access || !access.canRead) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
      targetProject = found;
    }

    const conditions = [eq(errorEvents.projectId, targetProject.id)];
    if (["unresolved", "resolved", "ignored"].includes(statusParam)) {
      conditions.push(eq(errorEvents.status, statusParam as "unresolved" | "resolved" | "ignored"));
    }
    if (sinceParam) {
      conditions.push(gt(errorEvents.createdAt, sinceParam));
    }

    const [events, issues] = await Promise.all([
      db
        .select({
          id: errorEvents.id,
          errorName: errorEvents.errorName,
          message: errorEvents.message,
          runtime: errorEvents.runtime,
          platform: errorEvents.platform,
          errorCategory: errorEvents.errorCategory,
          version: errorEvents.version,
          environment: errorEvents.environment,
          status: errorEvents.status,
          fingerprint: errorEvents.fingerprint,
          impactScore: errorEvents.impactScore,
          isRegression: errorEvents.isRegression,
          createdAt: errorEvents.createdAt,
        })
        .from(errorEvents)
        .where(and(...conditions))
        .orderBy(desc(errorEvents.createdAt))
        .limit(limit),
      db
        .select()
        .from(crashIssues)
        .where(eq(crashIssues.projectId, targetProject.id))
        .orderBy(desc(crashIssues.lastSeenAt))
        .limit(25)
        .catch(() => []),
    ]);

    return NextResponse.json({
      project: targetProject,
      count: events.length,
      events,
      issues,
    });
  } catch (err: any) {
    console.error("GET /api/v1/event error:", err);
    return apiError(err, "Failed to fetch crash events", 500);
  }
}

export async function POST(req: NextRequest) {
  try {
    const maxBytes = getMaxEventBytes();
    const contentLengthHeader = req.headers.get("content-length");
    if (contentLengthHeader) {
      const declaredBytes = Number(contentLengthHeader);
      if (Number.isFinite(declaredBytes) && declaredBytes > maxBytes) {
        return NextResponse.json(
          { error: `Payload exceeds maximum allowed size (${maxBytes} bytes). Upload oversized logs via /api/v1/storage/presign.` },
          { status: 413 }
        );
      }
    }

    const authHeader = req.headers.get("authorization");
    const headerApiKey = authHeader?.replace(/^Bearer\s+/i, "").trim() || "";

    // Enforce API-key rate limit BEFORE reading/parsing JSON when Authorization header is provided
    let headerRl: Awaited<ReturnType<typeof checkRateLimit>> | null = null;
    if (headerApiKey) {
      const keyHashPrefix = (await hashApiKey(headerApiKey)).slice(0, 16);
      headerRl = await checkRateLimit({
        key: `event:${keyHashPrefix}`,
        limit: 500,
        windowSeconds: 60,
      });
      if (!headerRl.allowed) {
        return NextResponse.json(
          {
            error: "Telemetry rate limit exceeded (max 500 beacons/min per API key).",
            code: "RATE_LIMIT_EXCEEDED",
            retryAfterSeconds: headerRl.retryAfterSeconds,
          },
          {
            status: 429,
            headers: {
              "Access-Control-Allow-Origin": "*",
              "Retry-After": String(headerRl.retryAfterSeconds),
              "X-RateLimit-Limit": String(headerRl.limit),
              "X-RateLimit-Remaining": "0",
              "X-RateLimit-Reset": String(headerRl.resetAtEpoch),
            },
          }
        );
      }
    }

    const bounded = await readBoundedRequestText(req, maxBytes);
    if (!bounded.ok) {
      return NextResponse.json({ error: bounded.error }, { status: bounded.status });
    }
    const rawText = bounded.text;

    let body: any = {};
    try {
      body = rawText ? JSON.parse(rawText) : {};
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const validatedSchema = validateEventIngestPayload(body);
    if (!validatedSchema.ok) {
      return NextResponse.json({ error: validatedSchema.error }, { status: 400 });
    }

    // Extract API key either from Authorization header or body fallback
    const apiKey = headerApiKey || body.apiKey || body.key || body.api_key;
    if (!apiKey) {
      return NextResponse.json({ error: "Missing telemetry apiKey" }, { status: 401 });
    }

    const rawKeyStr = String(apiKey);
    let rl = headerRl;
    if (!rl) {
      const keyHashPrefix = (await hashApiKey(rawKeyStr)).slice(0, 16);
      rl = await checkRateLimit({
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
    }

    // Verify project via SHA-256 key hash lookup (rejects rotated/revoked keys)
    const project = await verifyTelemetryApiKey(rawKeyStr);

    if (!project) {
      return NextResponse.json(
        { error: "Invalid, rotated, or revoked telemetry apiKey" },
        { status: 403 }
      );
    }

    // Enforce Workspace Monthly Event Cap atomically (awaited conditional increment prevents concurrency race)
    if (project.workspaceId) {
      const workspaceId = project.workspaceId;
      const quotaRes = await reserveAtomicEventQuotaSlot(async () => {
        const [incremented] = await db
          .update(workspaces)
          .set({ monthlyEventsUsed: sql`${workspaces.monthlyEventsUsed} + 1` })
          .where(
            and(
              eq(workspaces.id, workspaceId),
              lt(workspaces.monthlyEventsUsed, workspaces.monthlyEventLimit)
            )
          )
          .returning({ id: workspaces.id });
        return Boolean(incremented);
      });

      if (!quotaRes.allowed) {
        const [ws] = await db
          .select({ name: workspaces.name, monthlyEventLimit: workspaces.monthlyEventLimit })
          .from(workspaces)
          .where(eq(workspaces.id, workspaceId))
          .limit(1);
        if (ws) {
          return NextResponse.json(
            {
              error: `Workspace '${ws.name}' monthly event cap (${ws.monthlyEventLimit.toLocaleString()}) exceeded.`,
              code: "WORKSPACE_EVENT_CAP_EXCEEDED",
            },
            { status: 429 }
          );
        }
      }
    }

    const eventId = `err_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const errorName = scrubTelemetryText(
      String(body.errorName || body.error_name || body.name || "RuntimeError").slice(0, 255)
    );
    const message = scrubTelemetryText(
      String(body.message || "An unexpected error occurred").slice(0, 2000)
    );
    const rawStack = validatedSchema.value.rawStack
      ? scrubTelemetryText(validatedSchema.value.rawStack)
      : "";
    const rawLogs = validatedSchema.value.rawLogs
      ? scrubTelemetryText(validatedSchema.value.rawLogs)
      : "";
    const runtime = String(body.runtime || "node").slice(0, 50);
    const version = (body.version || body.release) ? String(body.version || body.release).slice(0, 50) : null;
    const os = body.os ? String(body.os).slice(0, 100) : null;
    const environment = String(body.environment || "production").slice(0, 50);
    // Reporter email is end-user PII. Telemetry ingest does not store it; contact details belong to the report form.
    // Not collected: the public ingest path no longer stores reporter email (see fc245cf).
    const reporterEmail: string | null = null;
    const rawAttachment = body.attachmentKey || body.attachmentUrl || body.attachment_url;
    let attachmentUrl: string | null = null;
    if (rawAttachment) {
      if (!isValidProjectR2ObjectKey(rawAttachment, project.id, project.userId)) {
        return NextResponse.json(
          { error: "Invalid attachmentKey: must be a project-scoped R2 object key." },
          { status: 400 }
        );
      }
      attachmentUrl = rawAttachment.trim();
      await confirmPendingUpload(attachmentUrl, project.userId);
    }

    const rawBreadcrumbs = Array.isArray(body.breadcrumbs) ? scrubBreadcrumbs(body.breadcrumbs.slice(-50)) : [];
    const rawReplay = validatedSchema.value.replayFrames;
    const replayBreadcrumbs = rawReplay.map((f) => ({
      timestamp: f.tIso,
      category: "replay",
      level: f.kind,
      message: scrubTelemetryText(f.label),
      data: {
        offsetMs: f.offsetMs,
        detail: f.detail ? scrubTelemetryText(f.detail) : undefined,
      },
    }));
    const mergedTimeline = [...rawBreadcrumbs, ...replayBreadcrumbs];
    const breadcrumbsJson = mergedTimeline.length > 0 ? JSON.stringify(mergedTimeline).slice(0, 16000) : null;
    let commitSha: string | null = body.commitSha || body.commit_sha ? String(body.commitSha || body.commit_sha).slice(0, 64) : null;
    const traceId: string | null = body.traceId || body.trace_id ? String(body.traceId || body.trace_id).slice(0, 64) : null;
    const routePath: string | null = body.routePath || body.route || body.path ? String(body.routePath || body.route || body.path).slice(0, 200) : null;
    const platform = String(body.platform || (runtime === "browser" ? "web" : runtime)).slice(0, 32);
    const errorCategory = (["exception", "oom", "anr", "network"].includes(String(body.errorCategory || body.category || "").toLowerCase())
      ? String(body.errorCategory || body.category).toLowerCase()
      : "exception") as "exception" | "oom" | "anr" | "network";
    const deviceModel: string | null = body.deviceModel ? String(body.deviceModel).slice(0, 80) : null;
    const appBuild: string | null = body.appBuild ? String(body.appBuild).slice(0, 40) : null;
    const flagKey: string | null = body.flagKey ? String(body.flagKey).slice(0, 80) : null;
    const flagVariant: string | null = body.flagVariant ? String(body.flagVariant).slice(0, 60) : null;
    const flagUserHash = await buildFlagUserHash({
      secret: process.env.ANALYTICS_HASH_SECRET || "",
      projectId: project.id,
      flagKey: flagKey || "",
      userId: body.flagUserId ? String(body.flagUserId) : null,
    });
    const affectedUsersCount = validatedSchema.value.affectedUsersCount;
    const countryCode = extractCountryCode(req.headers, body);
    const aiGroupKey = computeSemanticGroupKey(errorName, message, rawStack);
    const impact = computeBusinessImpact({
      routePath,
      message,
      affectedUsersCount,
      environment,
    });

    // Regression Detection: check if this semantic error group (or errorName) was previously resolved
    const [priorResolved] = await db
      .select({ id: errorEvents.id })
      .from(errorEvents)
      .where(
        and(
          eq(errorEvents.projectId, project.id),
          eq(errorEvents.status, "resolved"),
          eq(errorEvents.aiGroupKey, aiGroupKey)
        )
      )
      .limit(1);
    const isRegression = Boolean(priorResolved);

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

    // Combine heavy diagnostic payload (stackTrace + terminal output logs + R2 session replay)
    const replayDump =
      rawReplay.length > 0
        ? `\n\n--- SESSION REPLAY TIMELINE (${rawReplay.length} frames) ---\n${JSON.stringify(replayBreadcrumbs)}`
        : "";
    const baseLogs = rawLogs
      ? `${rawStack ? rawStack + "\n\n" : ""}--- TERMINAL OUTPUT LOGS ---\n${rawLogs}`
      : rawStack || "";
    const combinedPayload = baseLogs || replayDump ? `${baseLogs}${replayDump}`.trim() : null;

    const payloadBytes = combinedPayload ? new TextEncoder().encode(combinedPayload).byteLength : 0;

    let storedInlinePreview: string | null = combinedPayload ? combinedPayload.slice(0, MAX_TURSO_PREVIEW_CHARS) : null;
    let r2ObjectKey: string | null = null;
    let storageProvider: string = "turso";
    let quotaExceeded = false;

    // Tiered Storage Architecture: Offload heavy 4KB-100KB+ payloads to Cloudflare R2 / BYOS
    if (combinedPayload && (payloadBytes > R2_OFFLOAD_THRESHOLD_BYTES || rawLogs.length > 0 || rawReplay.length > 0)) {
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

    const issueSummary = await recordCrashIssueOccurrence({
      projectId: project.id,
      errorName,
      stackTrace: rawStack,
      explicitRegression: isRegression,
    });

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
      traceId,
      fingerprint: issueSummary.fingerprint,
      aiGroupKey,
      isRegression: issueSummary.isRegression,
      affectedUsersCount,
      countryCode,
      routePath,
      estimatedLostRevenueCents: impact.estimatedLostRevenueCents,
      impactScore: impact.impactScore,
      platform,
      errorCategory,
      deviceModel,
      appBuild,
      flagKey,
      flagVariant,
      flagUserHash,
    });

    // Link trace -> crash bi-directionally & increment matching deployment crashCount
    if (traceId) {
      db.update(otelTraces)
        .set({ linkedErrorId: eventId, status: "error" })
        .where(and(eq(otelTraces.projectId, project.id), eq(otelTraces.traceId, traceId)))
        .catch(() => {});
    }
    if (version) {
      db.update(deployments)
        .set({ crashCount: sql`${deployments.crashCount} + 1` })
        .where(and(eq(deployments.projectId, project.id), eq(deployments.version, version)))
        .catch(() => {});
    }

    // Fire instant crash alerts only when anti-storm fingerprint/cooldown gate allows (prevents crash-loop floods)
    const hasWebhooks = Boolean(
      project.discordWebhookUrl ||
      project.slackWebhookUrl ||
      (project.telegramBotToken && project.telegramChatId) ||
      project.genericWebhookUrl ||
      project.pagerdutyRoutingKey ||
      project.opsgenieApiKeyEncrypted ||
      project.teamsWebhookUrl
    );

    const notificationTasks: Promise<unknown>[] = [];

    if (issueSummary.shouldAlert && hasWebhooks) {
      notificationTasks.push(
        resolveDecryptedWebhookConfig(project)
          .then((webhookConfig) =>
            dispatchCrashAlerts(webhookConfig, {
              eventId,
              fingerprint: issueSummary.fingerprint,
              occurrenceCount: issueSummary.occurrenceCount,
              projectName: project.name,
              projectSlug: project.slug,
              errorName:
                issueSummary.occurrenceCount > 1
                  ? `${errorName} (×${issueSummary.occurrenceCount})`
                  : errorName,
              message,
              runtime,
              version,
              os,
              environment,
              reporterEmail,
              r2ObjectKey,
              payloadSizeBytes: payloadBytes,
              dashboardUrl: `${PUBLIC_APP_URL}/dashboard?project=${project.slug}`,
            })
          )
          .catch((err) => console.error("Webhook alert error:", err))
      );
    }

    if (issueSummary.shouldAlert && project.notificationEmail) {
      notificationTasks.push(
        decryptSecret(project.emailApiKeyEncrypted)
          .then((emailKey) =>
            sendTransactionalEmail({
              to: project.notificationEmail!,
              subject: `[DevPulse Fatal Crash] ${errorName} in ${project.name} (${version || runtime})`,
              html: buildFatalCrashEmailHtml({
                projectName: project.name,
                errorName,
                message,
                runtime,
                version,
                environment,
                dashboardUrl: `${PUBLIC_APP_URL}/dashboard?project=${project.slug}`,
              }),
              provider: project.emailProvider,
              apiKey: emailKey,
            })
          )
          .catch((err) => console.error("Email alert error:", err))
      );
    }

    if (notificationTasks.length > 0) {
      // Bound crash alert dispatch strictly under 3.5s so slow webhooks never stall ingestion responses
      await Promise.race([
        Promise.allSettled(notificationTasks),
        new Promise((resolve) => setTimeout(resolve, 3500)),
      ]);
    }

    // Run Smart Alert Rules & Z-Score Anomaly Detector + Feature Flag Crash Auto-Rollback + GitHub Auto-Issue Escalation
    const [, , githubEscalation] = await Promise.all([
      evaluateProjectAlertRules(project.id).catch((err) =>
        console.error("Smart alert rule evaluation warning:", err)
      ),
      checkAndAutoRollbackFlags(project.id).catch((err) =>
        console.error("Flag rollback guard warning:", err)
      ),
      maybeAutoEscalateGitHubIssue({
        project,
        eventId,
        fingerprint: issueSummary.fingerprint,
        occurrenceCount: issueSummary.occurrenceCount,
        isRegression: issueSummary.isRegression,
        errorName,
        message,
        stackPreview: storedInlinePreview,
        runtime,
        version,
        environment,
        routePath,
        r2ObjectKey,
      }).catch(() => ({ created: false })),
    ]);

    return NextResponse.json(
      {
        success: true,
        eventId,
        fingerprint: issueSummary.fingerprint,
        occurrenceCount: issueSummary.occurrenceCount,
        alertDispatched: issueSummary.shouldAlert,
        githubAutoIssue: githubEscalation,
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
    return apiError(err, "Internal Server Error", 500);
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
    return apiError(err, "Failed to update event status", 500);
  }
}
