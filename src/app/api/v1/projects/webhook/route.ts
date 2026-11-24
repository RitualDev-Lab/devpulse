import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { projects } from "@/db/schema";
import { eq } from "drizzle-orm";
import { dispatchCrashAlerts } from "@/lib/alerts/webhook";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      projectId,
      discordWebhookUrl,
      slackWebhookUrl,
      telegramBotToken,
      telegramChatId,
      testPing,
    } = body;

    if (!projectId) {
      return NextResponse.json({ error: "Missing projectId" }, { status: 400 });
    }

    // Update webhook settings in database
    await db
      .update(projects)
      .set({
        discordWebhookUrl: discordWebhookUrl || null,
        slackWebhookUrl: slackWebhookUrl || null,
        telegramBotToken: telegramBotToken || null,
        telegramChatId: telegramChatId || null,
      })
      .where(eq(projects.id, projectId));

    // If testPing requested, dispatch a test notification
    if (testPing) {
      await dispatchCrashAlerts(
        {
          discordWebhookUrl,
          slackWebhookUrl,
          telegramBotToken,
          telegramChatId,
        },
        {
          projectName: "DevPulse Alert Test",
          projectSlug: "devpulse",
          errorName: "TestAlert: Webhook Connected",
          message: "🎉 Success! DevPulse instant crash alerts are now active on this channel.",
          runtime: "system-test",
          version: "v1.0.0",
          os: "Cloudflare Edge",
          environment: "production",
          dashboardUrl: "https://devpulse.ritualdev.in",
        }
      );
    }

    return NextResponse.json({ success: true, message: "Webhook settings saved successfully." });
  } catch (err: any) {
    console.error("Error saving webhooks:", err);
    return NextResponse.json({ error: err.message || "Failed to save webhook settings" }, { status: 500 });
  }
}
