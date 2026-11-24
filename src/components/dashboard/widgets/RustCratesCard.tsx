"use client";

import React from "react";
import { Download, ExternalLink, Box, Tag, BookOpen, Layers, GitFork, TrendingUp } from "lucide-react";
import type { RustCrateStats } from "@/lib/integrations/crates";
import { formatNumber } from "@/lib/utils/format";

interface RustCratesCardProps {
  stats: RustCrateStats | null;
  crateName: string;
}

export function RustCratesCard({ stats, crateName }: RustCratesCardProps) {
  if (!stats) {
    return (
      <div className="flex flex-col h-full justify-between p-5 rounded-2xl bg-zinc-900/90 border border-zinc-800/80 shadow-lg shadow-black/40">
        <div>
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-orange-950/80 border border-orange-800/60 flex items-center justify-center text-orange-400">
                <Box className="w-4 h-4" />
              </div>
              <div>
                <h3 className="font-semibold text-white text-base leading-tight">Rust Crate</h3>
                <p className="text-xs text-zinc-400 font-mono">{crateName}</p>
              </div>
            </div>
            <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-zinc-800 text-zinc-400 border border-zinc-700">
              Offline
            </span>
          </div>
          <div className="py-8 text-center text-zinc-500">
            <p className="text-xs">No public crate data found for &quot;{crateName}&quot; on crates.io.</p>
          </div>
        </div>
      </div>
    );
  }

  const maxDaily = Math.max(...(stats.dailyHistory?.map((d) => d.downloads) || [1]), 1);

  return (
    <div className="flex flex-col h-full justify-between p-5 rounded-2xl bg-zinc-900/90 border border-zinc-800/80 shadow-lg shadow-black/40 hover:border-zinc-700 transition">
      <div>
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-orange-950/80 border border-orange-800/60 flex items-center justify-center text-orange-400">
              <Box className="w-4 h-4" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-semibold text-white text-base leading-tight">{stats.crateName}</h3>
                <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-orange-500/10 text-orange-400 border border-orange-500/20">
                  crates.io
                </span>
              </div>
              <p className="text-xs text-zinc-400 font-mono truncate max-w-[200px]">
                {stats.description || "Rust Package / Library"}
              </p>
            </div>
          </div>
          <a
            href={`https://crates.io/crates/${stats.crateName}`}
            target="_blank"
            rel="noreferrer"
            className="text-zinc-500 hover:text-orange-400 p-1.5 rounded-lg hover:bg-zinc-800 transition"
            title="View on crates.io"
          >
            <ExternalLink className="w-4 h-4" />
          </a>
        </div>

        {/* 3 Metrics Grid: Total, 90-day, Reverse Dependencies */}
        <div className="grid grid-cols-3 gap-2.5 mb-3.5">
          <div className="p-3 rounded-xl bg-zinc-950/70 border border-zinc-800/80">
            <div className="flex items-center gap-1 text-zinc-400 text-[10px] mb-0.5">
              <Download className="w-3 h-3 text-orange-400" />
              <span>Total DLs</span>
            </div>
            <p className="text-base font-bold text-white tracking-tight">
              {formatNumber(stats.totalDownloads)}
            </p>
          </div>

          <div className="p-3 rounded-xl bg-zinc-950/70 border border-zinc-800/80">
            <div className="flex items-center gap-1 text-zinc-400 text-[10px] mb-0.5">
              <Layers className="w-3 h-3 text-amber-400" />
              <span>90d Velocity</span>
            </div>
            <p className="text-base font-bold text-white tracking-tight">
              {formatNumber(stats.recentDownloads)}
            </p>
          </div>

          <div className="p-3 rounded-xl bg-zinc-950/70 border border-zinc-800/80">
            <div className="flex items-center gap-1 text-zinc-400 text-[10px] mb-0.5" title="Crates that depend on this crate">
              <GitFork className="w-3 h-3 text-cyan-400" />
              <span>Dep Health</span>
            </div>
            <p className="text-base font-bold text-cyan-400 tracking-tight" title={`${formatNumber(stats.reverseDependencies)} reverse dependencies`}>
              {formatNumber(stats.reverseDependencies)}
            </p>
          </div>
        </div>

        {/* 30-Day Daily Velocity Sparkline if available */}
        {stats.dailyHistory && stats.dailyHistory.length > 0 && (
          <div className="mb-3.5">
            <div className="flex items-center justify-between text-[11px] text-zinc-400 mb-1.5">
              <span className="flex items-center gap-1">
                <TrendingUp className="w-3 h-3 text-orange-400" />
                <span>30-Day Inflow Trends</span>
              </span>
              <span className="text-[10px] text-zinc-500 font-mono">
                Peak: {formatNumber(maxDaily)}/day
              </span>
            </div>
            <div className="flex items-end gap-1 h-12 w-full pt-1 px-1 bg-zinc-950/60 rounded-xl border border-zinc-800/60">
              {stats.dailyHistory.map((d, i) => {
                const heightPercent = Math.max(8, Math.round((d.downloads / maxDaily) * 100));
                return (
                  <div
                    key={d.date || i}
                    className="flex-1 bg-gradient-to-t from-orange-500/30 to-orange-400/80 hover:to-orange-300 rounded-t-sm transition-all"
                    style={{ height: `${heightPercent}%` }}
                    title={`${d.date}: ${formatNumber(d.downloads)} downloads`}
                  />
                );
              })}
            </div>
          </div>
        )}

        {/* Crate Meta Badges */}
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-zinc-950 border border-zinc-800 text-zinc-300">
            <Tag className="w-3 h-3 text-orange-400" />
            <span className="font-mono text-[11px]">v{stats.maxVersion}</span>
          </div>

          {stats.documentation && (
            <a
              href={stats.documentation}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-zinc-950 border border-zinc-800 text-zinc-400 hover:text-white transition"
            >
              <BookOpen className="w-3 h-3 text-cyan-400" />
              <span className="text-[11px]">docs.rs</span>
            </a>
          )}

          {stats.reverseDependencies > 0 && (
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-cyan-500/10 text-cyan-400 border border-cyan-500/20">
              Used by {formatNumber(stats.reverseDependencies)} crates
            </span>
          )}
        </div>
      </div>

      {/* Footer */}
      <div className="mt-4 pt-3 border-t border-zinc-800/80 flex items-center justify-between text-[11px] text-zinc-500">
        <span>crates.io Public API</span>
        <span className="flex items-center gap-1 text-emerald-400">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
          Live Synced
        </span>
      </div>
    </div>
  );
}
