"use client";

import React, { useState } from "react";
import {
  Activity,
  Plus,
  RefreshCw,
  Trash2,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Loader2,
  Gauge,
} from "lucide-react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

export interface UptimeMonitorSummaryItem {
  id: string;
  name: string;
  url: string;
  lastStatus: string;
  lastStatusCode: number | null;
  lastLatencyMs: number | null;
  p95LatencyMs: number;
  uptimePercent: string;
  lastCheckedAt: string | null;
}

export interface UptimeCheckPoint {
  id: string;
  monitorId: string;
  status: string;
  statusCode: number | null;
  latencyMs: number;
  edgeRegion: string;
  checkedAt: string;
}

export interface UptimeSummaryPayload {
  monitors: UptimeMonitorSummaryItem[];
  recentChecks: UptimeCheckPoint[];
  overallP95Ms: number;
  overallUptimePercent: string;
}

interface UptimeMonitorsCardProps {
  projectId: string;
  initialSummary?: UptimeSummaryPayload | null;
  isPublicPortal?: boolean;
  isDemo?: boolean;
}

export function UptimeMonitorsCard({
  projectId,
  initialSummary,
  isPublicPortal = false,
  isDemo = false,
}: UptimeMonitorsCardProps) {
  const [summary, setSummary] = useState<UptimeSummaryPayload>(
    initialSummary || {
      monitors: [],
      recentChecks: [],
      overallP95Ms: 0,
      overallUptimePercent: "100.00",
    }
  );
  const [showAdd, setShowAdd] = useState(false);
  const [name, setName] = useState("API /health");
  const [url, setUrl] = useState("");
  const [expectedStatus, setExpectedStatus] = useState("200");
  const [busy, setBusy] = useState(false);
  const [pingingId, setPingingId] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const reloadMonitors = async () => {
    try {
      const res = await fetch(`/api/v1/monitors?projectId=${encodeURIComponent(projectId)}`);
      if (!res.ok) return;
      const data = await res.json();
      setSummary({
        monitors: (data.monitors || []).map((m: any) => ({
          id: m.id,
          name: m.name,
          url: m.url,
          lastStatus: m.lastStatus,
          lastStatusCode: m.lastStatusCode,
          lastLatencyMs: m.lastLatencyMs,
          p95LatencyMs: m.p95LatencyMs,
          uptimePercent: ((m.uptimeBasisPoints ?? 10000) / 100).toFixed(2),
          lastCheckedAt: m.lastCheckedAt,
        })),
        recentChecks: data.recentChecks || [],
        overallP95Ms: data.summary?.overallP95Ms || 0,
        overallUptimePercent: data.summary?.overallUptimePercent || "100.00",
      });
    } catch {
      // ignore transient reload failure
    }
  };

  const handleAddMonitor = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isDemo || isPublicPortal || !url.trim()) return;
    setBusy(true);
    setErrorMsg(null);
    try {
      const res = await fetch("/api/v1/monitors", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "create",
          projectId,
          name: name.trim() || "Health Endpoint",
          url: url.trim(),
          expectedStatus: Number(expectedStatus) || 200,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to create monitor");
      setUrl("");
      setShowAdd(false);
      await reloadMonitors();
    } catch (err: any) {
      setErrorMsg(err.message || "Failed to add monitor");
    } finally {
      setBusy(false);
    }
  };

  const handlePingNow = async (monitorId: string) => {
    if (isDemo || isPublicPortal) return;
    setPingingId(monitorId);
    try {
      await fetch("/api/v1/monitors", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "ping", projectId, monitorId }),
      });
      await reloadMonitors();
    } finally {
      setPingingId(null);
    }
  };

  const handleDelete = async (monitorId: string) => {
    if (isDemo || isPublicPortal) return;
    setPingingId(monitorId);
    try {
      await fetch("/api/v1/monitors", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "delete", projectId, monitorId }),
      });
      await reloadMonitors();
    } finally {
      setPingingId(null);
    }
  };

  const chartData = summary.recentChecks.slice(-24).map((c) => ({
    time: c.checkedAt ? new Date(c.checkedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "",
    latency: c.latencyMs,
    status: c.status,
  }));

  const anyDown = summary.monitors.some((m) => m.lastStatus === "down");
  const anyDegraded = summary.monitors.some((m) => m.lastStatus === "degraded");

  return (
    <div className="flex flex-col h-full justify-between p-5 rounded-2xl bg-zinc-900/90 border border-zinc-800/80 shadow-lg shadow-black/40 hover:border-zinc-700/80 transition">
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-emerald-950/80 border border-emerald-800/60 flex items-center justify-center text-emerald-400">
              <Activity className="w-4 h-4" />
            </div>
            <div>
              <h3 className="font-semibold text-white text-base leading-tight flex items-center gap-2">
                <span>Uptime &amp; P95 Latency</span>
                <span
                  className={`text-[10px] font-mono px-1.5 py-0.5 rounded border ${
                    anyDown
                      ? "bg-red-500/15 text-red-300 border-red-500/30"
                      : anyDegraded
                      ? "bg-amber-500/15 text-amber-300 border-amber-500/30"
                      : "bg-emerald-500/15 text-emerald-300 border-emerald-500/30"
                  }`}
                >
                  {summary.monitors.length > 0
                    ? `${summary.overallUptimePercent}% up`
                    : "No monitors"}
                </span>
              </h3>
              <p className="text-xs text-zinc-400">
                Edge /health probes &bull; P95 response latency
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {summary.overallP95Ms > 0 && (
              <span className="flex items-center gap-1 text-[11px] font-mono px-2 py-1 rounded-lg bg-zinc-950 border border-zinc-800 text-purple-300">
                <Gauge className="w-3 h-3" />
                <span>P95: {summary.overallP95Ms}ms</span>
              </span>
            )}
            {!isPublicPortal && (
              <button
                type="button"
                onClick={() => setShowAdd(!showAdd)}
                className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-emerald-600/20 hover:bg-emerald-600/35 border border-emerald-500/40 text-[11px] font-semibold text-emerald-200 transition"
              >
                <Plus className="w-3 h-3" />
                <span>{showAdd ? "Close" : "Add Probe"}</span>
              </button>
            )}
          </div>
        </div>

        {errorMsg && (
          <div className="p-2.5 rounded-xl bg-red-950/60 border border-red-800/60 text-xs text-red-200">
            {errorMsg}
          </div>
        )}

        {showAdd && !isPublicPortal && (
          <form
            onSubmit={handleAddMonitor}
            className="p-3 rounded-xl bg-zinc-950 border border-zinc-800 grid grid-cols-1 sm:grid-cols-4 gap-2"
          >
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Label (e.g. API /health)"
              className="px-2.5 py-1.5 rounded-lg bg-zinc-900 border border-zinc-800 text-xs text-white"
            />
            <input
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://api.myapp.com/health"
              required
              className="sm:col-span-2 px-2.5 py-1.5 rounded-lg bg-zinc-900 border border-zinc-800 text-xs text-white font-mono"
            />
            <div className="flex gap-1.5">
              <input
                type="number"
                value={expectedStatus}
                onChange={(e) => setExpectedStatus(e.target.value)}
                min={100}
                max={599}
                className="w-16 px-2 py-1.5 rounded-lg bg-zinc-900 border border-zinc-800 text-xs text-white font-mono"
                title="Expected HTTP Status"
              />
              <button
                type="submit"
                disabled={busy || isDemo}
                className="flex-1 px-2.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold disabled:opacity-50"
              >
                {busy ? "Adding..." : "Save"}
              </button>
            </div>
          </form>
        )}

        {summary.monitors.length === 0 ? (
          <div className="py-5 px-4 text-center rounded-xl bg-zinc-950/60 border border-zinc-800/60 text-xs text-zinc-400 space-y-2.5">
            <p>
              {isPublicPortal
                ? "No public uptime endpoints configured for this project yet."
                : "Add your app's /health URL to monitor uptime availability, P95 latency, and instant downtime alerts."}
            </p>
            {!isPublicPortal && !showAdd && (
              <button
                type="button"
                onClick={() => setShowAdd(true)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600/20 hover:bg-emerald-600/35 border border-emerald-500/40 text-emerald-200 text-xs font-semibold transition"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Add First /health Probe</span>
              </button>
            )}
          </div>
        ) : (
          <div className="space-y-2 max-h-40 overflow-y-auto pr-1">
            {summary.monitors.map((m) => (
              <div
                key={m.id}
                className="p-2.5 rounded-xl bg-zinc-950/80 border border-zinc-800/80 flex items-center justify-between gap-2"
              >
                <div className="flex items-center gap-2 min-w-0">
                  {m.lastStatus === "up" ? (
                    <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                  ) : m.lastStatus === "degraded" ? (
                    <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
                  ) : (
                    <XCircle className="w-4 h-4 text-red-400 shrink-0" />
                  )}
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs font-semibold text-white truncate">
                        {m.name}
                      </span>
                      <span className="text-[10px] font-mono text-zinc-400">
                        {m.lastStatusCode ? `HTTP ${m.lastStatusCode}` : m.lastStatus}
                      </span>
                    </div>
                    <div className="text-[10px] font-mono text-zinc-500 truncate">
                      {m.url}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0 text-[11px] font-mono">
                  <span className="text-emerald-300">{m.uptimePercent}%</span>
                  <span className="text-purple-300">P95 {m.p95LatencyMs}ms</span>
                  {!isPublicPortal && (
                    <>
                      <button
                        type="button"
                        onClick={() => handlePingNow(m.id)}
                        disabled={pingingId === m.id || isDemo}
                        title="Run edge heartbeat check now"
                        className="p-1 rounded-md bg-zinc-900 hover:bg-zinc-800 text-zinc-300 border border-zinc-800 transition disabled:opacity-40"
                      >
                        {pingingId === m.id ? (
                          <Loader2 className="w-3 h-3 animate-spin" />
                        ) : (
                          <RefreshCw className="w-3 h-3" />
                        )}
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDelete(m.id)}
                        disabled={pingingId === m.id || isDemo}
                        title="Delete monitor"
                        className="p-1 rounded-md bg-zinc-900 hover:bg-red-950/60 text-zinc-500 hover:text-red-300 border border-zinc-800 transition disabled:opacity-40"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {chartData.length > 0 && (
        <div className="mt-3 pt-2 border-t border-zinc-800/70">
          <div className="flex items-center justify-between text-[10px] text-zinc-500 mb-1">
            <span>Recent Edge Response Latency (ms)</span>
            <span>{chartData.length} samples</span>
          </div>
          <div className="h-20 w-full min-w-0">
            <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 320, height: 80 }}>
              <AreaChart data={chartData}>
                <defs>
                  <linearGradient id={`lat-${projectId}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#10b981" stopOpacity={0.35} />
                    <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <XAxis dataKey="time" hide />
                <YAxis hide domain={[0, "dataMax + 20"]} />
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
                  dataKey="latency"
                  stroke="#10b981"
                  strokeWidth={2}
                  fill={`url(#lat-${projectId})`}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}
    </div>
  );
}
