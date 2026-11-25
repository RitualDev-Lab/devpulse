import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { projects, errorEvents } from "@/db/schema";
import { eq } from "drizzle-orm";
import { dispatchCrashAlerts } from "@/lib/alerts/webhook";
import { uploadCrashAttachment } from "@/lib/storage/r2";

// Enable CORS for telemetry beacons from any client
export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
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

    // Verify project exists
    const [project] = await db
      .select({
        id: projects.id,
        userId: projects.userId,
        name: projects.name,
        slug: projects.slug,
        discordWebhookUrl: projects.discordWebhookUrl,
        slackWebhookUrl: projects.slackWebhookUrl,
        telegramBotToken: projects.telegramBotToken,
        telegramChatId: projects.telegramChatId,
      })
      .from(projects)
      .where(eq(projects.telemetryApiKey, apiKey))
      .limit(1);

    if (!project) {
      return NextResponse.json({ error: "Invalid or inactive telemetry apiKey" }, { status: 403 });
    }

    const eventId = `err_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const errorName = String(body.errorName || body.name || "RuntimeError").slice(0, 255);
    const message = String(body.message || "An unexpected error occurred").slice(0, 2000);
    const rawStack = body.stackTrace || body.stack ? String(body.stackTrace || body.stack) : null;
    const stackTrace = rawStack ? rawStack.slice(0, 8000) : null;
    const runtime = String(body.runtime || "node").slice(0, 50);
    const version = body.version ? String(body.version).slice(0, 50) : null;
    const os = body.os ? String(body.os).slice(0, 100) : null;
    const environment = String(body.environment || "production").slice(0, 50);
    const reporterEmail = body.reporterEmail ? String(body.reporterEmail).slice(0, 255) : null;

    // Upload optional crash attachment or oversized log to Cloudflare R2 / BYOS
    let attachmentUrl: string | null = null;
    let storageWarning: string | undefined;
    const attachmentPayload =
      typeof body.attachment === "string" && body.attachment.length > 0
        ? body.attachment
        : rawStack && rawStack.length > 8000
          ? rawStack
          : null;

    if (attachmentPayload) {
      const uploadRes = await uploadCrashAttachment({
        userId: project.userId,
        projectId: project.id,
        eventId,
        filename: String(body.attachmentName || "crash-log.txt"),
        content: attachmentPayload.slice(0, 2_000_000),
        contentType: String(body.attachmentContentType || "text/plain; charset=utf-8"),
      }).catch(() => ({ uploaded: false, attachmentUrl: null, quotaExceeded: false, reason: undefined }));

      if (uploadRes.uploaded && uploadRes.attachmentUrl) {
        attachmentUrl = uploadRes.attachmentUrl;
      } else if (uploadRes.quotaExceeded) {
        storageWarning = uploadRes.reason;
      }
    }

    await db.insert(errorEvents).values({
      id: eventId,
      projectId: project.id,
      errorName,
      message,
      stackTrace,
      runtime,
      version,
      os,
      environment,
      status: "unresolved",
      attachmentUrl,
      reporterEmail,
    });

    // Fire instant crash alerts to Discord / Slack / Telegram (isolated async)
    dispatchCrashAlerts(
      {
        discordWebhookUrl: project.discordWebhookUrl,
        slackWebhookUrl: project.slackWebhookUrl,
        telegramBotToken: project.telegramBotToken,
        telegramChatId: project.telegramChatId,
      },
      {
        projectName: project.name,
        projectSlug: project.slug,
        errorName,
        message,
        runtime,
        version,
        os,
        environment,
        reporterEmail,
        dashboardUrl: `https://devpulse.ritualdev.in`,
      }
    ).catch((err) => console.error("Webhook alert error:", err));

    return NextResponse.json(
      {
        success: true,
        eventId,
        project: project.name,
        attachmentUrl,
        ...(storageWarning ? { storageWarning } : {}),
      },
      {
        status: 201,
        headers: {
          "Access-Control-Allow-Origin": "*",
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
