"use client";

import React, { useEffect, useState, useCallback } from "react";
import { Bot, RefreshCw, ShieldCheck, ShieldOff, DollarSign, Clock, AlertTriangle, Play } from "lucide-react";
import { AreaChart, Area, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";
import type { LoadedWorkspaceReady } from "@/lib/dashboard/load-workspace";
import type { AggregatedMcpToolMetric } from "@/lib/integrations/mcp-analytics";
import { DEVPULSE_MCP_TOOLS } from "@/lib/integrations/mcp-policy";
import { WorkspaceShell } from "../WorkspaceShell";
import { useWorkspaceData } from "../WorkspaceCacheContext";

interface McpAnalyticsPayload {
  windowDays: number;
  totalCalls: number;
  deniedCount: number;
  errorCount: number;
  errorRatePercent: number;
  p50DurationMs: number;
  p95DurationMs: number;
  totalTokens: number;
  estimatedCostUsd: number;
  policy: { mode: "all_allowed" | "allowlist"; allowedTools: string[] };
  tools: AggregatedMcpToolMetric[];
  daily: Record<string, { calls: number; errors: number; costUsd: number }>;
}

const DEMO_MCP_ANALYTICS: McpAnalyticsPayload = {
  windowDays: 30,
  totalCalls: 1482,
  deniedCount: 11,
  errorCount: 18,
  errorRatePercent: 2.0,
  p50DurationMs: 145,
  p95DurationMs: 420,
  totalTokens: 1_284_600,
  estimatedCostUsd: 1.6058,
  policy: { mode: "all_allowed", allowedTools: [...DEVPULSE_MCP_TOOLS] },
  tools: [
    { toolName: "list_projects", calls: 420, denied: 0, errors: 1, errorRatePercent: 0.2, avgDurationMs: 92, p50DurationMs: 85, p95DurationMs: 180, estimatedTokens: 210_000, estimatedCostUsd: 0.2625 },
    { toolName: "inspect_crashes", calls: 390, denied: 2, errors: 6, errorRatePercent: 2.1, avgDurationMs: 188, p50DurationMs: 162, p95DurationMs: 440, estimatedTokens: 485_000, estimatedCostUsd: 0.6063 },
    { toolName: "query_logs", calls: 345, denied: 4, errors: 5, errorRatePercent: 2.6, avgDurationMs: 164, p50DurationMs: 150, p95DurationMs: 390, estimatedTokens: 325_000, estimatedCostUsd: 0.4063 },
    { toolName: "get_analytics", calls: 215, denied: 0, errors: 2, errorRatePercent: 0.9, avgDurationMs: 121, p50DurationMs: 110, p95DurationMs: 255, estimatedTokens: 174_600, estimatedCostUsd: 0.2183 },
    { toolName: "trigger_sync", calls: 112, denied: 5, errors: 4, errorRatePercent: 8.0, avgDurationMs: 310, p50DurationMs: 280, p95DurationMs: 620, estimatedTokens: 90_000, estimatedCostUsd: 0.1125 },
  ],
  daily: {
    "2026-11-20": { calls: 180, errors: 3, costUsd: 0.19 },
    "2026-11-21": { calls: 205, errors: 2, costUsd: 0.22 },
    "2026-11-22": { calls: 194, errors: 5, costUsd: 0.21 },
    "2026-11-23": { calls: 230, errors: 4, costUsd: 0.25 },
    "2026-11-24": { calls: 248, errors: 6, costUsd: 0.27 },
    "2026-11-25": { calls: 212, errors: 4, costUsd: 0.23 },
    "2026-11-26": { calls: 213, errors: 5, costUsd: 0.24 },
  },
};

export function McpAnalyticsFullView({ workspace }: { workspace: LoadedWorkspaceReady }) {
  const { projects, customDomain, storageTier, isDemo } = workspace;
  const initialData = useWorkspaceData(workspace.initialData);
  const project = initialData.project;

  const [data, setData] = useState<McpAnalyticsPayload>(DEMO_MCP_ANALYTICS);
  const [loading, setLoading] = useState(false);
  const [policyBusy, setPolicyBusy] = useState<string | null>(null);
  const [budgetUsd, setBudgetUsd] = useState<number>(5);
  const [simTool, setSimTool] = useState<string>(DEVPULSE_MCP_TOOLS[0]);
  const [simOutput, setSimOutput] = useState<string | null>(null);

  const loadMcp = useCallback(async () => {
    if (isDemo) {
      setData(DEMO_MCP_ANALYTICS);
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(`/api/v1/mcp?projectId=${encodeURIComponent(project.id)}`);
      const d = await res.json();
      if (res.ok) setData(d);
    } finally {
      setLoading(false);
    }
  }, [project.id, isDemo]);

  useEffect(() => {
    void loadMcp();
  }, [loadMcp]);

  const toggleToolPolicy = async (toolName: string) => {
    if (isDemo) return;
    setPolicyBusy(toolName);
    try {
      const currentAllowed = new Set(data.policy.allowedTools);
      if (currentAllowed.has(toolName)) currentAllowed.delete(toolName);
      else currentAllowed.add(toolName);
      const nextList = Array.from(currentAllowed);
      const res = await fetch("/api/v1/mcp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "configure",
          projectId: project.id,
          allowedTools: nextList.length === DEVPULSE_MCP_TOOLS.length ? null : nextList,
        }),
      });
      if (res.ok) await loadMcp();
    } finally {
      setPolicyBusy(null);
    }
  };

  const chartSeries = Object.entries(data.daily || {})
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, stats]) => ({ date: date.slice(5), ...stats }));

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
              <Bot className="w-6 h-6 text-indigo-400" />
              <span>MCP Server &amp; AI Agent Analytics</span>
            </h1>
            <p className="text-xs text-zinc-400 mt-0.5">
              Track MCP tool invocations, p50/p95 latency, policy denials, token volume, and estimated LLM spend
            </p>
          </div>
          <button
            type="button"
            onClick={() => void loadMcp()}
            disabled={loading}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-xs text-zinc-200 transition"
          >
            <RefreshCw className={`w-3.5 h-3.5 text-cyan-400 ${loading ? "animate-spin" : ""}`} />
            <span>Refresh</span>
          </button>
        </div>

        {/* Summary KPI Grid */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <div className="p-4 rounded-2xl bg-zinc-900/90 border border-zinc-800">
            <div className="text-[11px] text-zinc-400">30-Day MCP Tool Calls</div>
            <div className="text-2xl font-bold text-white mt-1">{data.totalCalls.toLocaleString()}</div>
          </div>
          <div className="p-4 rounded-2xl bg-zinc-900/90 border border-zinc-800">
            <div className="text-[11px] text-zinc-400 flex items-center gap-1">
              <Clock className="w-3.5 h-3.5 text-cyan-400" /> p50 / p95 Latency
            </div>
            <div className="text-2xl font-bold text-cyan-300 mt-1">
              {data.p50DurationMs}ms <span className="text-sm text-zinc-400">/ {data.p95DurationMs}ms</span>
            </div>
          </div>
          <div className="p-4 rounded-2xl bg-zinc-900/90 border border-zinc-800">
            <div className="text-[11px] text-zinc-400 flex items-center gap-1">
              <AlertTriangle className="w-3.5 h-3.5 text-amber-400" /> Errors &amp; Policy Denials
            </div>
            <div className="text-2xl font-bold text-amber-300 mt-1">
              {data.errorRatePercent}% <span className="text-xs font-normal text-zinc-400">({data.deniedCount} denied)</span>
            </div>
          </div>
          <div className="p-4 rounded-2xl bg-zinc-900/90 border border-zinc-800">
            <div className="text-[11px] text-zinc-400 flex items-center gap-1">
              <DollarSign className="w-3.5 h-3.5 text-emerald-400" /> Est. Token Spend
            </div>
            <div className="text-2xl font-bold text-emerald-300 mt-1">
              ${data.estimatedCostUsd.toFixed(2)}{" "}
              <span className="text-xs font-normal text-zinc-400">({Math.round(data.totalTokens / 1000)}k tok)</span>
            </div>
          </div>
        </div>

        {/* Daily MCP Tool Volume & Per-Tool Cost Charts */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="p-5 rounded-2xl bg-zinc-900/90 border border-zinc-800 space-y-3">
            <div>
              <h2 className="text-sm font-bold text-white">Daily Agent Tool Calls</h2>
              <p className="text-xs text-zinc-400">Invocation velocity across authorized MCP clients</p>
            </div>
            <div className="h-48 min-w-0">
              {chartSeries.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 420, height: 192 }}>
                  <AreaChart data={chartSeries} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                    <XAxis dataKey="date" tick={{ fill: "#71717a", fontSize: 10 }} />
                    <YAxis tick={{ fill: "#71717a", fontSize: 10 }} width={40} />
                    <Tooltip contentStyle={{ backgroundColor: "#09090b", borderColor: "#27272a", borderRadius: "8px", fontSize: "12px" }} />
                    <Area type="monotone" dataKey="calls" name="Calls" stroke="#818cf8" fill="#818cf825" strokeWidth={2} />
                  </AreaChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-full rounded-xl bg-zinc-950/60 border border-zinc-800 flex items-center justify-center text-xs text-zinc-500">
                  No MCP tool calls recorded yet.
                </div>
              )}
            </div>
          </div>

          <div className="p-5 rounded-2xl bg-zinc-900/90 border border-zinc-800 space-y-3">
            <div>
              <h2 className="text-sm font-bold text-white">Per-Tool Token Cost Distribution (USD)</h2>
              <p className="text-xs text-zinc-400">Identify high-spend agent tools for prompt or cache tuning</p>
            </div>
            <div className="h-48 min-w-0">
              {(data.tools || []).length > 0 ? (
                <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 420, height: 192 }}>
                  <BarChart
                    data={data.tools.map((t) => ({
                      tool: t.toolName.replace(/_/g, " "),
                      costUsd: Number(t.estimatedCostUsd.toFixed(4)),
                    }))}
                    margin={{ top: 8, right: 12, left: 0, bottom: 0 }}
                  >
                    <XAxis dataKey="tool" tick={{ fill: "#71717a", fontSize: 10 }} />
                    <YAxis tick={{ fill: "#71717a", fontSize: 10 }} width={44} />
                    <Tooltip contentStyle={{ backgroundColor: "#09090b", borderColor: "#27272a", borderRadius: "8px", fontSize: "12px" }} />
                    <Bar dataKey="costUsd" name="Est. Cost ($)" fill="#10b981" radius={[6, 6, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-full rounded-xl bg-zinc-950/60 border border-zinc-800 flex items-center justify-center text-xs text-zinc-500">
                  No tool cost breakdown yet.
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Policy Dry-Run Simulator & Monthly Budget Threshold */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="p-5 rounded-2xl bg-zinc-900/90 border border-zinc-800 space-y-3">
            <div>
              <h2 className="text-sm font-bold text-white">Policy Dry-Run Simulator</h2>
              <p className="text-xs text-zinc-400">Test whether an MCP client request passes your current allowlist policy</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <select
                value={simTool}
                onChange={(e) => setSimTool(e.target.value)}
                className="flex-1 min-w-[180px] px-3 py-2 rounded-xl bg-zinc-950 border border-zinc-800 text-xs font-mono text-white"
              >
                {DEVPULSE_MCP_TOOLS.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => {
                  const allowed = data.policy.allowedTools.includes(simTool);
                  const row = data.tools.find((t) => t.toolName === simTool);
                  setSimOutput(
                    allowed
                      ? `ALLOW — '${simTool}' permitted by policy (avg p50 ${row?.p50DurationMs ?? 120}ms, ~$${row?.estimatedCostUsd.toFixed(4) ?? "0.0010"}/30d)`
                      : `DENY (403) — '${simTool}' is blocked by workspace MCP allowlist`
                  );
                }}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold"
              >
                <Play className="w-3.5 h-3.5" />
                <span>Simulate Call</span>
              </button>
            </div>
            {simOutput && (
              <div className={`p-2.5 rounded-xl border text-xs font-mono ${simOutput.startsWith("ALLOW") ? "bg-emerald-950/40 border-emerald-500/30 text-emerald-200" : "bg-red-950/40 border-red-500/30 text-red-200"}`}>
                {simOutput}
              </div>
            )}
          </div>

          <div className="p-5 rounded-2xl bg-zinc-900/90 border border-zinc-800 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <div>
                <h2 className="text-sm font-bold text-white">Monthly Token Spend Budget</h2>
                <p className="text-xs text-zinc-400">Highlight projected overspend against monthly guardrail</p>
              </div>
              <label className="flex items-center gap-1.5 text-xs font-mono text-zinc-300">
                <span>Limit $</span>
                <input
                  type="number"
                  min={1}
                  step={1}
                  value={budgetUsd}
                  onChange={(e) => setBudgetUsd(Math.max(1, Number(e.target.value) || 1))}
                  className="w-20 px-2.5 py-1.5 rounded-lg bg-zinc-950 border border-zinc-800 text-white text-right"
                />
              </label>
            </div>
            {(() => {
              const pct = Math.min(100, Math.round((data.estimatedCostUsd / budgetUsd) * 100));
              const exceeded = data.estimatedCostUsd >= budgetUsd;
              return (
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between text-xs font-mono">
                    <span className={exceeded ? "text-red-300 font-bold" : "text-emerald-300"}>
                      ${data.estimatedCostUsd.toFixed(2)} used ({pct}%)
                    </span>
                    <span className="text-zinc-400">${budgetUsd.toFixed(2)} cap</span>
                  </div>
                  <div className="h-2 rounded-full bg-zinc-950 border border-zinc-800 overflow-hidden">
                    <div
                      style={{ width: `${Math.max(3, pct)}%` }}
                      className={`h-full transition-all ${exceeded ? "bg-red-500" : pct >= 80 ? "bg-amber-500" : "bg-emerald-500"}`}
                    />
                  </div>
                </div>
              );
            })()}
          </div>
        </div>

        {/* Per-Tool Latency, Cost & Policy Matrix */}
        <section className="rounded-2xl bg-zinc-900/90 border border-zinc-800 overflow-hidden">
          <div className="px-5 py-3.5 border-b border-zinc-800">
            <h2 className="text-sm font-bold text-white">Tool Latency, Cost &amp; Allowlist Policy</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-zinc-950/70 text-zinc-400 border-b border-zinc-800">
                <tr>
                  <th className="px-4 py-2.5">Tool</th>
                  <th className="px-4 py-2.5">Calls</th>
                  <th className="px-4 py-2.5">p50 / p95</th>
                  <th className="px-4 py-2.5">Error / Denied</th>
                  <th className="px-4 py-2.5">Est. Cost</th>
                  <th className="px-4 py-2.5">Policy</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800/60">
                {DEVPULSE_MCP_TOOLS.map((toolName) => {
                  const row = data.tools.find((t) => t.toolName === toolName);
                  const allowed = data.policy.allowedTools.includes(toolName);
                  return (
                    <tr key={toolName} className="hover:bg-zinc-950/40">
                      <td className="px-4 py-2.5 font-mono text-white font-semibold">{toolName}</td>
                      <td className="px-4 py-2.5 font-mono text-zinc-200">{row?.calls ?? 0}</td>
                      <td className="px-4 py-2.5 font-mono text-cyan-300">
                        {row ? `${row.p50DurationMs}ms / ${row.p95DurationMs}ms` : "—"}
                      </td>
                      <td className="px-4 py-2.5 font-mono text-zinc-300">
                        {row ? `${row.errorRatePercent}% (${row.errors}/${row.denied})` : "0%"}
                      </td>
                      <td className="px-4 py-2.5 font-mono text-emerald-300">
                        ${row ? row.estimatedCostUsd.toFixed(4) : "0.0000"}
                      </td>
                      <td className="px-4 py-2.5">
                        <button
                          type="button"
                          disabled={isDemo || policyBusy === toolName}
                          onClick={() => void toggleToolPolicy(toolName)}
                          className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border text-[11px] font-semibold disabled:opacity-60 ${
                            allowed
                              ? "bg-emerald-500/15 border-emerald-500/30 text-emerald-300"
                              : "bg-red-500/15 border-red-500/30 text-red-300"
                          }`}
                        >
                          {allowed ? <ShieldCheck className="w-3 h-3" /> : <ShieldOff className="w-3 h-3" />}
                          <span>{allowed ? "Allowed" : "Blocked"}</span>
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </WorkspaceShell>
  );
}
