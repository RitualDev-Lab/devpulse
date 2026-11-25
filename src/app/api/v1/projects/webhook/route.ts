import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { projects } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { dispatchCrashAlerts } from "@/lib/alerts/webhook";
import { getCurrentUser } from "@/lib/auth";
import { getPlanLimits } from "@/lib/billing/plans";

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
      testPing,
    } = body;

    if (!projectId) {
      return NextResponse.json({ error: "Missing projectId" }, { status: 400 });
    }

    const [ownedProject] = await db
      .select({ id: projects.id, name: projects.name, slug: projects.slug })
      .from(projects)
      .where(and(eq(projects.id, projectId), eq(projects.userId, user.id)))
      .limit(1);

    if (!ownedProject) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    const configuredChannels = [
      Boolean(discordWebhookUrl?.trim()),
      Boolean(slackWebhookUrl?.trim()),
      Boolean(telegramBotToken?.trim() && telegramChatId?.trim()),
    ].filter(Boolean).length;

    const limits = getPlanLimits(user.storageTier);
    if (configuredChannels > limits.alertChannelsLimit) {
      return NextResponse.json(
        {
          error: `Your ${limits.label} plan includes ${limits.alertChannelsLimit} alert channel. Upgrade to Pro ($14/mo) for multi-channel alerts.`,
          upgradeRequired: true,
        },
        { status: 403 }
      );
    }

    await db
      .update(projects)
      .set({
        discordWebhookUrl: discordWebhookUrl || null,
        slackWebhookUrl: slackWebhookUrl || null,
        telegramBotToken: telegramBotToken || null,
        telegramChatId: telegramChatId || null,
      })
      .where(and(eq(projects.id, projectId), eq(projects.userId, user.id)));

    if (testPing) {
      await dispatchCrashAlerts(
        {
          discordWebhookUrl,
          slackWebhookUrl,
          telegramBotToken,
          telegramChatId,
        },
        {
          projectName: ownedProject.name,
          projectSlug: ownedProject.slug,
          errorName: "TestAlert: Webhook Connected",
          message: "Success! DevPulse instant crash alerts are now active on this channel.",
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
