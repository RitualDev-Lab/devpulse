"use client";

import React, { useState } from "react";
import { Bell, X, Send, Check, AlertCircle, Mail } from "lucide-react";

interface AlertSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  projectId: string;
  initialDiscord?: string | null;
  initialSlack?: string | null;
  initialTelegramToken?: string | null;
  initialTelegramChatId?: string | null;
  initialGenericWebhook?: string | null;
  initialPagerDuty?: string | null;
  initialNotificationEmail?: string | null;
  initialEmailProvider?: string | null;
  initialHasEmailApiKey?: boolean;
  initialDigestEnabled?: boolean;
}

export function AlertSettingsModal({
  isOpen,
  onClose,
  projectId,
  initialDiscord,
  initialSlack,
  initialTelegramToken,
  initialTelegramChatId,
  initialGenericWebhook,
  initialPagerDuty,
  initialNotificationEmail,
  initialEmailProvider,
  initialHasEmailApiKey,
  initialDigestEnabled,
}: AlertSettingsModalProps) {
  const [discordUrl, setDiscordUrl] = useState(initialDiscord || "");
  const [slackUrl, setSlackUrl] = useState(initialSlack || "");
  const [telegramToken, setTelegramToken] = useState(initialTelegramToken || "");
  const [telegramChatId, setTelegramChatId] = useState(initialTelegramChatId || "");
  const [genericWebhookUrl, setGenericWebhookUrl] = useState(initialGenericWebhook || "");
  const [pagerdutyRoutingKey, setPagerdutyRoutingKey] = useState(initialPagerDuty || "");
  const [notificationEmail, setNotificationEmail] = useState(initialNotificationEmail || "");
  const [emailProvider, setEmailProvider] = useState(initialEmailProvider === "postmark" ? "postmark" : "resend");
  const [emailApiKey, setEmailApiKey] = useState(initialHasEmailApiKey ? "••••••••" : "");
  const [digestEnabled, setDigestEnabled] = useState(Boolean(initialDigestEnabled));
  const [sendingDigest, setSendingDigest] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedSuccess, setSavedSuccess] = useState(false);
  const [testingPing, setTestingPing] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleSave = async (test = false) => {
    if (test) setTestingPing(true);
    else setSaving(true);
    setTestResult(null);

    try {
      const res = await fetch("/api/v1/projects/webhook", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId,
          discordWebhookUrl: discordUrl,
          slackWebhookUrl: slackUrl,
          telegramBotToken: telegramToken,
          telegramChatId,
          genericWebhookUrl,
          pagerdutyRoutingKey,
          notificationEmail,
          emailProvider,
          emailApiKey,
          digestEnabled,
          testPing: test,
        }),
      });

      if (res.ok) {
        if (test) {
          setTestResult("Test alert dispatched! Check your configured channels.");
        } else {
          setSavedSuccess(true);
          setTimeout(() => {
            setSavedSuccess(false);
            onClose();
          }, 1200);
        }
      } else {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || "Failed to save settings");
      }
    } catch (err: any) {
      setTestResult(`Error: ${err?.message || "Failed to deliver"}`);
    } finally {
      setSaving(false);
      setTestingPing(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-150">
      <div className="w-full max-w-lg bg-zinc-900 border border-zinc-700 rounded-2xl shadow-2xl p-6 text-left relative max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-red-950 border border-red-800 flex items-center justify-center text-red-400">
              <Bell className="w-4 h-4" />
            </div>
            <div>
              <h3 className="font-bold text-white text-base">Instant Crash Alerts</h3>
              <p className="text-xs text-zinc-400">Get notified on Discord, Slack, or Telegram</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-zinc-400 hover:text-white p-1 rounded-lg hover:bg-zinc-800 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {testResult && (
          <div className="p-3 rounded-xl bg-zinc-950 border border-zinc-800 text-xs mb-3 text-zinc-200 flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-amber-400 shrink-0" />
            <span>{testResult}</span>
          </div>
        )}

        <div className="space-y-4 flex-1 overflow-y-auto pr-1">
          {/* Discord Webhook */}
          <div>
            <label className="block text-xs font-semibold text-zinc-300 mb-1">
              Discord Webhook URL
            </label>
            <input
              type="url"
              value={discordUrl}
              onChange={(e) => setDiscordUrl(e.target.value)}
              placeholder="https://discord.com/api/webhooks/..."
              className="w-full px-3 py-2 rounded-xl bg-zinc-950 border border-zinc-800 text-xs text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-red-500 font-mono transition"
            />
            <span className="text-[10px] text-zinc-500 mt-0.5 block">
              In Discord: Server Settings &rarr; Integrations &rarr; Webhooks
            </span>
          </div>

          {/* Slack Webhook */}
          <div>
            <label className="block text-xs font-semibold text-zinc-300 mb-1">
              Slack Incoming Webhook URL
            </label>
            <input
              type="url"
              value={slackUrl}
              onChange={(e) => setSlackUrl(e.target.value)}
              placeholder="https://hooks.slack.com/services/..."
              className="w-full px-3 py-2 rounded-xl bg-zinc-950 border border-zinc-800 text-xs text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-red-500 font-mono transition"
            />
          </div>

          {/* Telegram Bot */}
          <div className="grid grid-cols-2 gap-2.5">
            <div>
              <label className="block text-xs font-semibold text-zinc-300 mb-1">
                Telegram Bot Token
              </label>
              <input
                type="text"
                value={telegramToken}
                onChange={(e) => setTelegramToken(e.target.value)}
                placeholder="123456:ABC-DEF..."
                className="w-full px-3 py-2 rounded-xl bg-zinc-950 border border-zinc-800 text-xs text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-red-500 font-mono transition"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-zinc-300 mb-1">
                Telegram Chat ID
              </label>
              <input
                type="text"
                value={telegramChatId}
                onChange={(e) => setTelegramChatId(e.target.value)}
                placeholder="@mychannel or 987654"
                className="w-full px-3 py-2 rounded-xl bg-zinc-950 border border-zinc-800 text-xs text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-red-500 font-mono transition"
              />
            </div>
          </div>

          {/* Generic Webhook */}
          <div>
            <label className="block text-xs font-semibold text-zinc-300 mb-1">
              Generic JSON Webhook URL
            </label>
            <input
              type="url"
              value={genericWebhookUrl}
              onChange={(e) => setGenericWebhookUrl(e.target.value)}
              placeholder="https://api.yourapp.com/webhooks/devpulse"
              className="w-full px-3 py-2 rounded-xl bg-zinc-950 border border-zinc-800 text-xs text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-red-500 font-mono transition"
            />
            <span className="text-[10px] text-zinc-500 mt-0.5 block">
              Receives HTTP POST with header <code className="text-zinc-400">X-DevPulse-Event: crash.created</code> (Free+)
            </span>
          </div>

          {/* PagerDuty Events API v2 Routing */}
          <div>
            <label className="block text-xs font-semibold text-zinc-300 mb-1">
              PagerDuty Routing Key (Team / Studio)
            </label>
            <input
              type="text"
              value={pagerdutyRoutingKey}
              onChange={(e) => setPagerdutyRoutingKey(e.target.value)}
              placeholder="32-char Events API v2 integration key"
              className="w-full px-3 py-2 rounded-xl bg-zinc-950 border border-zinc-800 text-xs text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-red-500 font-mono transition"
            />
            <span className="text-[10px] text-zinc-500 mt-0.5 block">
              Triggers PagerDuty incidents automatically alongside Slack on fatal crashes
            </span>
          </div>

          {/* Email Alerts & Weekly Digest (Resend / Postmark) */}
          <div className="p-3.5 rounded-xl bg-zinc-950/80 border border-zinc-800 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-white">
                <Mail className="w-3.5 h-3.5 text-indigo-400" />
                <span>Email Alerts &amp; Weekly Digest</span>
              </div>
              <select
                value={emailProvider}
                onChange={(e) => setEmailProvider(e.target.value)}
                className="px-2 py-1 rounded-lg bg-zinc-900 border border-zinc-800 text-[11px] text-zinc-200"
              >
                <option value="resend">Resend</option>
                <option value="postmark">Postmark</option>
              </select>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <input
                type="email"
                value={notificationEmail}
                onChange={(e) => setNotificationEmail(e.target.value)}
                placeholder="alerts@yourcompany.com"
                className="px-3 py-2 rounded-xl bg-zinc-900 border border-zinc-800 text-xs text-zinc-200 placeholder-zinc-600 font-mono"
              />
              <input
                type="password"
                value={emailApiKey}
                onChange={(e) => setEmailApiKey(e.target.value)}
                placeholder={`${emailProvider === "postmark" ? "Postmark" : "Resend"} API Key (AES-256 encrypted)`}
                className="px-3 py-2 rounded-xl bg-zinc-900 border border-zinc-800 text-xs text-zinc-200 placeholder-zinc-600 font-mono"
              />
            </div>
            <div className="flex items-center justify-between gap-2 text-xs">
              <label className="flex items-center gap-2 text-zinc-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={digestEnabled}
                  onChange={(e) => setDigestEnabled(e.target.checked)}
                  className="rounded border-zinc-700 bg-zinc-900 text-indigo-500"
                />
                <span>Send Weekly Maintainer Digest (stars, downloads, MRR, uptime)</span>
              </label>
              <button
                type="button"
                disabled={sendingDigest || !notificationEmail}
                onClick={async () => {
                  setSendingDigest(true);
                  setTestResult(null);
                  try {
                    const res = await fetch("/api/v1/notifications/digest", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ projectId, toEmail: notificationEmail }),
                    });
                    const d = await res.json();
                    setTestResult(
                      d.sent
                        ? `Weekly digest sent to ${notificationEmail} via ${d.provider}!`
                        : d.skippedReason || d.error || "Digest skipped — check email API key."
                    );
                  } finally {
                    setSendingDigest(false);
                  }
                }}
                className="px-2.5 py-1 rounded-lg bg-indigo-600/20 hover:bg-indigo-600/35 border border-indigo-500/40 text-indigo-200 text-[11px] font-semibold disabled:opacity-40 shrink-0"
              >
                {sendingDigest ? "Sending..." : "Send Digest Now"}
              </button>
            </div>
          </div>
        </div>

        <div className="mt-5 pt-3 border-t border-zinc-800 flex items-center justify-between gap-2">
          <button
            onClick={() => handleSave(true)}
            disabled={testingPing || (!discordUrl && !slackUrl && !telegramToken && !genericWebhookUrl && !pagerdutyRoutingKey && !notificationEmail)}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs font-medium transition disabled:opacity-40"
          >
            <Send className="w-3.5 h-3.5" />
            <span>{testingPing ? "Pinging..." : "Send Test Alert"}</span>
          </button>

          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="px-3.5 py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs font-medium transition"
            >
              Cancel
            </button>
            <button
              onClick={() => handleSave(false)}
              disabled={saving}
              className="flex items-center gap-1 px-4 py-2 rounded-xl bg-red-600 hover:bg-red-500 text-white text-xs font-semibold shadow-lg shadow-red-600/20 transition disabled:opacity-50"
            >
              {savedSuccess ? (
                <>
                  <Check className="w-3.5 h-3.5 text-white" />
                  <span>Saved!</span>
                </>
              ) : (
                <span>{saving ? "Saving..." : "Save Webhooks"}</span>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
