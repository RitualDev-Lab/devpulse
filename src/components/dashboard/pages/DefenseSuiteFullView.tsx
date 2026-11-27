"use client";

import React, { useState, useEffect, useCallback } from "react";
import {
  ShieldCheck,
  ShieldAlert,
  RefreshCw,
  Bot,
  Database,
  Sparkles,
  GlobeLock,
  Layers,
  Copy,
  Check,
  Radio,
} from "lucide-react";
import type { LoadedWorkspaceReady } from "@/lib/dashboard/load-workspace";
import { WorkspaceShell } from "../WorkspaceShell";
import { PUBLIC_APP_URL } from "@/lib/config/app-url";

interface DefenseEngineCard {
  id: string;
  name: string;
  status: string;
  blocked24h: number;
  ruleVersion: string;
  detail: string;
}

interface DefenseEventItem {
  id: string;
  engine: string;
  severity: string;
  ruleId: string;
  summary: string;
  status: string;
  createdAt: string;
}

const ENGINE_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  agentshield: Bot,
  dbshield: Database,
  skillprism: Layers,
  promptshield: ShieldAlert,
  "web-sec-auditor": GlobeLock,
};

export function DefenseSuiteFullView({ workspace }: { workspace: LoadedWorkspaceReady }) {
  const { initialData, projects, customDomain, storageTier, isDemo } = workspace;
  const project = initialData.project;
  const [engines, setEngines] = useState<DefenseEngineCard[]>([]);
  const [events, setEvents] = useState<DefenseEventItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [copiedCurl, setCopiedCurl] = useState(false);

  const loadDefense = useCallback(async () => {
    setLoading(true);
    try {
      const qs = isDemo
        ? `projectId=demo&demo=1`
        : `projectId=${encodeURIComponent(project.id)}`;
      const res = await fetch(`/api/v1/defense?${qs}`);
      if (res.ok) {
        const json = await res.json();
        setEngines(json.engines || []);
        setEvents(json.events || []);
      }
    } finally {
      setLoading(false);
    }
  }, [isDemo, project.id]);

  useEffect(() => {
    void loadDefense();
  }, [loadDefense]);

  const curlSnippet = `curl -X POST ${PUBLIC_APP_URL}/api/v1/defense \\
  -H "Authorization: Bearer YOUR_DEVPULSE_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"engine":"agentshield","severity":"HIGH","ruleId":"AGS-MCP-004","summary":"Blocked unapproved MCP filesystem write"}'`;

  return (
    <WorkspaceShell
      currentProject={project}
      projects={projects}
      storageTier={storageTier}
      customDomain={customDomain}
      isDemo={isDemo}
    >
      <div className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-extrabold text-white flex items-center gap-2.5">
              <ShieldCheck className="w-6 h-6 text-emerald-400" />
              <span>RitualDev Defense Suite Control Plane</span>
            </h1>
            <p className="text-xs text-zinc-400 mt-0.5">
              Unified runtime telemetry &amp; policy enforcement across AgentShield, DBShield, SkillPrism, PromptShield, web-sec-auditor, and Open VSX.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void loadDefense()}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-xs font-semibold text-white transition"
          >
            <RefreshCw className={`w-3.5 h-3.5 text-emerald-400 ${loading ? "animate-spin" : ""}`} />
            <span>Refresh Posture</span>
          </button>
        </div>

        {/* 5 Defense Engines */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-3">
          {engines.map((eng) => {
            const Icon = ENGINE_ICONS[eng.id] || ShieldCheck;
            return (
              <div
                key={eng.id}
                className="p-4 rounded-2xl bg-zinc-900/90 border border-zinc-800 space-y-2 flex flex-col justify-between"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="inline-flex items-center gap-1.5 text-xs font-bold text-white">
                    <Icon className="w-4 h-4 text-emerald-400" />
                    {eng.name}
                  </span>
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-emerald-500/15 border border-emerald-500/30 text-emerald-300">
                    v{eng.ruleVersion}
                  </span>
                </div>
                <div className="text-2xl font-extrabold text-white tabular-nums">
                  {eng.blocked24h}
                  <span className="text-[11px] font-normal text-zinc-400 ml-1">events</span>
                </div>
                <p className="text-[11px] text-zinc-400 leading-relaxed">{eng.detail}</p>
              </div>
            );
          })}
        </div>

        {/* Open VSX & Zero-PII Adoption Gateway Summary */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="p-5 rounded-2xl bg-zinc-900/90 border border-zinc-800 space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-bold text-white flex items-center gap-2">
                <Radio className="w-4 h-4 text-cyan-400" />
                <span>Zero-PII Adoption Gateway (Scarf Alternative)</span>
              </h2>
              <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-cyan-500/15 border border-cyan-500/30 text-cyan-300">
                HMAC-Monthly Anon
              </span>
            </div>
            <p className="text-xs text-zinc-400 leading-relaxed">
              Route download links or container artifact badges through your project gateway endpoint to measure adoption velocity without persisting raw IP addresses or cookies.
            </p>
            <div className="p-3 rounded-xl bg-zinc-950 border border-zinc-800 font-mono text-[11px] text-cyan-300 overflow-x-auto">
              {PUBLIC_APP_URL}/api/v1/gateway/{project.slug}?target=npm&amp;ver=1.0.0
            </div>
          </div>

          <div className="p-5 rounded-2xl bg-zinc-900/90 border border-zinc-800 space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-bold text-white flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-purple-400" />
                <span>Report Findings via Defense Ingest API</span>
              </h2>
              <button
                type="button"
                onClick={() => {
                  navigator.clipboard?.writeText(curlSnippet);
                  setCopiedCurl(true);
                  setTimeout(() => setCopiedCurl(false), 1800);
                }}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-zinc-950 border border-zinc-800 text-[11px] text-zinc-300 hover:text-white"
              >
                {copiedCurl ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                <span>{copiedCurl ? "Copied" : "Copy cURL"}</span>
              </button>
            </div>
            <pre className="p-3 rounded-xl bg-zinc-950 border border-zinc-800 font-mono text-[11px] text-zinc-300 overflow-x-auto leading-relaxed">
              {curlSnippet}
            </pre>
            <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-zinc-800/80 text-[11px] text-zinc-400">
              <span>
                Open VSX / VS Code:{" "}
                <strong className="font-mono text-zinc-200">
                  {initialData.vscodeStats
                    ? `${initialData.vscodeStats.extensionId} (${initialData.vscodeStats.openVsxInstalls.toLocaleString("en-US")} Open VSX)`
                    : "ritualdev-lab namespace tracked"}
                </strong>
              </span>
              <span className="font-mono px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-300 border border-emerald-500/25">
                SARIF v2.1.0 Ready
              </span>
            </div>
          </div>
        </div>

        {/* Live Defense Event Stream */}
        <div className="rounded-2xl bg-zinc-900/90 border border-zinc-800 overflow-hidden">
          <div className="p-4 border-b border-zinc-800 flex items-center justify-between">
            <h2 className="text-sm font-bold text-white">Recent Guardrail &amp; Policy Enforcements</h2>
            <span className="text-xs font-mono text-zinc-400 tabular-nums">{events.length} events</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-zinc-950/70 text-zinc-400 border-b border-zinc-800">
                <tr>
                  <th className="px-4 py-2.5">Engine</th>
                  <th className="px-4 py-2.5">Rule ID</th>
                  <th className="px-4 py-2.5">Severity</th>
                  <th className="px-4 py-2.5">Action</th>
                  <th className="px-4 py-2.5">Summary</th>
                  <th className="px-4 py-2.5">Timestamp</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800/60">
                {events.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-6 text-center text-zinc-500">
                      No defense findings logged yet. Send events from AgentShield, DBShield, or PromptShield above.
                    </td>
                  </tr>
                ) : (
                  events.map((ev) => (
                    <tr key={ev.id} className="hover:bg-zinc-950/50">
                      <td className="px-4 py-2.5 font-mono text-white font-semibold">{ev.engine}</td>
                      <td className="px-4 py-2.5 font-mono text-cyan-300">{ev.ruleId}</td>
                      <td className="px-4 py-2.5">
                        <span
                          className={`text-[10px] font-mono px-2 py-0.5 rounded-full border ${
                            ev.severity === "CRITICAL"
                              ? "bg-red-500/15 text-red-300 border-red-500/30"
                              : ev.severity === "HIGH"
                              ? "bg-amber-500/15 text-amber-300 border-amber-500/30"
                              : "bg-indigo-500/15 text-indigo-300 border-indigo-500/30"
                          }`}
                        >
                          {ev.severity}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 font-mono text-emerald-300">{ev.status}</td>
                      <td className="px-4 py-2.5 text-zinc-300">{ev.summary}</td>
                      <td className="px-4 py-2.5 font-mono text-zinc-400 tabular-nums">{ev.createdAt}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </WorkspaceShell>
  );
}
