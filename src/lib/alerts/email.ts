/**
 * DevPulse Transactional Email Dispatcher (Resend & Postmark)
 * Zero-dependency Edge-compatible email sender supporting both platform keys
 * (RESEND_API_KEY / POSTMARK_SERVER_TOKEN) and per-project AES-256-GCM keys.
 */

export type EmailProvider = "resend" | "postmark";

export interface EmailSendOptions {
  to: string | string[];
  subject: string;
  html: string;
  text?: string;
  provider?: EmailProvider | string | null;
  apiKey?: string | null;
  from?: string;
}

export interface EmailSendResult {
  sent: boolean;
  provider: EmailProvider | "none";
  messageId?: string;
  skippedReason?: string;
  error?: string;
}

function resolveProviderConfig(options: EmailSendOptions): {
  provider: EmailProvider | "none";
  apiKey: string | null;
} {
  const preferred = options.provider === "postmark" ? "postmark" : "resend";

  if (options.apiKey) {
    return { provider: preferred, apiKey: options.apiKey };
  }

  if (preferred === "postmark" && process.env.POSTMARK_SERVER_TOKEN) {
    return { provider: "postmark", apiKey: process.env.POSTMARK_SERVER_TOKEN };
  }

  if (process.env.RESEND_API_KEY) {
    return { provider: "resend", apiKey: process.env.RESEND_API_KEY };
  }

  if (process.env.POSTMARK_SERVER_TOKEN) {
    return { provider: "postmark", apiKey: process.env.POSTMARK_SERVER_TOKEN };
  }

  return { provider: "none", apiKey: null };
}

export async function sendTransactionalEmail(
  options: EmailSendOptions
): Promise<EmailSendResult> {
  const recipients = (Array.isArray(options.to) ? options.to : [options.to])
    .map((e) => e.trim())
    .filter((e) => e.includes("@"));

  if (recipients.length === 0) {
    return { sent: false, provider: "none", skippedReason: "No valid recipient email" };
  }

  const { provider, apiKey } = resolveProviderConfig(options);
  if (provider === "none" || !apiKey) {
    return {
      sent: false,
      provider: "none",
      skippedReason:
        "No Resend/Postmark key configured in Alert Settings or server environment",
    };
  }

  const from =
    options.from ||
    process.env.DEVPULSE_FROM_EMAIL ||
    "DevPulse Alerts <alerts@devpulse.ritualdev.in>";

  try {
    if (provider === "resend") {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from,
          to: recipients,
          subject: options.subject,
          html: options.html,
          text: options.text,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        return {
          sent: false,
          provider: "resend",
          error: data.message || `Resend HTTP ${res.status}`,
        };
      }
      return { sent: true, provider: "resend", messageId: data.id };
    }

    // Postmark
    const res = await fetch("https://api.postmarkapp.com/email", {
      method: "POST",
      headers: {
        "X-Postmark-Server-Token": apiKey,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        From: from,
        To: recipients.join(", "),
        Subject: options.subject,
        HtmlBody: options.html,
        TextBody: options.text || options.subject,
        MessageStream: "outbound",
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      return {
        sent: false,
        provider: "postmark",
        error: data.Message || `Postmark HTTP ${res.status}`,
      };
    }
    return { sent: true, provider: "postmark", messageId: data.MessageID };
  } catch (err: any) {
    return {
      sent: false,
      provider,
      error: err?.message || "Email transport failed",
    };
  }
}

export function buildFatalCrashEmailHtml(input: {
  projectName: string;
  errorName: string;
  message: string;
  runtime: string;
  version?: string | null;
  environment?: string | null;
  dashboardUrl?: string;
}): string {
  const url = input.dashboardUrl || "https://devpulse.ritualdev.in";
  return `
  <div style="font-family:Inter,system-ui,sans-serif;background:#09090b;color:#f4f4f5;padding:32px;border-radius:12px;max-width:600px;margin:0 auto;border:1px solid #27272a;">
    <div style="display:inline-block;padding:4px 10px;border-radius:999px;background:rgba(239,68,68,0.15);color:#f87171;font-size:12px;font-weight:600;margin-bottom:14px;">
      Fatal Crash Alert &bull; ${input.projectName}
    </div>
    <h2 style="margin:0 0 8px;font-size:20px;color:#ffffff;">${input.errorName}</h2>
    <pre style="background:#18181b;border:1px solid #27272a;padding:12px;border-radius:8px;color:#fca5a5;font-size:12px;overflow-x:auto;white-space:pre-wrap;">${input.message.slice(0, 600)}</pre>
    <p style="font-size:13px;color:#a1a1aa;margin:16px 0;">
      Runtime: <strong style="color:#fff;">${input.runtime}</strong> &bull;
      Version: <strong style="color:#fff;">${input.version || "untagged"}</strong> &bull;
      Env: <strong style="color:#fff;">${input.environment || "production"}</strong>
    </p>
    <a href="${url}" style="display:inline-block;padding:10px 18px;border-radius:8px;background:#6366f1;color:#ffffff;text-decoration:none;font-size:13px;font-weight:600;">
      Inspect & Symbolicate in DevPulse
    </a>
  </div>`;
}

export function buildDowntimeEmailHtml(input: {
  projectName: string;
  monitorName: string;
  url: string;
  statusCode: number | null;
  latencyMs: number;
  errorMessage?: string | null;
  dashboardUrl?: string;
}): string {
  const dashUrl = input.dashboardUrl || "https://devpulse.ritualdev.in";
  return `
  <div style="font-family:Inter,system-ui,sans-serif;background:#09090b;color:#f4f4f5;padding:32px;border-radius:12px;max-width:600px;margin:0 auto;border:1px solid #27272a;">
    <div style="display:inline-block;padding:4px 10px;border-radius:999px;background:rgba(239,68,68,0.15);color:#f87171;font-size:12px;font-weight:600;margin-bottom:14px;">
      Endpoint Down &bull; ${input.projectName}
    </div>
    <h2 style="margin:0 0 8px;font-size:20px;color:#ffffff;">${input.monitorName} is unreachable</h2>
    <p style="font-size:13px;color:#a1a1aa;margin:0 0 12px;">
      URL: <code style="color:#e4e4e7;">${input.url}</code><br/>
      HTTP Status: <strong style="color:#f87171;">${input.statusCode ?? "Timeout / Network Error"}</strong> &bull;
      Latency: <strong>${input.latencyMs}ms</strong>
    </p>
    ${input.errorMessage ? `<pre style="background:#18181b;border:1px solid #27272a;padding:12px;border-radius:8px;color:#fca5a5;font-size:12px;">${input.errorMessage}</pre>` : ""}
    <a href="${dashUrl}" style="display:inline-block;margin-top:12px;padding:10px 18px;border-radius:8px;background:#6366f1;color:#ffffff;text-decoration:none;font-size:13px;font-weight:600;">
      View Uptime & P95 Latency
    </a>
  </div>`;
}

export function buildRbacInviteEmailHtml(input: {
  orgName: string;
  inviterUsername: string;
  role: string;
  inviteeUsername: string;
  dashboardUrl?: string;
}): string {
  const dashUrl = input.dashboardUrl || "https://devpulse.ritualdev.in";
  return `
  <div style="font-family:Inter,system-ui,sans-serif;background:#09090b;color:#f4f4f5;padding:32px;border-radius:12px;max-width:600px;margin:0 auto;border:1px solid #27272a;">
    <div style="display:inline-block;padding:4px 10px;border-radius:999px;background:rgba(99,102,241,0.18);color:#a5b4fc;font-size:12px;font-weight:600;margin-bottom:14px;">
      Workspace Invitation &bull; RBAC
    </div>
    <h2 style="margin:0 0 8px;font-size:20px;color:#ffffff;">You were invited to ${input.orgName}</h2>
    <p style="font-size:14px;color:#d4d4d8;line-height:1.6;">
      <strong>@${input.inviterUsername}</strong> added <strong>@${input.inviteeUsername}</strong> to the
      <strong>${input.orgName}</strong> DevPulse workspace with the role <strong style="color:#34d399;">${input.role.toUpperCase()}</strong>.
    </p>
    <p style="font-size:13px;color:#a1a1aa;margin-bottom:20px;">
      Sign in with your GitHub account on DevPulse to access shared telemetry, release health, and uptime monitors.
    </p>
    <a href="${dashUrl}" style="display:inline-block;padding:10px 18px;border-radius:8px;background:#6366f1;color:#ffffff;text-decoration:none;font-size:13px;font-weight:600;">
      Open DevPulse Workspace
    </a>
  </div>`;
}

export function buildWeeklyDigestEmailHtml(digest: {
  projectName: string;
  maintainerUsername: string;
  stars: number;
  downloads: number;
  mrrUsd: number;
  unresolvedIssues: number;
  uptimePercent: string;
  p95LatencyMs: number;
  dashboardUrl?: string;
}): string {
  const dashUrl = digest.dashboardUrl || "https://devpulse.ritualdev.in";
  return `
  <div style="font-family:Inter,system-ui,sans-serif;background:#09090b;color:#f4f4f5;padding:32px;border-radius:12px;max-width:620px;margin:0 auto;border:1px solid #27272a;">
    <div style="display:inline-block;padding:4px 10px;border-radius:999px;background:rgba(16,185,129,0.15);color:#34d399;font-size:12px;font-weight:600;margin-bottom:14px;">
      Weekly Maintainer Digest &bull; ${digest.projectName}
    </div>
    <h2 style="margin:0 0 6px;font-size:20px;color:#ffffff;">Hey @${digest.maintainerUsername}, here is your weekly pulse</h2>
    <p style="font-size:13px;color:#a1a1aa;margin:0 0 20px;">7-day summary across registry growth, revenue, uptime, and crash telemetry.</p>
    <table style="width:100%;border-collapse:separate;border-spacing:8px;margin-bottom:20px;">
      <tr>
        <td style="background:#18181b;border:1px solid #27272a;border-radius:8px;padding:12px;">
          <div style="font-size:11px;color:#a1a1aa;">GitHub Stars</div>
          <div style="font-size:20px;font-weight:700;color:#fbbf24;">${digest.stars.toLocaleString()}</div>
        </td>
        <td style="background:#18181b;border:1px solid #27272a;border-radius:8px;padding:12px;">
          <div style="font-size:11px;color:#a1a1aa;">Package Downloads</div>
          <div style="font-size:20px;font-weight:700;color:#60a5fa;">${digest.downloads.toLocaleString()}</div>
        </td>
      </tr>
      <tr>
        <td style="background:#18181b;border:1px solid #27272a;border-radius:8px;padding:12px;">
          <div style="font-size:11px;color:#a1a1aa;">Estimated MRR</div>
          <div style="font-size:20px;font-weight:700;color:#34d399;">$${digest.mrrUsd.toLocaleString()}</div>
        </td>
        <td style="background:#18181b;border:1px solid #27272a;border-radius:8px;padding:12px;">
          <div style="font-size:11px;color:#a1a1aa;">Unresolved Crashes</div>
          <div style="font-size:20px;font-weight:700;color:#f87171;">${digest.unresolvedIssues}</div>
        </td>
      </tr>
      <tr>
        <td style="background:#18181b;border:1px solid #27272a;border-radius:8px;padding:12px;">
          <div style="font-size:11px;color:#a1a1aa;">Uptime Availability</div>
          <div style="font-size:20px;font-weight:700;color:#34d399;">${digest.uptimePercent}%</div>
        </td>
        <td style="background:#18181b;border:1px solid #27272a;border-radius:8px;padding:12px;">
          <div style="font-size:11px;color:#a1a1aa;">P95 Latency</div>
          <div style="font-size:20px;font-weight:700;color:#c084fc;">${digest.p95LatencyMs}ms</div>
        </td>
      </tr>
    </table>
    <a href="${dashUrl}" style="display:inline-block;padding:10px 18px;border-radius:8px;background:#6366f1;color:#ffffff;text-decoration:none;font-size:13px;font-weight:600;">
      Open DevPulse Dashboard
    </a>
  </div>`;
}
