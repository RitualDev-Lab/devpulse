"use client";

import React, { useEffect, useState } from "react";
import {
  Plus,
  RefreshCw,
  Trash2,
  Server,
  LineChart,
  Copy,
  Check,
  Loader2,
  BookOpen,
  Globe,
  HeartPulse,
} from "lucide-react";
import { AreaChart, Area, ResponsiveContainer, Tooltip, XAxis } from "recharts";
import { PUBLIC_APP_URL } from "@/lib/config/app-url";

interface ExternalConnector {
  id: string;
  category: string;
  provider: string;
  label: string;
  targetUrl: string | null;
  identifier: string | null;
  metadataJson: string | null;
  lastSyncedAt: string | null;
}

interface ParsedMeta {
  activeUsers?: number;
  sessions?: number;
  pageViews?: number;
  bounceRatePct?: number;
  daily?: Array<{ date: string; activeUsers: number; sessions: number; pageViews: number }>;
  note?: string;
}

export function ExternalAnalyticsHub({
  projectId,
  projectSlug,
  publicWriteKey,
  telemetryApiKey,
  isDemo = false,
}: {
  projectId: string;
  projectSlug: string;
  publicWriteKey?: string | null;
  telemetryApiKey?: string | null;
  isDemo?: boolean;
}) {
  const [connectors, setConnectors] = useState<ExternalConnector[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);

  const [provider, setProvider] = useState<"ga4" | "plausible" | "posthog" | "umami" | "oci_server">("ga4");
  const [label, setLabel] = useState("");
  const [identifier, setIdentifier] = useState("");
  const [targetUrl, setTargetUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [saving, setSaving] = useState(false);
  const [syncingId, setSyncingId] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ ok: boolean; msg: string } | null>(null);

  const [snippetTab, setSnippetTab] = useState<"web" | "oci">("web");
  const [copied, setCopied] = useState(false);
  const [healthUrl, setHealthUrl] = useState("");
  const [addingMonitor, setAddingMonitor] = useState(false);
  const [monitorNotice, setMonitorNotice] = useState<{ ok: boolean; msg: string } | null>(null);

  const loadConnectors = async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/v1/projects/connectors?projectId=${encodeURIComponent(projectId)}`);
      const data = await res.json();
      if (res.ok && Array.isArray(data.connectors)) {
        setConnectors(data.connectors.filter((c: ExternalConnector) => c.category === "analytics"));
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadConnectors();
  }, [projectId]);

  const handleConnect = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isDemo) {
      setNotice({ ok: false, msg: "Sign in with GitHub to connect live GA4 or server analytics." });
      return;
    }
    setSaving(true);
    setNotice(null);
    try {
      const res = await fetch("/api/v1/projects/connectors", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "add_connector",
          projectId,
          category: "analytics",
          provider,
          label: label.trim() || `${provider.toUpperCase()} (${identifier || "server"})`,
          identifier: identifier.trim() || null,
          targetUrl: targetUrl.trim() || null,
          apiKey: apiKey.trim() || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to connect analytics source");
      setNotice({ ok: true, msg: `Connected ${provider.toUpperCase()} analytics cleanly!` });
      setLabel("");
      setIdentifier("");
      setTargetUrl("");
      setApiKey("");
      setShowAdd(false);
      await loadConnectors();
    } catch (err: any) {
      setNotice({ ok: false, msg: err?.message || "Connection failed" });
    } finally {
      setSaving(false);
    }
  };

  const handleSync = async (connectorId: string) => {
    if (isDemo) return;
    setSyncingId(connectorId);
    try {
      await fetch("/api/v1/projects/connectors", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "sync_connector", projectId, connectorId }),
      });
      await loadConnectors();
    } finally {
      setSyncingId(null);
    }
  };

  const handleDelete = async (connectorId: string) => {
    if (isDemo) return;
    await fetch("/api/v1/projects/connectors", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "delete_connector", projectId, connectorId }),
    });
    setConnectors((prev) => prev.filter((c) => c.id !== connectorId));
  };

  const writeToken = publicWriteKey || projectSlug;
  const sdkKey = telemetryApiKey || "dp_live_your_api_key";

  const handleAttachMonitor = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isDemo) {
      setMonitorNotice({ ok: false, msg: "Sign in with GitHub to attach live /health probes." });
      return;
    }
    if (!healthUrl.trim()) return;
    setAddingMonitor(true);
    setMonitorNotice(null);
    try {
      const res = await fetch("/api/v1/monitors", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId,
          action: "create",
          name: "OCI / External Health Check",
          url: healthUrl.trim(),
          method: "GET",
          expectedStatus: 200,
          intervalMinutes: 5,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to attach /health monitor");
      setMonitorNotice({
        ok: true,
        msg: `Attached monitor for ${healthUrl.trim()}! Active on Uptime & 90-day Status / RSS.`,
      });
      setHealthUrl("");
    } catch (err: any) {
      setMonitorNotice({ ok: false, msg: err?.message || "Failed to add monitor" });
    } finally {
      setAddingMonitor(false);
    }
  };

  const snippet =
    snippetTab === "web"
      ? `<!-- 1-Line Ad-Blocker Resilient Tag (OCI Nginx, EC2, Netlify, Static HTML) -->
<script defer src="${PUBLIC_APP_URL}/pulse/s.js"
  data-project="${writeToken}"
  data-endpoint="${PUBLIC_APP_URL}/pulse/e"></script>

<!-- Or install @ritualdev/devpulse for auto Web Vitals (LCP, CLS, TTFB) + Errors: -->
<!-- npm i @ritualdev/devpulse && init({ apiKey: "${sdkKey}" }) -->`
      : `# Cron / systemd heartbeat on OCI Compute (Oracle Linux), AWS EC2, Docker, or VPS
CPU_LOAD=$(awk '{print $1}' /proc/loadavg 2>/dev/null || echo "0.42")
curl -s -X POST "${PUBLIC_APP_URL}/api/v1/analytics" \\
  -H "Content-Type: application/json" \\
  -d "{\\"project\\":\\"${writeToken}\\",\\"metricName\\":\\"oci_cpu_load\\",\\"metricValue\\":\${CPU_LOAD},\\"sourceType\\":\\"app\\",\\"os\\":\\"Oracle Linux OCI\\"}"

# Forward fatal server/systemd stderr dumps to DevPulse (>4KB auto-offloads to R2):
curl -s -X POST "${PUBLIC_APP_URL}/api/v1/event" \\
  -H "Content-Type: application/json" \\
  -d '{"apiKey":"${sdkKey}","errorName":"ServerException","message":"Worker restarted on OCI node-1","runtime":"linux-server"}'`;

  return (
    <div className="space-y-4">
      {/* Multi-Analytics Connectors (GA4, Plausible, Umami, OCI/External Server) */}
      <div className="p-5 rounded-2xl bg-zinc-900/90 border border-zinc-800 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-bold text-white flex items-center gap-2">
              <LineChart className="w-4 h-4 text-indigo-400" />
              <span>Multi-Analytics Hub (GA4 Data API, Plausible, Umami &amp; OCI Servers)</span>
            </h2>
            <p className="text-xs text-zinc-400 mt-0.5">
              Connect multiple external analytics sources side-by-side alongside DevPulse cookie-free telemetry.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setShowAdd((v) => !v)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold transition"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>{showAdd ? "Cancel" : "Connect Analytics Source"}</span>
          </button>
        </div>

        {notice && (
          <div
            className={`p-3 rounded-xl text-xs border ${
              notice.ok
                ? "bg-emerald-950/50 border-emerald-700/60 text-emerald-200"
                : "bg-red-950/50 border-red-700/60 text-red-200"
            }`}
          >
            {notice.msg}
          </div>
        )}

        {showAdd && (
          <form
            onSubmit={handleConnect}
            className="p-4 rounded-xl bg-zinc-950 border border-zinc-800 space-y-3"
          >
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
              {(
                [
                  { id: "ga4", title: "Google Analytics 4", sub: "GA4 Data API" },
                  { id: "plausible", title: "Plausible", sub: "Stats API" },
                  { id: "posthog", title: "PostHog", sub: "Trends API" },
                  { id: "umami", title: "Umami", sub: "Self-Hosted" },
                  { id: "oci_server", title: "OCI / Server URL", sub: "Custom JSON" },
                ] as const
              ).map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => setProvider(opt.id)}
                  className={`p-2.5 rounded-xl border text-left transition ${
                    provider === opt.id
                      ? "bg-indigo-600/20 border-indigo-500 text-white"
                      : "bg-zinc-900 border-zinc-800 text-zinc-400 hover:text-white"
                  }`}
                >
                  <div className="text-xs font-bold">{opt.title}</div>
                  <div className="text-[10px] text-indigo-300 font-mono">{opt.sub}</div>
                </button>
              ))}
            </div>

            {provider === "ga4" && (
              <div className="p-3 rounded-xl bg-indigo-950/30 border border-indigo-500/30 text-[11px] text-indigo-200 space-y-1">
                <div className="font-bold flex items-center gap-1.5">
                  <BookOpen className="w-3.5 h-3.5 text-indigo-400" />
                  <span>GA4 Data API Setup (30-Day Users, Sessions, Pageviews &amp; Bounce Rate)</span>
                </div>
                <p className="text-indigo-200/80">
                  1. Find your numeric <strong>Property ID</strong> in GA4 Admin &rarr; Property Details (e.g. <code className="font-mono">391827450</code>).
                  2. Enable <strong>Google Analytics Data API</strong> in Google Cloud, create a Service Account JSON key, and grant its <code className="font-mono">client_email</code> Viewer access in GA4 (or paste a short-lived OAuth Bearer token).
                </p>
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              <input
                type="text"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="Label (e.g., Production Web GA4)"
                className="px-3 py-2 rounded-lg bg-zinc-900 border border-zinc-800 text-xs text-white"
              />
              <input
                type="text"
                required={provider !== "oci_server"}
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
                placeholder={
                  provider === "ga4"
                    ? "GA4 Property ID (e.g., 391827450)"
                    : provider === "plausible"
                    ? "Domain (e.g., myapp.com)"
                    : provider === "posthog"
                    ? "PostHog Project ID (e.g., 12345)"
                    : provider === "umami"
                    ? "Website UUID"
                    : "Node / Region identifier (e.g., oci-iad-1)"
                }
                className="px-3 py-2 rounded-lg bg-zinc-900 border border-zinc-800 text-xs font-mono text-white"
              />
            </div>

            {(provider === "plausible" || provider === "posthog" || provider === "umami" || provider === "oci_server") && (
              <input
                type="url"
                required={provider === "umami" || provider === "oci_server"}
                value={targetUrl}
                onChange={(e) => setTargetUrl(e.target.value)}
                placeholder={
                  provider === "plausible"
                    ? "Self-hosted URL (optional, defaults to https://plausible.io)"
                    : provider === "posthog"
                    ? "PostHog Host (optional, defaults to https://us.posthog.com)"
                    : provider === "umami"
                    ? "https://analytics.yourdomain.com"
                    : "https://metrics.your-oci-server.com/summary.json"
                }
                className="w-full px-3 py-2 rounded-lg bg-zinc-900 border border-zinc-800 text-xs font-mono text-white"
              />
            )}

            <div>
              <textarea
                rows={provider === "ga4" ? 3 : 1}
                required={provider === "ga4" || provider === "plausible" || provider === "posthog"}
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder={
                  provider === "ga4"
                    ? 'Paste Google Service Account JSON ({"client_email":...,"private_key":...}) or ya29... OAuth token'
                    : "API Key / Personal Access Key (optional for public endpoints)"
                }
                className="w-full px-3 py-2 rounded-lg bg-zinc-900 border border-zinc-800 text-xs font-mono text-white"
              />
            </div>

            <div className="flex justify-end">
              <button
                type="submit"
                disabled={saving}
                className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold flex items-center gap-1.5 disabled:opacity-50"
              >
                {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
                <span>Verify &amp; Save Analytics Source</span>
              </button>
            </div>
          </form>
        )}

        {loading ? (
          <div className="py-4 text-xs text-zinc-500">Loading connected analytics sources...</div>
        ) : connectors.length === 0 ? (
          <div className="p-4 rounded-xl bg-zinc-950/60 border border-zinc-800/70 text-xs text-zinc-400">
            No external analytics sources connected yet. Click <strong>Connect Analytics Source</strong> to pull GA4, Plausible, Umami, or OCI Server metrics here.
          </div>
        ) : (
          <div className="space-y-3">
            {connectors.length > 1 && (() => {
              const totals = connectors.reduce(
                (acc, c) => {
                  try {
                    const m = c.metadataJson ? (JSON.parse(c.metadataJson) as ParsedMeta) : {};
                    acc.users += Number(m.activeUsers || 0);
                    acc.sessions += Number(m.sessions || 0);
                    acc.views += Number(m.pageViews || 0);
                  } catch {}
                  return acc;
                },
                { users: 0, sessions: 0, views: 0 }
              );
              return (
                <div className="p-3 rounded-xl bg-indigo-950/30 border border-indigo-500/30 flex flex-wrap items-center justify-between gap-3 text-xs">
                  <span className="font-semibold text-indigo-200">
                    Combined Across {connectors.length} Connected Sources:
                  </span>
                  <div className="flex items-center gap-4 font-mono">
                    <span className="text-white tabular-nums">{totals.users.toLocaleString()} users</span>
                    <span className="text-cyan-300 tabular-nums">{totals.sessions.toLocaleString()} sessions</span>
                    <span className="text-emerald-300 tabular-nums">{totals.views.toLocaleString()} views</span>
                  </div>
                </div>
              );
            })()}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {connectors.map((c) => {
                let meta: ParsedMeta = {};
                try {
                  if (c.metadataJson) meta = JSON.parse(c.metadataJson);
                } catch {
                  // ignore
                }
                return (
                  <div
                    key={c.id}
                    className="p-4 rounded-xl bg-zinc-950 border border-zinc-800 space-y-2.5"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] font-mono uppercase px-1.5 py-0.5 rounded bg-indigo-500/15 text-indigo-300 border border-indigo-500/30">
                            {c.provider}
                          </span>
                          <span className="text-xs font-bold text-white">{c.label}</span>
                        </div>
                        {c.identifier && (
                          <div className="text-[10px] font-mono text-zinc-500 mt-0.5">
                            ID: {c.identifier}
                          </div>
                        )}
                      </div>
                      {!isDemo && (
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => handleSync(c.id)}
                            disabled={syncingId === c.id}
                            title="Sync latest report"
                            className="p-1.5 rounded-lg bg-zinc-900 hover:bg-zinc-800 text-zinc-300 border border-zinc-800"
                          >
                            <RefreshCw
                              className={`w-3.5 h-3.5 ${syncingId === c.id ? "animate-spin" : ""}`}
                            />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDelete(c.id)}
                            title="Disconnect"
                            className="p-1.5 rounded-lg bg-zinc-900 hover:bg-red-950/60 text-zinc-400 hover:text-red-300 border border-zinc-800"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      )}
                    </div>

                    <div className={`grid ${typeof meta.bounceRatePct === "number" ? "grid-cols-4" : "grid-cols-3"} gap-2 text-center`}>
                      <div className="p-2 rounded-lg bg-zinc-900/70 border border-zinc-800/80">
                        <div className="text-sm font-bold text-white tabular-nums">
                          {(meta.activeUsers ?? 0).toLocaleString()}
                        </div>
                        <div className="text-[10px] text-zinc-400">Active Users</div>
                      </div>
                      <div className="p-2 rounded-lg bg-zinc-900/70 border border-zinc-800/80">
                        <div className="text-sm font-bold text-white tabular-nums">
                          {(meta.sessions ?? 0).toLocaleString()}
                        </div>
                        <div className="text-[10px] text-zinc-400">Sessions</div>
                      </div>
                      <div className="p-2 rounded-lg bg-zinc-900/70 border border-zinc-800/80">
                        <div className="text-sm font-bold text-white tabular-nums">
                          {(meta.pageViews ?? 0).toLocaleString()}
                        </div>
                        <div className="text-[10px] text-zinc-400">Pageviews</div>
                      </div>
                      {typeof meta.bounceRatePct === "number" && (
                        <div className="p-2 rounded-lg bg-zinc-900/70 border border-zinc-800/80">
                          <div className="text-sm font-bold text-amber-300 tabular-nums">
                            {meta.bounceRatePct}%
                          </div>
                          <div className="text-[10px] text-zinc-400">Bounce</div>
                        </div>
                      )}
                    </div>

                    {Array.isArray(meta.daily) && meta.daily.length > 0 && (
                      <div className="h-24 pt-1">
                        <ResponsiveContainer width="100%" height="100%">
                          <AreaChart data={meta.daily}>
                            <XAxis dataKey="date" hide />
                            <Tooltip
                              contentStyle={{
                                backgroundColor: "#09090b",
                                borderColor: "#27272a",
                                borderRadius: "8px",
                                fontSize: "11px",
                              }}
                            />
                            <Area
                              type="monotone"
                              dataKey="activeUsers"
                              name="Active Users"
                              stroke="#818cf8"
                              fill="#818cf830"
                              strokeWidth={1.5}
                            />
                          </AreaChart>
                        </ResponsiveContainer>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* OCI / AWS / VPS External Web & Server Telemetry Snippets */}
      <div className="p-5 rounded-2xl bg-zinc-900/90 border border-zinc-800 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-sm font-bold text-white flex items-center gap-2">
              <Server className="w-4 h-4 text-emerald-400" />
              <span>OCI, VPS &amp; External Web Hosting Telemetry</span>
            </h2>
            <p className="text-xs text-zinc-400 mt-0.5">
              Collect web analytics &amp; server health/crash logs from Oracle Cloud (OCI), AWS, Docker, or static HTML without a GitHub repo.
            </p>
          </div>

          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setSnippetTab("web")}
              className={`px-3 py-1 rounded-lg text-xs font-semibold flex items-center gap-1 transition ${
                snippetTab === "web"
                  ? "bg-cyan-600 text-white"
                  : "bg-zinc-950 border border-zinc-800 text-zinc-400 hover:text-white"
              }`}
            >
              <Globe className="w-3 h-3" />
              <span>Web Tag</span>
            </button>
            <button
              type="button"
              onClick={() => setSnippetTab("oci")}
              className={`px-3 py-1 rounded-lg text-xs font-semibold flex items-center gap-1 transition ${
                snippetTab === "oci"
                  ? "bg-emerald-600 text-white"
                  : "bg-zinc-950 border border-zinc-800 text-zinc-400 hover:text-white"
              }`}
            >
              <Server className="w-3 h-3" />
              <span>OCI / Linux Agent</span>
            </button>
          </div>
        </div>

        <div className="rounded-xl bg-zinc-950 border border-zinc-800 overflow-hidden">
          <div className="px-3.5 py-2 border-b border-zinc-800/80 flex items-center justify-between text-[11px]">
            <span className="font-mono text-zinc-400">
              {snippetTab === "web" ? "index.html / layout" : "oci-telemetry-cron.sh"}
            </span>
            <button
              type="button"
              onClick={() => {
                navigator.clipboard.writeText(snippet);
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              }}
              className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-zinc-900 hover:bg-zinc-800 text-zinc-200 border border-zinc-800"
            >
              {copied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
              <span>{copied ? "Copied!" : "Copy"}</span>
            </button>
          </div>
          <pre className="p-3.5 text-[11px] font-mono text-emerald-300/90 overflow-x-auto leading-relaxed whitespace-pre-wrap">
            {snippet}
          </pre>
        </div>

        {/* Inline OCI / External /health URL Probe Attacher */}
        <form
          onSubmit={handleAttachMonitor}
          className="p-3.5 rounded-xl bg-zinc-950 border border-zinc-800 space-y-2.5"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs font-semibold text-white flex items-center gap-1.5">
              <HeartPulse className="w-3.5 h-3.5 text-emerald-400" />
              <span>Attach Public HTTPS /health Endpoint (OCI / EC2 / Vercel / VPS)</span>
            </span>
            <span className="text-[10px] text-zinc-400">
              Enables P95 latency, 90-day Status Page, RSS feed &amp; email alerts
            </span>
          </div>
          <div className="flex flex-col sm:flex-row gap-2">
            <input
              type="url"
              required
              value={healthUrl}
              onChange={(e) => setHealthUrl(e.target.value)}
              placeholder="https://api.my-oci-server.com/health"
              className="flex-1 px-3 py-2 rounded-xl bg-zinc-900 border border-zinc-800 text-xs font-mono text-white placeholder-zinc-500"
            />
            <button
              type="submit"
              disabled={addingMonitor}
              className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-xs font-semibold flex items-center justify-center gap-1.5 shrink-0"
            >
              {addingMonitor ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
              <span>Attach /health Monitor</span>
            </button>
          </div>
          {monitorNotice && (
            <div
              className={`text-[11px] ${
                monitorNotice.ok ? "text-emerald-300" : "text-red-300"
              }`}
            >
              {monitorNotice.msg}
            </div>
          )}
        </form>
      </div>
    </div>
  );
}
