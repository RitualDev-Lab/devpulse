"use client";

import React from "react";
import { BarChart3, Users, Globe, Laptop, Smartphone } from "lucide-react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import type { LoadedWorkspaceReady } from "@/lib/dashboard/load-workspace";
import { WorkspaceShell } from "../WorkspaceShell";
import { WebAnalyticsCard } from "../widgets/WebAnalyticsCard";
import { LanguageSdkTabs } from "../LanguageSdkTabs";

export function AnalyticsFullView({ workspace }: { workspace: LoadedWorkspaceReady }) {
  const { initialData, projects, customDomain, storageTier, isDemo } = workspace;
  const project = initialData.project;
  const summary = initialData.analyticsSummary;
  const dailySeries = summary?.dailySeries || [];

  return (
    <WorkspaceShell
      currentProject={{ ...project, telemetryApiKey: project.telemetryApiKey }}
      projects={projects}
      storageTier={storageTier}
      customDomain={customDomain}
      isDemo={isDemo}
    >
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-extrabold text-white flex items-center gap-2.5">
            <BarChart3 className="w-6 h-6 text-cyan-400" />
            <span>Daily Users &amp; App/Web Telemetry</span>
          </h1>
          <p className="text-xs text-zinc-400 mt-0.5">
            Track daily active sessions, web pageviews, desktop/CLI launches, custom events, OS, and geography.
          </p>
        </div>

        {/* Summary KPI Cards */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="p-4 rounded-2xl bg-zinc-900/90 border border-zinc-800">
            <div className="text-xs text-zinc-400 flex items-center gap-1.5">
              <Users className="w-3.5 h-3.5 text-cyan-400" /> Total Hits
            </div>
            <div className="text-2xl font-bold text-white mt-1">
              {(summary?.totalPageviews || 0).toLocaleString()}
            </div>
          </div>
          <div className="p-4 rounded-2xl bg-zinc-900/90 border border-zinc-800">
            <div className="text-xs text-zinc-400 flex items-center gap-1.5">
              <Globe className="w-3.5 h-3.5 text-indigo-400" /> Web Traffic
            </div>
            <div className="text-2xl font-bold text-white mt-1">
              {(summary?.sources?.web || 0).toLocaleString()}
            </div>
          </div>
          <div className="p-4 rounded-2xl bg-zinc-900/90 border border-zinc-800">
            <div className="text-xs text-zinc-400 flex items-center gap-1.5">
              <Laptop className="w-3.5 h-3.5 text-emerald-400" /> App / CLI Events
            </div>
            <div className="text-2xl font-bold text-white mt-1">
              {(summary?.sources?.app || 0).toLocaleString()}
            </div>
          </div>
          <div className="p-4 rounded-2xl bg-zinc-900/90 border border-zinc-800">
            <div className="text-xs text-zinc-400 flex items-center gap-1.5">
              <Smartphone className="w-3.5 h-3.5 text-purple-400" /> Mobile Share
            </div>
            <div className="text-2xl font-bold text-white mt-1">
              {summary && summary.totalPageviews > 0
                ? `${Math.round(((summary.devices?.mobile || 0) / summary.totalPageviews) * 100)}%`
                : "0%"}
            </div>
          </div>
        </div>

        {/* Full-Width Daily Users / Hits Chart */}
        <div className="p-5 rounded-2xl bg-zinc-900/90 border border-zinc-800 space-y-3">
          <h2 className="text-sm font-bold text-white">Daily Users &amp; Event Activity (14-Day)</h2>
          <div className="h-56">
            {dailySeries.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={dailySeries}>
                  <XAxis dataKey="date" tick={{ fill: "#71717a", fontSize: 10 }} />
                  <YAxis tick={{ fill: "#71717a", fontSize: 10 }} width={36} />
                  <Tooltip
                    contentStyle={{ backgroundColor: "#09090b", borderColor: "#27272a", borderRadius: "8px", fontSize: "12px" }}
                  />
                  <Area type="monotone" dataKey="hits" name="Daily Events" stroke="#06b6d4" fill="#06b6d425" strokeWidth={2} />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-full rounded-xl bg-zinc-950/60 border border-zinc-800/70 flex items-center justify-center text-xs text-zinc-500">
                Send a pageview or app event using the Web Analytics Test Ping below to populate daily user charts.
              </div>
            )}
          </div>
        </div>

        <WebAnalyticsCard summary={summary || null} projectSlug={project.slug} />

        {/* Custom Event Metrics (trackMetric("active_jobs", 42)) */}
        {(initialData.customMetrics || []).length > 0 && (
          <div className="p-5 rounded-2xl bg-zinc-900/90 border border-zinc-800 space-y-3">
            <h2 className="text-sm font-bold text-white">
              Custom Application Metrics (<code className="text-cyan-300">trackMetric</code>)
            </h2>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {(initialData.customMetrics || []).map((m) => (
                <div key={m.metricName} className="p-3.5 rounded-xl bg-zinc-950 border border-zinc-800">
                  <div className="text-xs font-mono text-cyan-300 truncate">{m.metricName}</div>
                  <div className="text-2xl font-bold text-white mt-1">{m.latestValue}</div>
                  <div className="text-[10px] text-zinc-500 mt-0.5">{m.samples} sample(s)</div>
                </div>
              ))}
            </div>
          </div>
        )}

        <LanguageSdkTabs
          apiKey={project.telemetryApiKey}
          projectSlug={project.slug}
          isDemo={isDemo}
        />
      </div>
    </WorkspaceShell>
  );
}
