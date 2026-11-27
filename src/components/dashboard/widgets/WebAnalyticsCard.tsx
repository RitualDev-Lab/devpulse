"use client";

import React, { useState } from "react";
import {
  Globe,
  Users,
  Copy,
  Check,
  Smartphone,
  Monitor,
  Cpu,
  Play,
  Loader2,
} from "lucide-react";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  Tooltip,
  XAxis,
} from "recharts";
import { formatNumber } from "@/lib/utils/format";
import { PUBLIC_APP_URL } from "@/lib/config/app-url";

export interface AnalyticsSummary {
  totalPageviews: number;
  uniqueReferrers: number;
  topReferrers: Array<{ referrer: string; count: number }>;
  topCountries: Array<{ country: string; count: number }>;
  topPaths?: Array<{ path: string; count: number }>;
  topOs?: Array<{ os: string; count: number }>;
  dailySeries?: Array<{ date: string; hits: number }>;
  sources?: { web: number; app: number };
  devices: { desktop: number; mobile: number };
}

interface WebAnalyticsCardProps {
  summary: AnalyticsSummary | null;
  projectSlug: string;
}

export function WebAnalyticsCard({ summary, projectSlug }: WebAnalyticsCardProps) {
  const [tab, setTab] = useState<"overview" | "apps" | "sdk">("overview");
  const [copiedSnippet, setCopiedSnippet] = useState(false);
  const [pinging, setPinging] = useState(false);
  const [localAdded, setLocalAdded] = useState(0);

  const webScriptSnippet = `<script defer src="${PUBLIC_APP_URL}/tracker.js" data-project="${projectSlug}" data-crashes="true"></script>`;
  const appEventSnippet = `fetch("${PUBLIC_APP_URL}/api/v1/analytics",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({project:"${projectSlug}",sourceType:"app",eventName:"app_launch",os:"Windows",appVersion:"1.0.0"})});`;

  const copySnippet = (txt: string) => {
    navigator.clipboard.writeText(txt);
    setCopiedSnippet(true);
    setTimeout(() => setCopiedSnippet(false), 2000);
  };

  const sendTestHit = async () => {
    setPinging(true);
    try {
      const res = await fetch("/api/v1/analytics", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          project: projectSlug,
          path: "/app/launch",
          sourceType: "app",
          eventName: "dashboard_test_ping",
          appVersion: "1.0.0",
        }),
      });
      if (res.ok) setLocalAdded((n) => n + 1);
    } finally {
      setPinging(false);
    }
  };

  const total = (summary?.totalPageviews || 0) + localAdded;
  const topRefs = summary?.topReferrers?.slice(0, 3) || [];
  const topCountries = summary?.topCountries?.slice(0, 3) || [];
  const topPaths = summary?.topPaths?.slice(0, 4) || [];
  const topOs = summary?.topOs?.slice(0, 4) || [];
  const chartData = summary?.dailySeries || [];

  return (
    <div className="flex flex-col h-full justify-between p-5 rounded-2xl bg-zinc-900/90 border border-zinc-800/80 shadow-lg shadow-black/40 hover:border-zinc-700/80 transition">
      <div>
        <div className="flex items-center justify-between gap-2 mb-3 flex-wrap">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-emerald-950/80 border border-emerald-800/60 flex items-center justify-center text-emerald-400">
              <Globe className="w-4 h-4" />
            </div>
            <div>
              <h3 className="font-semibold text-white text-base leading-tight">
                Web &amp; App Analytics
              </h3>
              <p className="text-xs text-zinc-400">Sites, Electron/Desktop, CLI &amp; Mobile</p>
            </div>
          </div>

          <div className="flex items-center gap-1 bg-zinc-950 p-1 rounded-xl border border-zinc-800 text-[10px]">
            {(
              [
                { id: "overview", label: "Overview" },
                { id: "apps", label: "OS / Paths" },
                { id: "sdk", label: "SDK" },
              ] as const
            ).map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                className={`px-2 py-0.5 rounded-lg font-semibold transition ${
                  tab === t.id ? "bg-emerald-600 text-white" : "text-zinc-400 hover:text-white"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>

        {/* Top KPI Row */}
        <div className="grid grid-cols-3 gap-2 mb-3">
          <div className="p-2.5 rounded-xl bg-zinc-950/60 border border-zinc-800/60">
            <span className="text-[10px] text-zinc-400 block">Total Events</span>
            <div className="flex items-center gap-1.5 text-emerald-400 font-bold text-base">
              <Users className="w-3.5 h-3.5" />
              <span>{formatNumber(total)}</span>
            </div>
          </div>

          <div className="p-2.5 rounded-xl bg-zinc-950/60 border border-zinc-800/60">
            <span className="text-[10px] text-zinc-400 block">Web / App</span>
            <div className="text-xs font-semibold text-zinc-200 mt-0.5">
              {summary?.sources?.web ?? total}w / {summary?.sources?.app ?? 0}a
            </div>
          </div>

          <div className="p-2.5 rounded-xl bg-zinc-950/60 border border-zinc-800/60 flex items-center justify-between">
            <div className="flex items-center gap-1 text-[11px] font-semibold text-zinc-200">
              <Monitor className="w-3 h-3 text-zinc-400" />
              <span>{summary?.devices?.desktop || 0}</span>
            </div>
            <div className="flex items-center gap-1 text-[11px] font-semibold text-zinc-200">
              <Smartphone className="w-3 h-3 text-zinc-400" />
              <span>{summary?.devices?.mobile || 0}</span>
            </div>
          </div>
        </div>

        {tab === "overview" && (
          <>
            {chartData.length > 0 && (
              <div className="h-20 w-full min-w-0 mb-3 rounded-xl bg-zinc-950/60 border border-zinc-800/60 p-1.5">
                <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 320, height: 80 }}>
                  <AreaChart data={chartData}>
                    <defs>
                      <linearGradient id="analyticsFill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#10b981" stopOpacity={0.35} />
                        <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <XAxis dataKey="date" hide />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: "#09090b",
                        border: "1px solid #27272a",
                        borderRadius: "8px",
                        fontSize: "11px",
                      }}
                    />
                    <Area
                      type="monotone"
                      dataKey="hits"
                      stroke="#10b981"
                      strokeWidth={2}
                      fillOpacity={1}
                      fill="url(#analyticsFill)"
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            )}

            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="p-2.5 rounded-xl bg-zinc-950/60 border border-zinc-800/60">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400 block mb-1">
                  Referrers
                </span>
                {topRefs.length === 0 ? (
                  <span className="text-[11px] text-zinc-500">Waiting for hits...</span>
                ) : (
                  <div className="space-y-1">
                    {topRefs.map((r) => (
                      <div key={r.referrer} className="flex items-center justify-between text-[11px]">
                        <span className="text-zinc-300 truncate max-w-[90px]">{r.referrer}</span>
                        <span className="text-zinc-400 font-mono">{r.count}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="p-2.5 rounded-xl bg-zinc-950/60 border border-zinc-800/60">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400 block mb-1">
                  Regions
                </span>
                {topCountries.length === 0 ? (
                  <span className="text-[11px] text-zinc-500">Waiting for traffic...</span>
                ) : (
                  <div className="space-y-1">
                    {topCountries.map((c) => (
                      <div key={c.country} className="flex items-center justify-between text-[11px]">
                        <span className="text-zinc-300 font-semibold">{c.country}</span>
                        <span className="text-zinc-400 font-mono">{c.count}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </>
        )}

        {tab === "apps" && (
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div className="p-2.5 rounded-xl bg-zinc-950/60 border border-zinc-800/60">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400 block mb-1">
                Top Paths / Events
              </span>
              {topPaths.length === 0 ? (
                <span className="text-[11px] text-zinc-500">No events yet</span>
              ) : (
                <div className="space-y-1">
                  {topPaths.map((p) => (
                    <div key={p.path} className="flex items-center justify-between text-[11px]">
                      <span className="text-zinc-300 font-mono truncate max-w-[95px]">{p.path}</span>
                      <span className="text-zinc-400 font-mono">{p.count}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="p-2.5 rounded-xl bg-zinc-950/60 border border-zinc-800/60">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400 flex items-center gap-1 mb-1">
                <Cpu className="w-3 h-3 text-cyan-400" /> OS Breakdown
              </span>
              {topOs.length === 0 ? (
                <span className="text-[11px] text-zinc-500">No OS telemetry</span>
              ) : (
                <div className="space-y-1">
                  {topOs.map((o) => (
                    <div key={o.os} className="flex items-center justify-between text-[11px]">
                      <span className="text-zinc-300">{o.os}</span>
                      <span className="text-zinc-400 font-mono">{o.count}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {tab === "sdk" && (
          <div className="space-y-2">
            <div className="p-2.5 rounded-xl bg-zinc-950/80 border border-zinc-800/80">
              <div className="flex items-center justify-between text-[10px] text-zinc-400 mb-1">
                <span>Web Site + Auto Crash Tag (&lt;2 KB, Zero Cookies):</span>
                <button
                  onClick={() => copySnippet(webScriptSnippet)}
                  className="flex items-center gap-1 text-emerald-400 hover:text-emerald-300"
                >
                  {copiedSnippet ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                  <span>{copiedSnippet ? "Copied" : "Copy"}</span>
                </button>
              </div>
              <code className="text-[10px] font-mono text-zinc-300 block truncate">
                {webScriptSnippet}
              </code>
            </div>

            <div className="p-2.5 rounded-xl bg-zinc-950/80 border border-zinc-800/80">
              <div className="flex items-center justify-between text-[10px] text-zinc-400 mb-1">
                <span>Desktop / CLI / App Telemetry Event:</span>
                <button
                  onClick={() => copySnippet(appEventSnippet)}
                  className="text-cyan-400 hover:text-cyan-300"
                >
                  Copy JS
                </button>
              </div>
              <code className="text-[10px] font-mono text-zinc-400 block truncate">
                {appEventSnippet}
              </code>
            </div>
          </div>
        )}
      </div>

      <div className="mt-3 pt-2 flex items-center justify-between text-[11px] text-zinc-500 border-t border-zinc-800/40">
        <span>Zero cookies &bull; GDPR &amp; App Ready</span>
        <button
          type="button"
          disabled={pinging}
          onClick={sendTestHit}
          className="inline-flex items-center gap-1 text-emerald-400 hover:text-emerald-300 font-medium transition disabled:opacity-50"
        >
          {pinging ? <Loader2 className="w-3 h-3 animate-spin" /> : <Play className="w-3 h-3" />}
          <span>Test Ping</span>
        </button>
      </div>
    </div>
  );
}
