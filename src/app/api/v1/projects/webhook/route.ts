import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { projects } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth";
import { dispatchCrashAlerts } from "@/lib/alerts/webhook";

export async function POST(req: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const {
      projectId,
      discordWebhookUrl,
      slackWebhookUrl,
      telegramBotToken,
      telegramChatId,
      genericWebhookUrl,
      testPing,
    } = body;

    if (!projectId) {
      return NextResponse.json({ error: "Missing projectId" }, { status: 400 });
    }

    // Update webhook settings strictly scoped to authenticated user's project
    await db
      .update(projects)
      .set({
        discordWebhookUrl: discordWebhookUrl || null,
        slackWebhookUrl: slackWebhookUrl || null,
        telegramBotToken: telegramBotToken || null,
        telegramChatId: telegramChatId || null,
        genericWebhookUrl: genericWebhookUrl || null,
      })
      .where(and(eq(projects.id, projectId), eq(projects.userId, user.id)));

    // If testPing requested, dispatch a test notification
    if (testPing) {
      await dispatchCrashAlerts(
        {
          discordWebhookUrl,
          slackWebhookUrl,
          telegramBotToken,
          telegramChatId,
          genericWebhookUrl,
        },
        {
          eventId: "err_test_ping",
          projectName: "DevPulse Alert Test",
          projectSlug: "devpulse",
          errorName: "TestAlert: Webhook Connected",
          message: "🎉 Success! DevPulse instant crash alerts are now active on this channel.",
          runtime: "system-test",
          version: "v1.0.0",
          os: "Cloudflare Edge",
          environment: "production",
          dashboardUrl: "https://devpulse.ritualdev.in/dashboard",
        }
      );
    }

    return NextResponse.json({ success: true, message: "Webhook settings saved successfully." });
  } catch (err: any) {
    console.error("Error saving webhooks:", err);
    return NextResponse.json({ error: err.message || "Failed to save webhook settings" }, { status: 500 });
  }
}
