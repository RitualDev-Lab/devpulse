import React from "react";
import { TrendingUp, ExternalLink, GitCommit, Layers, Terminal } from "lucide-react";
import type { PyPiStats } from "@/lib/integrations/pypi";
import { formatNumber } from "@/lib/utils/format";

interface PyPiDownloadsCardProps {
  stats: PyPiStats | null;
  packageName: string;
}

export function PyPiDownloadsCard({ stats, packageName }: PyPiDownloadsCardProps) {
  if (!stats) {
    return (
      <div className="p-5 rounded-2xl bg-zinc-900/80 border border-zinc-800 text-zinc-400">
        <div className="flex items-center justify-between mb-3">
          <span className="font-semibold text-zinc-200">PyPI Package</span>
          <span className="text-xs px-2 py-0.5 rounded bg-zinc-800 text-zinc-400">Offline</span>
        </div>
        <p className="text-sm">Unable to load PyPI stats for {packageName}.</p>
      </div>
    );
  }

  const history = stats.dailyHistory || [];
  const maxDownload = history.length > 0 ? Math.max(...history.map((h) => h.downloads), 10) : 100;
  const width = 360;
  const height = 80;

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
            <div className="w-8 h-8 rounded-lg bg-blue-950/80 border border-blue-800/60 flex items-center justify-center text-blue-400 font-bold text-xs tracking-tight">
              PyPI
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-semibold text-white text-base leading-tight">{stats.packageName}</h3>
                {stats.latestVersion && (
                  <span className="text-[11px] text-blue-400/90 font-mono">v{stats.latestVersion}</span>
                )}
              </div>
              <p className="text-xs text-zinc-400 truncate max-w-[200px]">
                {stats.description || "Python Package"}
              </p>
            </div>
          </div>
          <a
            href={`https://pypi.org/project/${encodeURIComponent(stats.packageName)}/`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-zinc-400 hover:text-white transition p-1.5 rounded-lg hover:bg-zinc-800"
            title="View on PyPI"
          >
            <ExternalLink className="w-4 h-4" />
          </a>
        </div>

        {/* 3 Metric Stats */}
        <div className="grid grid-cols-3 gap-2.5 mb-3.5">
          <div className="p-2.5 rounded-xl bg-zinc-950/60 border border-zinc-800/60">
            <span className="text-[10px] text-zinc-400 block mb-0.5">Last Day</span>
            <div className="flex items-center gap-1">
              <span className="text-sm font-bold text-white">
                {formatNumber(stats.downloadsLastDay)}
              </span>
            </div>
          </div>

          <div className="p-2.5 rounded-xl bg-zinc-950/60 border border-zinc-800/60">
            <span className="text-[10px] text-zinc-400 block mb-0.5">Last 7 Days</span>
            <div className="flex items-center gap-1">
              <span className="text-sm font-bold text-white">
                {formatNumber(stats.downloadsLastWeek)}
              </span>
            </div>
          </div>

          <div className="p-2.5 rounded-xl bg-zinc-950/60 border border-zinc-800/60">
            <span className="text-[10px] text-zinc-400 block mb-0.5">Last 30 Days</span>
            <div className="flex items-center gap-1">
              <span className="text-sm font-bold text-blue-400">
                {formatNumber(stats.downloadsLastMonth)}
              </span>
            </div>
          </div>
        </div>

        {/* Python Version Breakdown & Releases */}
        <div className="flex flex-wrap items-center gap-2 mb-3 text-xs">
          {stats.totalReleases > 0 && (
            <span className="flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-md bg-zinc-950 border border-zinc-800 text-zinc-400 font-mono">
              <GitCommit className="w-3 h-3 text-blue-400" />
              <span>{stats.totalReleases} releases</span>
            </span>
          )}

          {stats.pythonVersions && stats.pythonVersions.length > 0 && (
            <div className="flex items-center gap-1 flex-wrap">
              <span className="text-[10px] text-zinc-500">Python:</span>
              {stats.pythonVersions.slice(0, 3).map((v) => (
                <span
                  key={v.version}
                  className="text-[10px] px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-300 border border-blue-500/20 font-mono"
                  title={`${v.version}: ${formatNumber(v.downloads)} downloads (${v.percentage}%)`}
                >
                  {v.version} ({v.percentage}%)
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Sparkline Chart */}
        <div className="mt-1">
          <div className="flex items-center justify-between text-[11px] text-zinc-400 mb-1.5">
            <span className="flex items-center gap-1 text-zinc-300">
              <TrendingUp className="w-3.5 h-3.5 text-blue-400" /> Non-Mirror Installs
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
                <linearGradient id="pypiGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#3b82f6" stopOpacity="0.35" />
                  <stop offset="100%" stopColor="#3b82f6" stopOpacity="0.0" />
                </linearGradient>
              </defs>
              {areaPath && <path d={areaPath} fill="url(#pypiGradient)" />}
              {svgPath && (
                <path
                  d={svgPath}
                  fill="none"
                  stroke="#3b82f6"
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
        <span>pypistats.org Non-Mirror API</span>
        <span className="text-emerald-400 font-medium flex items-center gap-1">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 inline-block animate-pulse"></span>
          Live Sync
        </span>
      </div>
    </div>
  );
}
