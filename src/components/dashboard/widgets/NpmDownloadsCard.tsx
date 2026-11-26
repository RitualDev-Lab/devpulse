import React from "react";
import { Download, TrendingUp, ExternalLink, ShieldCheck, GitCommit, Box } from "lucide-react";
import type { NpmStats } from "@/lib/integrations/npm";
import type { DepsDevAdvisorySummary } from "@/lib/integrations/deps-dev";
import { PackageSecurityBadge } from "./PackageSecurityBadge";
import { formatNumber } from "@/lib/utils/format";

interface NpmDownloadsCardProps {
  stats: NpmStats | null;
  packageName: string;
  security?: DepsDevAdvisorySummary | null;
}

export function NpmDownloadsCard({ stats, packageName, security }: NpmDownloadsCardProps) {
  if (!stats) {
    return (
      <div className="p-5 rounded-2xl bg-zinc-900/80 border border-zinc-800 text-zinc-400">
        <div className="flex items-center justify-between mb-3">
          <span className="font-semibold text-zinc-200">npm Package</span>
          <span className="text-xs px-2 py-0.5 rounded bg-zinc-800 text-zinc-400">Offline</span>
        </div>
        <p className="text-sm">Unable to load stats for {packageName}.</p>
      </div>
    );
  }

  // Generate lightweight SVG path for 30-day download sparkline
  const history = stats.dailyHistory || [];
  const maxDownload = history.length > 0 ? Math.max(...history.map((h) => h.downloads), 10) : 100;
  const width = 360;
  const height = 90;

  const points = history.map((pt, idx) => {
    const x = (idx / Math.max(history.length - 1, 1)) * width;
    const y = height - (pt.downloads / maxDownload) * (height - 15) - 8;
    return `${x},${y}`;
  });

  const svgPath = points.length > 1 ? `M ${points.join(" L ")}` : "";
  const areaPath =
    points.length > 1 ? `M 0,${height} L ${points.join(" L ")} L ${width},${height} Z` : "";

  return (
    <div className="flex flex-col h-full justify-between p-5 rounded-2xl bg-zinc-900/90 border border-zinc-800/80 shadow-lg shadow-black/40 hover:border-zinc-700 transition">
      <div>
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-red-950/80 border border-red-800/60 flex items-center justify-center text-red-400 font-bold text-xs tracking-tighter">
              npm
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-semibold text-white text-base leading-tight">{stats.packageName}</h3>
                {stats.latestVersion && (
                  <span className="text-[11px] text-red-400/90 font-mono">v{stats.latestVersion}</span>
                )}
              </div>
              <p className="text-xs text-zinc-400 truncate max-w-[200px]">
                {stats.description || "Node / npm / Bun Package"}
              </p>
            </div>
          </div>
          <a
            href={`https://www.npmjs.com/package/${encodeURIComponent(stats.packageName)}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-zinc-400 hover:text-white transition p-1.5 rounded-lg hover:bg-zinc-800"
            title="View on npm"
          >
            <ExternalLink className="w-4 h-4" />
          </a>
        </div>

        {/* 3 Metric Stats */}
        <div className="grid grid-cols-3 gap-2.5 mb-3.5">
          <div className="p-2.5 rounded-xl bg-zinc-950/60 border border-zinc-800/60">
            <span className="text-[10px] text-zinc-400 block mb-0.5">Today</span>
            <div className="flex items-center gap-1">
              <span className="text-sm font-bold text-white">
                {formatNumber(stats.downloadsLastDay)}
              </span>
            </div>
          </div>

          <div className="p-2.5 rounded-xl bg-zinc-950/60 border border-zinc-800/60">
            <span className="text-[10px] text-zinc-400 block mb-0.5">This Week</span>
            <div className="flex items-center gap-1">
              <span className="text-sm font-bold text-white">
                {formatNumber(stats.downloadsLastWeek)}
              </span>
            </div>
          </div>

          <div className="p-2.5 rounded-xl bg-zinc-950/60 border border-zinc-800/60">
            <span className="text-[10px] text-zinc-400 block mb-0.5">This Month</span>
            <div className="flex items-center gap-1">
              <span className="text-sm font-bold text-red-400">
                {formatNumber(stats.downloadsLastMonth)}
              </span>
            </div>
          </div>
        </div>

        {/* Release Cadence & License Badges */}
        <div className="flex flex-wrap items-center gap-2 mb-3 text-xs">
          {stats.license && (
            <span className="flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-md bg-zinc-950 border border-zinc-800 text-zinc-300 font-mono">
              <ShieldCheck className="w-3 h-3 text-emerald-400" />
              <span>{stats.license}</span>
            </span>
          )}

          {stats.totalReleases > 0 && (
            <span className="flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-md bg-zinc-950 border border-zinc-800 text-zinc-400">
              <GitCommit className="w-3 h-3 text-red-400" />
              <span>{stats.totalReleases} releases</span>
              {stats.daysSinceLastRelease !== undefined && stats.daysSinceLastRelease > 0 && (
                <span className="text-zinc-500">({stats.daysSinceLastRelease}d ago)</span>
              )}
            </span>
          )}

          {stats.dependenciesCount !== undefined && (
            <span className="flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-md bg-zinc-950 border border-zinc-800 text-zinc-400">
              <Box className="w-3 h-3 text-cyan-400" />
              <span>{stats.dependenciesCount} deps</span>
            </span>
          )}
        </div>
        {security && (
          <div className="mb-3">
            <PackageSecurityBadge summary={security} />
          </div>
        )}

        {/* Sparkline Chart */}
        <div className="mt-2">
          <div className="flex items-center justify-between text-[11px] text-zinc-400 mb-1.5">
            <span className="flex items-center gap-1 text-zinc-300">
              <TrendingUp className="w-3.5 h-3.5 text-red-400" /> 30-Day Download Velocity
            </span>
            <span>Peak: {formatNumber(maxDownload)}</span>
          </div>

          <div className="w-full h-20 rounded-xl bg-zinc-950/70 border border-zinc-800/70 p-2 overflow-hidden relative">
            <svg
              viewBox={`0 0 ${width} ${height}`}
              className="w-full h-full overflow-visible"
              preserveAspectRatio="none"
            >
              <defs>
                <linearGradient id="npmGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#ef4444" stopOpacity="0.35" />
                  <stop offset="100%" stopColor="#ef4444" stopOpacity="0.0" />
                </linearGradient>
              </defs>
              {areaPath && <path d={areaPath} fill="url(#npmGradient)" />}
              {svgPath && (
                <path
                  d={svgPath}
                  fill="none"
                  stroke="#ef4444"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              )}
            </svg>
          </div>
        </div>
      </div>

      <div className="mt-3 pt-2 flex items-center justify-between text-[11px] text-zinc-500 border-t border-zinc-800/40">
        <span>Public Registry API</span>
        <span className="text-emerald-400 font-medium flex items-center gap-1">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 inline-block animate-pulse"></span>
          Live Sync
        </span>
      </div>
    </div>
  );
}
