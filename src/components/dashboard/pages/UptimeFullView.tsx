"use client";

import React, { useState } from "react";
import { HeartPulse, ExternalLink, Gauge } from "lucide-react";
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
import { UptimeMonitorsCard } from "../widgets/UptimeMonitorsCard";

export function UptimeFullView({ workspace }: { workspace: LoadedWorkspaceReady }) {
  const { initialData, projects, customDomain, storageTier, isDemo } = workspace;
  const project = initialData.project;
  const summary = initialData.uptimeSummary;
  const monitors = summary?.monitors || [];
  const allChecks = summary?.recentChecks || [];

  const [selectedMonitorId, setSelectedMonitorId] = useState<string>(
    monitors[0]?.id || "all"
  );

  const activeMonitor = monitors.find((m) => m.id === selectedMonitorId);
  const filteredChecks =
    selectedMonitorId === "all"
      ? allChecks
      : allChecks.filter((c) => c.monitorId === selectedMonitorId);

  const chartData = filteredChecks.slice(-40).map((c) => ({
    time: c.checkedAt
      ? new Date(c.checkedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
      : "",
    latencyMs: c.latencyMs,
    statusCode: c.statusCode || 0,
  }));

  return (
    <WorkspaceShell
      currentProject={{ ...project, telemetryApiKey: project.telemetryApiKey }}
      projects={projects}
      storageTier={storageTier}
      customDomain={customDomain}
      isDemo={isDemo}
    >
      <div className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-extrabold text-white flex items-center gap-2.5">
              <HeartPulse className="w-6 h-6 text-emerald-400" />
              <span>Uptime &amp; Per-Endpoint P95 Latency History</span>
            </h1>
            <p className="text-xs text-zinc-400 mt-0.5">
              Edge heartbeat checks for your APIs and apps &bull; Inspect per-endpoint P95 latency &amp; HTTP status history.
            </p>
          </div>
          {customDomain && (
            <a
              href={`https://${customDomain}`}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-xs font-semibold text-emerald-300"
            >
              <span>Open Status Portal</span>
              <ExternalLink className="w-3.5 h-3.5" />
            </a>
          )}
        </div>

        <UptimeMonitorsCard
          projectId={project.id}
          initialSummary={summary || null}
          isDemo={isDemo}
        />

        {/* Per-Endpoint P95 Latency History Drilldown */}
        <div className="p-5 rounded-2xl bg-zinc-900/90 border border-zinc-800 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-bold text-white flex items-center gap-2">
                <Gauge className="w-4 h-4 text-purple-400" />
                <span>
                  Per-Endpoint Latency History{" "}
                  {activeMonitor ? `— ${activeMonitor.name} (P95: ${activeMonitor.p95LatencyMs}ms)` : ""}
                </span>
              </h2>
              <p className="text-xs text-zinc-400">
                Select any monitor to inspect its dedicated response-time curve and probe samples
              </p>
            </div>
            {monitors.length > 0 && (
              <select
                value={selectedMonitorId}
                onChange={(e) => setSelectedMonitorId(e.target.value)}
                className="px-3 py-1.5 rounded-xl bg-zinc-950 border border-zinc-800 text-xs text-white"
              >
                <option value="all">All Endpoints Combined</option>
                {monitors.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name} ({m.uptimePercent}% • P95 {m.p95LatencyMs}ms)
                  </option>
                ))}
              </select>
            )}
          </div>

          <div className="h-52">
            {chartData.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chartData}>
                  <XAxis dataKey="time" tick={{ fill: "#71717a", fontSize: 10 }} />
                  <YAxis tick={{ fill: "#71717a", fontSize: 10 }} width={40} unit="ms" />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "#09090b",
                      borderColor: "#27272a",
                      borderRadius: "8px",
                      fontSize: "12px",
                    }}
                  />
                  <Area
                    type="monotone"
                    dataKey="latencyMs"
                    name="Latency (ms)"
                    stroke="#a855f7"
                    fill="#a855f725"
                    strokeWidth={2}
                  />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-full rounded-xl bg-zinc-950/60 border border-zinc-800/70 flex items-center justify-center text-xs text-zinc-500">
                Add a /health probe above and run Ping Now to record per-endpoint P95 latency history.
              </div>
            )}
          </div>
        </div>
      </div>
    </WorkspaceShell>
  );
}
