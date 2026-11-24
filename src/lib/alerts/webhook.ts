/**
 * DevPulse Instant Alert Dispatcher
 * Sends crash & bug reports to Discord, Slack, and Telegram
 */

export interface AlertPayload {
  eventId?: string;
  projectName: string;
  projectSlug: string;
  errorName: string;
  message: string;
  runtime: string;
  version?: string | null;
  os?: string | null;
  environment?: string | null;
  reporterEmail?: string | null;
  r2ObjectKey?: string | null;
  payloadSizeBytes?: number;
  dashboardUrl?: string;
}

export interface WebhookConfig {
  discordWebhookUrl?: string | null;
  slackWebhookUrl?: string | null;
  telegramBotToken?: string | null;
  telegramChatId?: string | null;
  genericWebhookUrl?: string | null;
  pagerdutyRoutingKey?: string | null;
}

/**
 * Dispatch alerts to all configured webhooks concurrently.
 * Wrapped in Promise.allSettled so no single failure stops other channels.
 */
export async function dispatchCrashAlerts(
  config: WebhookConfig,
  payload: AlertPayload
) {
  const promises: Promise<any>[] = [];

  if (config.discordWebhookUrl) {
    promises.push(sendDiscordAlert(config.discordWebhookUrl, payload));
  }
  if (config.slackWebhookUrl) {
    promises.push(sendSlackAlert(config.slackWebhookUrl, payload));
  }
  if (config.telegramBotToken && config.telegramChatId) {
    promises.push(
      sendTelegramAlert(config.telegramBotToken, config.telegramChatId, payload)
    );
  }
  if (config.genericWebhookUrl) {
    promises.push(sendGenericWebhookAlert(config.genericWebhookUrl, payload));
  }
  if (config.pagerdutyRoutingKey) {
    promises.push(sendPagerDutyAlert(config.pagerdutyRoutingKey, payload));
  }

  return Promise.allSettled(promises);
}

/**
 * Send rich Discord Embed alert
 */
export async function sendDiscordAlert(webhookUrl: string, data: AlertPayload) {
  const url = data.dashboardUrl || `https://devpulse.ritualdev.in`;

  const body = {
    username: "DevPulse Alerts",
    avatar_url: "https://avatars.githubusercontent.com/u/105820465?v=4",
    embeds: [
      {
        title: `🚨 Crash Detected: ${data.projectName}`,
        description: `**${data.errorName}**\n\`\`\`\n${data.message.slice(0, 500)}\n\`\`\``,
        url,
        color: 0xef4444, // Red
        fields: [
          { name: "Runtime", value: data.runtime, inline: true },
          { name: "Version", value: data.version || "N/A", inline: true },
          { name: "OS", value: data.os || "Unknown", inline: true },
          ...(data.reporterEmail
            ? [{ name: "Reported By", value: data.reporterEmail, inline: false }]
            : []),
        ],
        footer: {
          text: "DevPulse • ritualdev-lab Telemetry",
        },
        timestamp: new Date().toISOString(),
      },
    ],
  };

  try {
    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return res.ok;
  } catch (err) {
    console.error("Failed to send Discord alert:", err);
    return false;
  }
}

/**
 * Send Slack Block Kit alert
 */
export async function sendSlackAlert(webhookUrl: string, data: AlertPayload) {
  const url = data.dashboardUrl || `https://devpulse.ritualdev.in`;

  const body = {
    text: `🚨 [DevPulse] New crash reported in ${data.projectName}: ${data.errorName}`,
    blocks: [
      {
        type: "header",
        text: {
          type: "plain_text",
          text: `🚨 Crash in ${data.projectName}`,
          emoji: true,
        },
      },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*Error:* \`${data.errorName}\`\n*Message:* ${data.message.slice(0, 400)}`,
        },
      },
      {
        type: "section",
        fields: [
          { type: "mrkdwn", text: `*Runtime:*\n${data.runtime}` },
          { type: "mrkdwn", text: `*Version:*\n${data.version || "N/A"}` },
          { type: "mrkdwn", text: `*Environment:*\n${data.environment || "production"}` },
          { type: "mrkdwn", text: `*OS:*\n${data.os || "Unknown"}` },
        ],
      },
      {
        type: "actions",
        elements: [
          {
            type: "button",
            text: { type: "plain_text", text: "View in DevPulse" },
            url,
            style: "danger",
          },
        ],
      },
    ],
  };

  try {
    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return res.ok;
  } catch (err) {
    console.error("Failed to send Slack alert:", err);
    return false;
  }
}

/**
 * Send Telegram Bot message alert
 */
export async function sendTelegramAlert(
  botToken: string,
  chatId: string,
  data: AlertPayload
) {
  const url = data.dashboardUrl || `https://devpulse.ritualdev.in`;
  const text = `🚨 *DevPulse Crash Alert*\n\n*Project:* ${data.projectName}\n*Error:* \`${data.errorName}\`\n*Runtime:* ${data.runtime} (${data.version || "N/A"})\n*OS:* ${data.os || "Unknown"}\n\n*Message:*\n_${data.message.slice(0, 300)}_\n\n[Open Dashboard](${url})`;

  try {
    const res = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: "Markdown",
        disable_web_page_preview: false,
      }),
      signal: AbortSignal.timeout(3000),
    });
    return res.ok;
  } catch (err) {
    console.error("Failed to send Telegram alert:", err);
    return false;
  }
}

/**
 * Send standardized JSON payload to a Generic Webhook endpoint
 */
export async function sendGenericWebhookAlert(webhookUrl: string, data: AlertPayload) {
  const url = data.dashboardUrl || `https://devpulse.ritualdev.in/dashboard?project=${data.projectSlug}`;

  const body = {
    event: "crash.created",
    timestamp: new Date().toISOString(),
    eventId: data.eventId || null,
    project: {
      name: data.projectName,
      slug: data.projectSlug,
    },
    error: {
      name: data.errorName,
      message: data.message,
      runtime: data.runtime,
      version: data.version || null,
      os: data.os || null,
      environment: data.environment || "production",
      reporterEmail: data.reporterEmail || null,
    },
    storage: {
      r2ObjectKey: data.r2ObjectKey || null,
      payloadSizeBytes: data.payloadSizeBytes || 0,
    },
    dashboardUrl: url,
  };

  try {
    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "DevPulse-Alerts/1.0",
        "X-DevPulse-Event": "crash.created",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(3000),
    });
    return res.ok;
  } catch (err) {
    console.error("Failed to send Generic Webhook alert:", err);
    return false;
  }
}

/**
 * Send PagerDuty Events API v2 Trigger Incident
 */
export async function sendPagerDutyAlert(routingKey: string, data: AlertPayload) {
  const url = data.dashboardUrl || `https://devpulse.ritualdev.in/dashboard?project=${data.projectSlug}`;

  const body = {
    routing_key: routingKey,
    event_action: "trigger",
    dedup_key: data.eventId || `${data.projectSlug}-${data.errorName}`,
    payload: {
      summary: `[${data.projectName}] ${data.errorName}: ${data.message.slice(0, 200)}`,
      severity: "error",
      source: data.projectSlug,
      component: data.runtime,
      custom_details: {
        errorName: data.errorName,
        message: data.message,
        runtime: data.runtime,
        version: data.version || "N/A",
        os: data.os || "Unknown",
        environment: data.environment || "production",
        r2ObjectKey: data.r2ObjectKey || null,
      },
    },
    links: [{ href: url, text: "Open DevPulse Command Center" }],
  };

  try {
    const res = await fetch("https://events.pagerduty.com/v2/enqueue", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(3000),
    });
    return res.ok;
  } catch (err) {
    console.error("Failed to send PagerDuty alert:", err);
    return false;
  }
}
