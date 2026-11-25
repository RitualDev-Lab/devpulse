import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { projects } from "@/db/schema";
import { eq } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth";
import { dispatchCrashAlerts } from "@/lib/alerts/webhook";
import { canUseAlertChannel } from "@/lib/billing/plans";
import { resolveProjectAccess } from "@/lib/security/rbac";
import { recordAuditEvent } from "@/lib/security/audit";
import { decryptSecret, encryptSecret } from "@/lib/security/crypto";
import { sendTransactionalEmail } from "@/lib/alerts/email";

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
      pagerdutyRoutingKey,
      opsgenieApiKey,
      teamsWebhookUrl,
      notificationEmail,
      emailProvider,
      emailApiKey,
      digestEnabled,
      testPing,
    } = body;

    if (!projectId) {
      return NextResponse.json({ error: "Missing projectId" }, { status: 400 });
    }

    const access = await resolveProjectAccess(String(projectId), user);
    if (!access || !access.canWrite) {
      await recordAuditEvent({
        userId: user.id,
        actorUsername: user.githubUsername,
        projectId: String(projectId),
        action: "webhooks.updated",
        resourceType: "project",
        resourceId: String(projectId),
        status: "denied",
        headers: req.headers,
        metadata: { role: access?.role || "none" },
      });
      return NextResponse.json({ error: "Forbidden: Viewer role cannot configure alert webhooks." }, { status: 403 });
    }

    if ((discordWebhookUrl && !canUseAlertChannel(user.storageTier, "discord")) ||
        ((telegramBotToken || telegramChatId) && !canUseAlertChannel(user.storageTier, "telegram"))) {
      return NextResponse.json(
        {
          error: "Discord and Telegram instant crash alerts require Developer Pro ($14/mo) or Team ($49/mo).",
          code: "ALERT_TIER_REQUIRED",
        },
        { status: 402 }
      );
    }

    if (
      (slackWebhookUrl && !canUseAlertChannel(user.storageTier, "slack")) ||
      (pagerdutyRoutingKey && !canUseAlertChannel(user.storageTier, "pagerduty")) ||
      (opsgenieApiKey && !canUseAlertChannel(user.storageTier, "opsgenie")) ||
      (teamsWebhookUrl && !canUseAlertChannel(user.storageTier, "teams"))
    ) {
      return NextResponse.json(
        {
          error:
            "Slack, PagerDuty, OpsGenie & Microsoft Teams alert routing requires Team / Studio ($49/mo).",
          code: "ALERT_TEAM_REQUIRED",
        },
        { status: 402 }
      );
    }

    let nextOpsgenieKeyEncrypted = access.project.opsgenieApiKeyEncrypted || null;
    if (typeof opsgenieApiKey === "string") {
      const trimmedOg = opsgenieApiKey.trim();
      if (!trimmedOg) {
        nextOpsgenieKeyEncrypted = null;
      } else if (!trimmedOg.startsWith("••") && !trimmedOg.includes("••••")) {
        nextOpsgenieKeyEncrypted = await encryptSecret(trimmedOg);
      }
    }

    // Preserve existing encrypted email API key unless explicitly changed or cleared
    let nextEmailKeyEncrypted = access.project.emailApiKeyEncrypted || null;
    if (typeof emailApiKey === "string") {
      const trimmedKey = emailApiKey.trim();
      if (!trimmedKey) {
        nextEmailKeyEncrypted = null;
      } else if (!trimmedKey.startsWith("••") && !trimmedKey.includes("••••")) {
        nextEmailKeyEncrypted = await encryptSecret(trimmedKey);
      }
    }

    // Update webhook & email settings scoped by RBAC
    await db
      .update(projects)
      .set({
        discordWebhookUrl: discordWebhookUrl || null,
        slackWebhookUrl: slackWebhookUrl || null,
        telegramBotToken: telegramBotToken || null,
        telegramChatId: telegramChatId || null,
        genericWebhookUrl: genericWebhookUrl || null,
        pagerdutyRoutingKey: pagerdutyRoutingKey || null,
        opsgenieApiKeyEncrypted: nextOpsgenieKeyEncrypted,
        teamsWebhookUrl: teamsWebhookUrl || null,
        notificationEmail: notificationEmail ? String(notificationEmail).trim() : null,
        emailProvider: emailProvider === "postmark" ? "postmark" : "resend",
        emailApiKeyEncrypted: nextEmailKeyEncrypted,
        digestEnabled: Boolean(digestEnabled),
      })
      .where(eq(projects.id, projectId));

    await recordAuditEvent({
      userId: user.id,
      actorUsername: user.githubUsername,
      organizationId: access.project.organizationId,
      projectId: access.project.id,
      action: "webhooks.updated",
      resourceType: "project",
      resourceId: access.project.id,
      headers: req.headers,
      metadata: {
        hasDiscord: Boolean(discordWebhookUrl),
        hasSlack: Boolean(slackWebhookUrl),
        hasTelegram: Boolean(telegramBotToken && telegramChatId),
        hasGeneric: Boolean(genericWebhookUrl),
        hasPagerDuty: Boolean(pagerdutyRoutingKey),
        hasOpsGenie: Boolean(nextOpsgenieKeyEncrypted),
        hasTeams: Boolean(teamsWebhookUrl),
        hasEmailAlerts: Boolean(notificationEmail),
        digestEnabled: Boolean(digestEnabled),
      },
    });

    // If testPing requested, dispatch a test notification
    if (testPing) {
      const plainOpsgenie = await decryptSecret(nextOpsgenieKeyEncrypted);
      await dispatchCrashAlerts(
        {
          discordWebhookUrl,
          slackWebhookUrl,
          telegramBotToken,
          telegramChatId,
          genericWebhookUrl,
          pagerdutyRoutingKey,
          opsgenieApiKey: plainOpsgenie,
          teamsWebhookUrl,
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

      if (notificationEmail) {
        const plainEmailKey = await decryptSecret(nextEmailKeyEncrypted);
        await sendTransactionalEmail({
          to: String(notificationEmail).trim(),
          subject: "[DevPulse] Test Crash & Uptime Email Connected",
          html: `<p>Your DevPulse email alert channel (<strong>${emailProvider === "postmark" ? "Postmark" : "Resend"}</strong>) is connected and ready for fatal crash alerts, uptime downtime notifications, and weekly maintainer digests.</p>`,
          provider: emailProvider,
          apiKey: plainEmailKey,
        }).catch(() => {});
      }
    }

    return NextResponse.json({ success: true, message: "Webhook settings saved successfully." });
  } catch (err: any) {
    console.error("Error saving webhooks:", err);
    return NextResponse.json({ error: err.message || "Failed to save webhook settings" }, { status: 500 });
  }
}
