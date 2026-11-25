"use client";

import React, { useState, useEffect, useCallback } from "react";
import {
  ScrollText,
  Search,
  Terminal,
  Copy,
  Check,
  Sparkles,
  Loader2,
} from "lucide-react";
import type { LoadedWorkspaceReady } from "@/lib/dashboard/load-workspace";
import { WorkspaceShell } from "../WorkspaceShell";

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

export function LogsFullView({ workspace }: { workspace: LoadedWorkspaceReady }) {
  const { initialData, projects, customDomain, storageTier, isDemo } = workspace;
  const project = initialData.project;

  const [logs, setLogs] = useState<StructuredLogRow[]>([]);
  const [services, setServices] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [level, setLevel] = useState("all");
  const [service, setService] = useState("all");
  const [loading, setLoading] = useState(false);
  const [emitting, setEmitting] = useState(false);
  const [copiedLoki, setCopiedLoki] = useState(false);

  const loadLogs = useCallback(async () => {
    setLoading(true);
    try {
      const qs = new URLSearchParams({
        projectId: project.id,
        ...(query ? { q: query } : {}),
        ...(level !== "all" ? { level } : {}),
        ...(service !== "all" ? { service } : {}),
      });
      const res = await fetch(`/api/v1/logs?${qs.toString()}`);
      const d = await res.json();
      if (res.ok) {
        setLogs(d.logs || []);
        setServices(d.services || []);
      }
    } finally {
      setLoading(false);
    }
  }, [project.id, query, level, service]);

  useEffect(() => {
    const t = setTimeout(() => {
      loadLogs();
    }, 150);
    return () => clearTimeout(t);
  }, [loadLogs]);

  const lokiSnippet = `curl -X POST https://devpulse.ritualdev.in/api/v1/loki/api/v1/push \\
  -H "Authorization: Bearer ${project.telemetryApiKey}" \\
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
      <div className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-extrabold text-white flex items-center gap-2.5">
              <ScrollText className="w-6 h-6 text-emerald-400" />
              <span>Log Aggregation (Loki-Compatible)</span>
            </h1>
            <p className="text-xs text-zinc-400 mt-0.5">
              Full-text search across structured logs + automatic 500ms pre-crash correlation inside every Crash Inspector drawer.
            </p>
          </div>
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
              <span>Emit Sample Structured Logs</span>
            </button>
          )}
        </div>

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
              placeholder="Full-text search across messages, labels, traceId..."
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
        </div>

        {/* Logs Stream */}
        <div className="rounded-2xl bg-zinc-900/90 border border-zinc-800 overflow-hidden">
          {loading && logs.length === 0 ? (
            <div className="p-8 text-center text-xs text-zinc-500">Searching structured logs...</div>
          ) : logs.length === 0 ? (
            <div className="p-8 text-center text-xs text-zinc-400">
              No structured logs matched. Push logs via Loki Push API or click &ldquo;Emit Sample Structured Logs&rdquo;.
            </div>
          ) : (
            <div className="divide-y divide-zinc-800/70 font-mono text-xs">
              {logs.map((l) => (
                <div key={l.id} className="px-4 py-2.5 flex items-start gap-3 hover:bg-zinc-950/70">
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
                  <span className="text-zinc-200 flex-1 break-all">{l.message}</span>
                  {l.traceId && (
                    <span className="text-[10px] text-indigo-300 shrink-0">
                      trace:{l.traceId.slice(0, 8)}
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </WorkspaceShell>
  );
}
