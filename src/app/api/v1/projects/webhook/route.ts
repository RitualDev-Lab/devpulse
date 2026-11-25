import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { projects } from "@/db/schema";
import { eq } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth";
import { dispatchCrashAlerts, resolveDecryptedWebhookConfig } from "@/lib/alerts/webhook";
import { canUseAlertChannel } from "@/lib/billing/plans";
import { resolveProjectAccess } from "@/lib/security/rbac";
import { recordAuditEvent } from "@/lib/security/audit";
import { decryptSecret, encryptSecret } from "@/lib/security/crypto";
import { validatePublicUrl } from "@/lib/security/ssrf";
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

    const resolveChannelField = async (
      incoming: unknown,
      existingValue: string | null,
      options?: { validateHttpsUrl?: boolean; label?: string }
    ): Promise<{ encrypted: string | null; error?: string }> => {
      if (incoming === undefined) return { encrypted: existingValue };
      const trimmed = typeof incoming === "string" ? incoming.trim() : "";
      if (!trimmed) return { encrypted: null };
      if (trimmed.startsWith("••") || trimmed.includes("••••")) {
        return { encrypted: existingValue };
      }
      if (options?.validateHttpsUrl) {
        const urlCheck = validatePublicUrl(trimmed, { allowHttp: false });
        if (!urlCheck.valid || !urlCheck.normalized) {
          return {
            encrypted: existingValue,
            error: `Invalid ${options.label || "webhook"} URL: ${urlCheck.reason}`,
          };
        }
        return { encrypted: await encryptSecret(urlCheck.normalized) };
      }
      return { encrypted: await encryptSecret(trimmed) };
    };

    const [
      nextDiscordRes,
      nextSlackRes,
      nextTelegramTokenRes,
      nextGenericRes,
      nextPagerDutyRes,
      nextOpsgenieRes,
      nextTeamsRes,
      nextEmailKeyRes,
    ] = await Promise.all([
      resolveChannelField(discordWebhookUrl, access.project.discordWebhookUrl, { validateHttpsUrl: true, label: "Discord webhook" }),
      resolveChannelField(slackWebhookUrl, access.project.slackWebhookUrl, { validateHttpsUrl: true, label: "Slack webhook" }),
      resolveChannelField(telegramBotToken, access.project.telegramBotToken),
      resolveChannelField(genericWebhookUrl, access.project.genericWebhookUrl, { validateHttpsUrl: true, label: "Generic webhook" }),
      resolveChannelField(pagerdutyRoutingKey, access.project.pagerdutyRoutingKey),
      resolveChannelField(opsgenieApiKey, access.project.opsgenieApiKeyEncrypted),
      resolveChannelField(teamsWebhookUrl, access.project.teamsWebhookUrl, { validateHttpsUrl: true, label: "Teams webhook" }),
      resolveChannelField(emailApiKey, access.project.emailApiKeyEncrypted),
    ]);

    const firstUrlError =
      nextDiscordRes.error ||
      nextSlackRes.error ||
      nextGenericRes.error ||
      nextTeamsRes.error;
    if (firstUrlError) {
      return NextResponse.json({ error: firstUrlError }, { status: 400 });
    }

    const nextDiscordEncrypted = nextDiscordRes.encrypted;
    const nextSlackEncrypted = nextSlackRes.encrypted;
    const nextTelegramTokenEncrypted = nextTelegramTokenRes.encrypted;
    const nextGenericEncrypted = nextGenericRes.encrypted;
    const nextPagerDutyEncrypted = nextPagerDutyRes.encrypted;
    const nextOpsgenieKeyEncrypted = nextOpsgenieRes.encrypted;
    const nextTeamsEncrypted = nextTeamsRes.encrypted;
    const nextEmailKeyEncrypted = nextEmailKeyRes.encrypted;
    const nextTelegramChatId =
      typeof telegramChatId === "string"
        ? telegramChatId.trim().startsWith("••")
          ? access.project.telegramChatId
          : telegramChatId.trim() || null
        : access.project.telegramChatId;

    const nextNotificationEmail =
      notificationEmail === undefined
        ? access.project.notificationEmail
        : String(notificationEmail).trim().startsWith("••")
        ? access.project.notificationEmail
        : String(notificationEmail).trim() || null;

    // Update webhook & email settings encrypted at rest & scoped by RBAC
    await db
      .update(projects)
      .set({
        discordWebhookUrl: nextDiscordEncrypted,
        slackWebhookUrl: nextSlackEncrypted,
        telegramBotToken: nextTelegramTokenEncrypted,
        telegramChatId: nextTelegramChatId,
        genericWebhookUrl: nextGenericEncrypted,
        pagerdutyRoutingKey: nextPagerDutyEncrypted,
        opsgenieApiKeyEncrypted: nextOpsgenieKeyEncrypted,
        teamsWebhookUrl: nextTeamsEncrypted,
        notificationEmail: nextNotificationEmail,
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
        hasDiscord: Boolean(nextDiscordEncrypted),
        hasSlack: Boolean(nextSlackEncrypted),
        hasTelegram: Boolean(nextTelegramTokenEncrypted && nextTelegramChatId),
        hasGeneric: Boolean(nextGenericEncrypted),
        hasPagerDuty: Boolean(nextPagerDutyEncrypted),
        hasOpsGenie: Boolean(nextOpsgenieKeyEncrypted),
        hasTeams: Boolean(nextTeamsEncrypted),
        hasEmailAlerts: Boolean(notificationEmail),
        digestEnabled: Boolean(digestEnabled),
      },
    });

    // If testPing requested, decrypt configured channels & dispatch test alert
    if (testPing) {
      const decryptedCfg = await resolveDecryptedWebhookConfig({
        discordWebhookUrl: nextDiscordEncrypted,
        slackWebhookUrl: nextSlackEncrypted,
        telegramBotToken: nextTelegramTokenEncrypted,
        telegramChatId: nextTelegramChatId,
        genericWebhookUrl: nextGenericEncrypted,
        pagerdutyRoutingKey: nextPagerDutyEncrypted,
        opsgenieApiKeyEncrypted: nextOpsgenieKeyEncrypted,
        teamsWebhookUrl: nextTeamsEncrypted,
      });
      await dispatchCrashAlerts(
        decryptedCfg,
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

      if (nextNotificationEmail) {
        const plainEmailKey = await decryptSecret(nextEmailKeyEncrypted);
        await sendTransactionalEmail({
          to: nextNotificationEmail,
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
