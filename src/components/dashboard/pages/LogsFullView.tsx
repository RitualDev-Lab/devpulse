"use client";

import React, { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import {
  ScrollText,
  Search,
  Terminal,
  Copy,
  Check,
  Sparkles,
  Loader2,
  Radio,
  Pause,
  Bookmark,
  AlertTriangle,
  Trash2,
  Clock,
  Bell,
} from "lucide-react";
import type { LoadedWorkspaceReady } from "@/lib/dashboard/load-workspace";
import { WorkspaceShell } from "../WorkspaceShell";
import { PUBLIC_APP_URL } from "@/lib/config/app-url";
import { maskApiKey } from "@/lib/security/mask-key";
import { extractJsonFieldsFromLog, type LogSpikeAnalysis } from "@/lib/logs/spike-detector";

interface StructuredLogRow {
  id: string;
  level: string;
  serviceName: string;
  message: string;
  labelsJson: string | null;
  traceId: string | null;
  timestampMs: number;
  timestampIso: string;
}

interface SavedQueryItem {
  id: string;
  name: string;
  q: string;
  level: string;
  service: string;
}

export function LogsFullView({ workspace }: { workspace: LoadedWorkspaceReady }) {
  const { initialData, projects, customDomain, storageTier, isDemo } = workspace;
  const project = initialData.project;

  const [logs, setLogs] = useState<StructuredLogRow[]>([]);
  const [services, setServices] = useState<string[]>([]);
  const [savedQueries, setSavedQueries] = useState<SavedQueryItem[]>([]);
  const [spikeAnalysis, setSpikeAnalysis] = useState<LogSpikeAnalysis | null>(null);
  const [query, setQuery] = useState("");
  const [level, setLevel] = useState("all");
  const [service, setService] = useState("all");
  const [timeWindow, setTimeWindow] = useState<"all" | "15m" | "1h" | "24h" | "7d">("all");
  const [liveTail, setLiveTail] = useState(false);
  const [tailHoverPaused, setTailHoverPaused] = useState(false);
  const [saveName, setSaveName] = useState("");
  const [showSaveBox, setShowSaveBox] = useState(false);
  const [loading, setLoading] = useState(false);
  const [emitting, setEmitting] = useState(false);
  const [copiedLoki, setCopiedLoki] = useState(false);

  const loadLogs = useCallback(async () => {
    setLoading(true);
    try {
      const windowMsMap: Record<string, number> = {
        "15m": 15 * 60 * 1000,
        "1h": 60 * 60 * 1000,
        "24h": 24 * 60 * 60 * 1000,
        "7d": 7 * 24 * 60 * 60 * 1000,
      };
      const sinceMs = windowMsMap[timeWindow] ? String(Date.now() - windowMsMap[timeWindow]) : "";
      const qs = new URLSearchParams({
        projectId: project.id,
        ...(query ? { q: query } : {}),
        ...(level !== "all" ? { level } : {}),
        ...(service !== "all" ? { service } : {}),
        ...(sinceMs ? { sinceMs } : {}),
      });
      const res = await fetch(`/api/v1/logs?${qs.toString()}`);
      const d = await res.json();
      if (res.ok) {
        setLogs(d.logs || []);
        setServices(d.services || []);
        setSpikeAnalysis(d.spikeAnalysis || null);
        setSavedQueries(d.savedQueries || []);
      }
    } finally {
      setLoading(false);
    }
  }, [project.id, query, level, service, timeWindow]);

  useEffect(() => {
    const t = setTimeout(() => {
      void loadLogs();
    }, 150);
    return () => clearTimeout(t);
  }, [loadLogs]);

  useEffect(() => {
    if (!liveTail || tailHoverPaused) return;
    const iv = setInterval(() => {
      void loadLogs();
    }, 3000);
    return () => clearInterval(iv);
  }, [liveTail, tailHoverPaused, loadLogs]);

  const handleSaveQuery = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isDemo || !saveName.trim()) return;
    await fetch("/api/v1/logs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "save_query",
        projectId: project.id,
        name: saveName.trim(),
        q: query,
        level,
        service,
      }),
    });
    setSaveName("");
    setShowSaveBox(false);
    await loadLogs();
  };

  const handleDeleteQuery = async (id: string) => {
    if (isDemo) return;
    await fetch("/api/v1/logs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "delete_query", projectId: project.id, id }),
    });
    await loadLogs();
  };

  const lokiSnippet = `curl -X POST ${PUBLIC_APP_URL}/api/v1/loki/api/v1/push \\
  -H "Authorization: Bearer ${maskApiKey(project.telemetryApiKey, "YOUR_API_KEY")}" \\
  -H "Content-Type: application/json" \\
  -d '{"streams":[{"stream":{"service":"api","level":"info"},"values":[["'$(date +%s%N)'","Server started on port 3000"]]}]}'`;

  return (
    <WorkspaceShell
      currentProject={{ ...project, telemetryApiKey: project.telemetryApiKey }}
      projects={projects}
      storageTier={storageTier}
      customDomain={customDomain}
      isDemo={isDemo}
    >
      <div className="space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-extrabold text-white flex items-center gap-2.5">
              <ScrollText className="w-6 h-6 text-emerald-400" />
              <span>Log Aggregation &amp; Real-Time Live Tail</span>
            </h1>
            <p className="text-xs text-zinc-400 mt-0.5">
              Full-text + JSON field extraction, saved queries, 3s Live Tail &amp; 24h error spike anomaly detection.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href={`/dashboard/crashes?project=${encodeURIComponent(project.slug)}${isDemo ? "&demo=1" : ""}#smart-alerts`}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-xs font-semibold text-amber-300 transition"
            >
              <Bell className="w-3.5 h-3.5" />
              <span>Create Alert Rule</span>
            </Link>
            <button
              type="button"
              onClick={() => setLiveTail((prev) => !prev)}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-xl border text-xs font-semibold transition ${
                liveTail
                  ? "bg-emerald-500/20 border-emerald-500/40 text-emerald-300"
                  : "bg-zinc-900 hover:bg-zinc-800 border-zinc-800 text-zinc-200"
              }`}
            >
              {liveTail ? <Pause className="w-3.5 h-3.5" /> : <Radio className="w-3.5 h-3.5 text-emerald-400" />}
              <span>{liveTail ? "Live Tail On (3s)" : "Start Live Tail"}</span>
            </button>
            {!isDemo && (
              <button
                type="button"
                disabled={emitting}
                onClick={async () => {
                  setEmitting(true);
                  await fetch("/api/v1/logs", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ projectId: project.id, action: "emit_sample" }),
                  });
                  await loadLogs();
                  setEmitting(false);
                }}
                className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-emerald-600/20 hover:bg-emerald-600/35 border border-emerald-500/40 text-emerald-200 text-xs font-semibold"
              >
                {emitting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                <span>Emit Sample Logs</span>
              </button>
            )}
          </div>
        </div>

        {/* Spike Anomaly Detection Status */}
        {spikeAnalysis && (
          <div
            className={`p-3.5 rounded-2xl border flex flex-wrap items-center justify-between gap-2 text-xs ${
              spikeAnalysis.isSpike
                ? "bg-red-950/40 border-red-500/40 text-red-200"
                : "bg-zinc-900/80 border-zinc-800 text-zinc-300"
            }`}
          >
            <div className="flex items-center gap-2">
              <AlertTriangle className={`w-4 h-4 shrink-0 ${spikeAnalysis.isSpike ? "text-red-400" : "text-emerald-400"}`} />
              <span>{spikeAnalysis.summary}</span>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-[11px] text-zinc-400">
                Current: {spikeAnalysis.currentErrorCount}/hr &bull; Baseline avg: {spikeAnalysis.baselineHourlyAvg}/hr
              </span>
              <Link
                href={`/dashboard/crashes?project=${encodeURIComponent(project.slug)}${isDemo ? "&demo=1" : ""}#smart-alerts`}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-zinc-950/90 hover:bg-zinc-800 border border-zinc-700 text-[11px] font-semibold text-amber-300 transition"
              >
                <Bell className="w-3 h-3" />
                <span>Create Alert Rule</span>
              </Link>
            </div>
          </div>
        )}

        {/* Saved Queries Strip */}
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => {
              setQuery("");
              setLevel("error");
              setService("all");
            }}
            className="text-[11px] px-2.5 py-1 rounded-lg bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-zinc-300"
          >
            Preset: Errors Only
          </button>
          <button
            type="button"
            onClick={() => {
              setQuery("latency");
              setLevel("all");
            }}
            className="text-[11px] px-2.5 py-1 rounded-lg bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-zinc-300"
          >
            Preset: Latency Events
          </button>
          {savedQueries.map((sq) => (
            <span
              key={sq.id}
              className="inline-flex items-center gap-1 text-[11px] px-2.5 py-1 rounded-lg bg-indigo-500/15 border border-indigo-500/30 text-indigo-200"
            >
              <button
                type="button"
                onClick={() => {
                  setQuery(sq.q);
                  setLevel(sq.level);
                  setService(sq.service);
                }}
              >
                {sq.name}
              </button>
              {!isDemo && (
                <button
                  type="button"
                  onClick={() => void handleDeleteQuery(sq.id)}
                  className="text-indigo-300/70 hover:text-red-300 ml-0.5"
                  title="Delete saved query"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              )}
            </span>
          ))}
          {!isDemo && (
            <button
              type="button"
              onClick={() => setShowSaveBox((s) => !s)}
              className="inline-flex items-center gap-1 text-[11px] px-2.5 py-1 rounded-lg bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-cyan-300"
            >
              <Bookmark className="w-3 h-3" />
              <span>Save Current Filter</span>
            </button>
          )}
        </div>

        {showSaveBox && (
          <form onSubmit={handleSaveQuery} className="flex items-center gap-2 max-w-md">
            <input
              type="text"
              required
              value={saveName}
              onChange={(e) => setSaveName(e.target.value)}
              placeholder="Saved query name (e.g., Stripe 502s)"
              className="flex-1 px-3 py-1.5 rounded-lg bg-zinc-950 border border-zinc-800 text-xs text-white"
            />
            <button type="submit" className="px-3 py-1.5 rounded-lg bg-indigo-600 text-white text-xs font-semibold">
              Save
            </button>
          </form>
        )}

        {/* Loki Push Endpoint Banner */}
        <div className="p-4 rounded-2xl bg-zinc-900/90 border border-zinc-800 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <Terminal className="w-4 h-4 text-emerald-400 shrink-0" />
            <code className="text-[11px] font-mono text-zinc-300 truncate">
              POST /api/v1/loki/api/v1/push (Grafana Loki / Promtail / Vector compatible)
            </code>
          </div>
          <button
            type="button"
            onClick={() => {
              navigator.clipboard.writeText(lokiSnippet);
              setCopiedLoki(true);
              setTimeout(() => setCopiedLoki(false), 1500);
            }}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-xs text-white font-semibold"
          >
            {copiedLoki ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
            <span>{copiedLoki ? "Copied Curl" : "Copy Loki Push Curl"}</span>
          </button>
        </div>

        {/* Search & Filter Controls */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[240px]">
            <Search className="w-4 h-4 text-zinc-500 absolute left-3 top-2.5" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Full-text search across messages, JSON fields, labels, traceId..."
              className="w-full pl-9 pr-3 py-2 rounded-xl bg-zinc-900 border border-zinc-800 text-xs text-white"
            />
          </div>
          <select
            value={level}
            onChange={(e) => setLevel(e.target.value)}
            className="px-3 py-2 rounded-xl bg-zinc-900 border border-zinc-800 text-xs text-white"
          >
            <option value="all">All Levels</option>
            <option value="fatal">FATAL</option>
            <option value="error">ERROR</option>
            <option value="warn">WARN</option>
            <option value="info">INFO</option>
            <option value="debug">DEBUG</option>
          </select>
          <select
            value={service}
            onChange={(e) => setService(e.target.value)}
            className="px-3 py-2 rounded-xl bg-zinc-900 border border-zinc-800 text-xs text-white"
          >
            <option value="all">All Services</option>
            {services.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <div className="flex items-center gap-1 bg-zinc-900 p-1 rounded-xl border border-zinc-800 text-[11px]">
            <Clock className="w-3.5 h-3.5 text-zinc-500 mx-1" />
            {(["15m", "1h", "24h", "7d", "all"] as const).map((win) => (
              <button
                key={win}
                type="button"
                onClick={() => setTimeWindow(win)}
                className={`px-2 py-1 rounded-lg font-mono uppercase transition ${
                  timeWindow === win
                    ? "bg-emerald-600 text-white"
                    : "text-zinc-400 hover:text-white"
                }`}
              >
                {win}
              </button>
            ))}
          </div>
        </div>

        {/* Logs Stream with Extracted JSON Fields */}
        <div
          onMouseEnter={() => { if (liveTail) setTailHoverPaused(true); }}
          onMouseLeave={() => { if (liveTail) setTailHoverPaused(false); }}
          className="rounded-2xl bg-zinc-900/90 border border-zinc-800 overflow-hidden"
        >
          {liveTail && tailHoverPaused && (
            <div className="px-4 py-1.5 bg-amber-950/50 border-b border-amber-500/30 text-[11px] text-amber-200 flex items-center justify-between">
              <span>Live Tail paused while inspecting rows — move pointer away to resume polling</span>
              <span className="font-mono text-[10px]">PAUSED</span>
            </div>
          )}
          {loading && logs.length === 0 ? (
            <div className="p-8 text-center text-xs text-zinc-500">Searching structured logs...</div>
          ) : logs.length === 0 ? (
            <div className="p-8 text-center text-xs text-zinc-400">
              No structured logs matched. Push logs via Loki Push API or click &ldquo;Emit Sample Logs&rdquo;.
            </div>
          ) : (
            <div className="divide-y divide-zinc-800/70 font-mono text-xs">
              {logs.map((l) => {
                const extracted = Object.entries(extractJsonFieldsFromLog(l.message, l.labelsJson));
                return (
                  <div key={l.id} className="px-4 py-2.5 space-y-1.5 hover:bg-zinc-950/70">
                    <div className="flex flex-wrap sm:flex-nowrap items-start gap-2.5">
                      <span className="text-[11px] text-zinc-500 shrink-0 w-24">
                        {l.timestampIso.slice(11, 23)}
                      </span>
                      <span
                        className={`text-[10px] font-bold uppercase px-1.5 py-0.5 rounded shrink-0 w-14 text-center ${
                          l.level === "error" || l.level === "fatal"
                            ? "bg-red-500/20 text-red-300"
                            : l.level === "warn"
                            ? "bg-amber-500/20 text-amber-300"
                            : l.level === "debug"
                            ? "bg-zinc-800 text-zinc-400"
                            : "bg-emerald-500/15 text-emerald-300"
                        }`}
                      >
                        {l.level}
                      </span>
                      <span className="text-[11px] px-2 py-0.5 rounded bg-zinc-950 border border-zinc-800 text-cyan-300 shrink-0">
                        {l.serviceName}
                      </span>
                      <span className="text-zinc-200 flex-1 break-all min-w-0">
                        {(() => {
                          const qTrim = query.trim();
                          if (!qTrim) return l.message;
                          const idx = l.message.toLowerCase().indexOf(qTrim.toLowerCase());
                          if (idx === -1) return l.message;
                          return (
                            <>
                              {l.message.slice(0, idx)}
                              <mark className="bg-amber-500/30 text-amber-200 rounded px-0.5">
                                {l.message.slice(idx, idx + qTrim.length)}
                              </mark>
                              {l.message.slice(idx + qTrim.length)}
                            </>
                          );
                        })()}
                      </span>
                      {l.traceId && (
                        <span className="text-[10px] text-indigo-300 shrink-0">
                          trace:{l.traceId.slice(0, 8)}
                        </span>
                      )}
                    </div>
                    {extracted.length > 0 && (
                      <div className="flex flex-wrap items-center gap-1.5 pl-0 sm:pl-28">
                        {extracted.slice(0, 6).map(([k, v]) => (
                          <button
                            key={k}
                            type="button"
                            onClick={() => setQuery(v)}
                            className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-950 hover:bg-zinc-800 border border-zinc-800 text-zinc-400 hover:text-cyan-300 transition"
                            title={`Filter by ${k}=${v}`}
                          >
                            {k}=<span className="text-zinc-200">{v}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </WorkspaceShell>
  );
}
