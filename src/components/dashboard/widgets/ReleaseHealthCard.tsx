"use client";

import React, { useState } from "react";
import { GitCommit, Rocket, Check, Copy, ShieldCheck, AlertTriangle } from "lucide-react";
import { PUBLIC_APP_URL } from "@/lib/config/app-url";

export interface ReleaseHealthItem {
  id: string;
  version: string;
  commitSha?: string | null;
  commitAuthor?: string | null;
  commitMessage?: string | null;
  branch?: string | null;
  source: string;
  totalSessions: number;
  /** Share of sessions across the releases listed; null when no sessions are recorded. */
  sessionSharePct?: number | null;
  crashCount: number;
  crashFreeRate: number | null;
  releasedAt: string;
}

interface ReleaseHealthCardProps {
  releases: ReleaseHealthItem[];
  githubRepo?: string | null;
}

export function ReleaseHealthCard({ releases, githubRepo }: ReleaseHealthCardProps) {
  const [copiedWebhook, setCopiedWebhook] = useState(false);
  const webhookUrl = `${PUBLIC_APP_URL}/api/v1/webhooks/github`;

  const copyWebhook = () => {
    navigator.clipboard.writeText(webhookUrl);
    setCopiedWebhook(true);
    setTimeout(() => setCopiedWebhook(false), 1800);
  };

  return (
    <div className="flex flex-col h-full justify-between p-5 rounded-2xl bg-zinc-900/90 border border-zinc-800/80 shadow-lg shadow-black/40 transition">
      <div>
        <div className="flex items-center justify-between gap-2 mb-3">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-indigo-950/80 border border-indigo-800/60 flex items-center justify-center text-indigo-400">
              <Rocket className="w-4 h-4" />
            </div>
            <div>
              <h3 className="font-semibold text-white text-base leading-tight">
                Release Health &amp; Regressions
              </h3>
              <p className="text-xs text-zinc-400">
                Crash-free rate &amp; GitHub commit attribution
              </p>
            </div>
          </div>
          <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-indigo-500/15 text-indigo-300 border border-indigo-500/30">
            {releases.length} releases
          </span>
        </div>

        {releases.length === 0 ? (
          <div className="p-4 rounded-xl bg-zinc-950/60 border border-zinc-800/60 space-y-2 text-xs">
            <p className="text-zinc-300 font-medium">
              No releases tracked yet
            </p>
            <p className="text-[11px] text-zinc-500 leading-relaxed">
              Pass <code className="text-zinc-300">release: &quot;v1.0.0&quot;</code> in{" "}
              <code className="text-indigo-300">@ritualdev/devpulse</code> or connect a GitHub
              webhook (<code className="text-zinc-300">push</code> /{" "}
              <code className="text-zinc-300">release</code>) to pinpoint regression commits.
            </p>
            <div className="flex items-center justify-between gap-2 p-2 rounded-lg bg-zinc-900 border border-zinc-800 text-[10px] font-mono text-zinc-400">
              <span className="truncate">{webhookUrl}</span>
              <button
                type="button"
                onClick={copyWebhook}
                className="shrink-0 flex items-center gap-1 px-2 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-200"
              >
                {copiedWebhook ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                <span>{copiedWebhook ? "Copied" : "Copy URL"}</span>
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-2 max-h-[220px] overflow-y-auto pr-1">
            {releases.map((rel) => {
              const healthy = rel.crashFreeRate !== null && rel.crashFreeRate >= 98;
              return (
                <div
                  key={rel.id}
                  className="p-3 rounded-xl bg-zinc-950/80 border border-zinc-800 flex items-center justify-between gap-3 text-xs"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-mono font-bold text-white">{rel.version}</span>
                      {rel.commitSha && (
                        <span className="inline-flex items-center gap-1 text-[10px] font-mono px-1.5 py-0.5 rounded bg-zinc-900 border border-zinc-800 text-cyan-300">
                          <GitCommit className="w-2.5 h-2.5" />
                          {rel.commitSha.slice(0, 7)}
                        </span>
                      )}
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400">
                        {rel.source.replace("github_", "gh:")}
                      </span>
                    </div>
                    {rel.commitMessage && (
                      <p className="text-[11px] text-zinc-400 truncate mt-0.5">
                        {rel.commitMessage}
                      </p>
                    )}
                  </div>

                  <div className="shrink-0 text-right">
                    <div
                      className={`inline-flex items-center gap-1 font-bold font-mono text-xs ${
                        healthy ? "text-emerald-400" : "text-amber-400"
                      }`}
                    >
                      {healthy ? (
                        <ShieldCheck className="w-3.5 h-3.5" />
                      ) : (
                        <AlertTriangle className="w-3.5 h-3.5" />
                      )}
                      <span>{rel.crashFreeRate === null ? "No session data" : `${rel.crashFreeRate}%`}</span>
                    </div>
                    <div className="text-[10px] text-zinc-500">
                      {rel.crashCount} crashes / {Math.max(rel.totalSessions, rel.crashCount)} sess
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="mt-3 pt-2 flex items-center justify-between text-[11px] text-zinc-500 border-t border-zinc-800/40">
        <span>{githubRepo ? `Webhook: ${githubRepo}` : "SDK + GitHub Release Sync"}</span>
        <button
          type="button"
          onClick={copyWebhook}
          className="text-indigo-400 hover:text-indigo-300 font-medium transition"
        >
          {copiedWebhook ? "Webhook URL Copied" : "Copy Webhook"}
        </button>
      </div>
    </div>
  );
}
