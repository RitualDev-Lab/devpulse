"use client";

import React, { useState } from "react";
import { Globe, Users, Copy, Check, Smartphone, Monitor } from "lucide-react";
import { formatNumber } from "@/lib/utils/format";

export interface AnalyticsSummary {
  totalPageviews: number;
  uniqueReferrers: number;
  topReferrers: Array<{ referrer: string; count: number }>;
  topCountries: Array<{ country: string; count: number }>;
  devices: { desktop: number; mobile: number };
}

interface WebAnalyticsCardProps {
  summary: AnalyticsSummary | null;
  projectSlug: string;
}

export function WebAnalyticsCard({ summary, projectSlug }: WebAnalyticsCardProps) {
  const [copiedSnippet, setCopiedSnippet] = useState(false);

  const scriptSnippet = `<script defer src="https://devpulse.ritualdev.in/tracker.js" data-project="${projectSlug}"></script>`;

  const copyScript = () => {
    navigator.clipboard.writeText(scriptSnippet);
    setCopiedSnippet(true);
    setTimeout(() => setCopiedSnippet(false), 2000);
  };

  const total = summary?.totalPageviews || 0;
  const topRefs = summary?.topReferrers?.slice(0, 4) || [];
  const topCountries = summary?.topCountries?.slice(0, 4) || [];

  return (
    <div className="flex flex-col h-full justify-between p-5 rounded-2xl bg-zinc-900/90 border border-zinc-800/80 shadow-lg shadow-black/40 hover:border-zinc-700 transition">
      <div>
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-emerald-950/80 border border-emerald-800/60 flex items-center justify-center text-emerald-400">
              <Globe className="w-4 h-4" />
            </div>
            <div>
              <h3 className="font-semibold text-white text-base leading-tight">
                Cookie-Free Web Traffic
              </h3>
              <p className="text-xs text-zinc-400">Privacy-first docs & site analytics</p>
            </div>
          </div>
          <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-medium">
            100% GDPR
          </span>
        </div>

        {/* 2 Big Counters */}
        <div className="grid grid-cols-2 gap-2.5 mb-3.5">
          <div className="p-2.5 rounded-xl bg-zinc-950/60 border border-zinc-800/60">
            <span className="text-[10px] text-zinc-400 block mb-0.5">Total Pageviews</span>
            <div className="flex items-center gap-1.5 text-emerald-400 font-bold text-lg">
              <Users className="w-4 h-4 text-emerald-400/80" />
              <span>{formatNumber(total)}</span>
            </div>
          </div>

          <div className="p-2.5 rounded-xl bg-zinc-950/60 border border-zinc-800/60 flex items-center justify-between px-3">
            <div>
              <span className="text-[10px] text-zinc-400 block mb-0.5">Desktop</span>
              <div className="flex items-center gap-1 text-xs font-semibold text-zinc-200">
                <Monitor className="w-3.5 h-3.5 text-zinc-400" />
                <span>{summary?.devices?.desktop || 0}</span>
              </div>
            </div>
            <div className="border-l border-zinc-800 pl-3">
              <span className="text-[10px] text-zinc-400 block mb-0.5">Mobile</span>
              <div className="flex items-center gap-1 text-xs font-semibold text-zinc-200">
                <Smartphone className="w-3.5 h-3.5 text-zinc-400" />
                <span>{summary?.devices?.mobile || 0}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Top Referrers & Top Countries Grid */}
        <div className="grid grid-cols-2 gap-2 text-xs mb-3.5">
          <div className="p-2.5 rounded-xl bg-zinc-950/60 border border-zinc-800/60">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400 block mb-1.5">
              Top Referrers
            </span>
            {topRefs.length === 0 ? (
              <span className="text-[11px] text-zinc-500">Waiting for visitors...</span>
            ) : (
              <div className="space-y-1">
                {topRefs.map((r) => (
                  <div key={r.referrer} className="flex items-center justify-between text-[11px]">
                    <span className="text-zinc-300 truncate max-w-[100px]">{r.referrer}</span>
                    <span className="text-zinc-400 font-mono font-medium">{r.count}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="p-2.5 rounded-xl bg-zinc-950/60 border border-zinc-800/60">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400 block mb-1.5">
              Top Regions
            </span>
            {topCountries.length === 0 ? (
              <span className="text-[11px] text-zinc-500">Waiting for traffic...</span>
            ) : (
              <div className="space-y-1">
                {topCountries.map((c) => (
                  <div key={c.country} className="flex items-center justify-between text-[11px]">
                    <span className="text-zinc-300 font-semibold">{c.country}</span>
                    <span className="text-zinc-400 font-mono font-medium">{c.count}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Embed Script Snippet */}
        <div className="p-2.5 rounded-xl bg-zinc-950/80 border border-zinc-800/80">
          <div className="flex items-center justify-between text-[10px] text-zinc-400 mb-1">
            <span>Embed on your documentation site:</span>
            <button
              onClick={copyScript}
              className="flex items-center gap-1 text-[10px] text-emerald-400 hover:text-emerald-300 transition"
            >
              {copiedSnippet ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
              <span>{copiedSnippet ? "Copied" : "Copy Tag"}</span>
            </button>
          </div>
          <code className="text-[10px] font-mono text-zinc-300 block truncate">
            {scriptSnippet}
          </code>
        </div>
      </div>

      <div className="mt-3 pt-2 flex items-center justify-between text-[11px] text-zinc-500 border-t border-zinc-800/40">
        <span>Zero cookies &bull; No consent banner needed</span>
        <span className="text-emerald-400 font-medium">Ready</span>
      </div>
    </div>
  );
}
