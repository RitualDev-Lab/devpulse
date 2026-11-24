import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { projects, errorEvents } from "@/db/schema";
import { eq } from "drizzle-orm";
import { dispatchCrashAlerts } from "@/lib/alerts/webhook";

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
    const stackTrace = body.stackTrace || body.stack ? String(body.stackTrace || body.stack).slice(0, 8000) : null;
    const runtime = String(body.runtime || "node").slice(0, 50);
    const version = body.version ? String(body.version).slice(0, 50) : null;
    const os = body.os ? String(body.os).slice(0, 100) : null;
    const environment = String(body.environment || "production").slice(0, 50);
    const reporterEmail = body.reporterEmail ? String(body.reporterEmail).slice(0, 255) : null;

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
