"use client";

import React from "react";
import { Radio, Tag, Clock, ShieldCheck, Package } from "lucide-react";
import type { DashboardData } from "../DragDropGrid";

interface ReleasePulseEntry {
  id: string;
  ecosystem: string;
  packageName: string;
  version: string;
  daysAgo: number | null;
  downloadsMonthly: number;
  accentClass: string;
}

export function ReleasePulseTimeline({ data }: { data: DashboardData }) {
  const entries: ReleasePulseEntry[] = [];

  if (data.project.npmPackage && data.npmStats) {
    entries.push({
      id: `npm:${data.project.npmPackage}`,
      ecosystem: "npm",
      packageName: data.project.npmPackage,
      version: data.npmStats.latestVersion || "latest",
      daysAgo: data.npmStats.daysSinceLastRelease ?? null,
      downloadsMonthly: data.npmStats.downloadsLastMonth || 0,
      accentClass: "bg-red-500/15 text-red-300 border-red-500/30",
    });
  }

  if (data.project.pypiPackage && data.pypiStats) {
    entries.push({
      id: `pypi:${data.project.pypiPackage}`,
      ecosystem: "PyPI",
      packageName: data.project.pypiPackage,
      version: data.pypiStats.latestVersion || "latest",
      daysAgo: null,
      downloadsMonthly: data.pypiStats.downloadsLastMonth || 0,
      accentClass: "bg-blue-500/15 text-blue-300 border-blue-500/30",
    });
  }

  if (data.project.rustCrate && data.rustStats) {
    entries.push({
      id: `crates:${data.project.rustCrate}`,
      ecosystem: "Crates.io",
      packageName: data.project.rustCrate,
      version: data.rustStats.maxVersion || "latest",
      daysAgo: null,
      downloadsMonthly: data.rustStats.recentDownloads || 0,
      accentClass: "bg-orange-500/15 text-orange-300 border-orange-500/30",
    });
  }

  if (data.project.goModule && data.goStats) {
    entries.push({
      id: `go:${data.project.goModule}`,
      ecosystem: "Go",
      packageName: data.project.goModule,
      version: data.goStats.latestVersion || "latest",
      daysAgo: null,
      downloadsMonthly: data.goStats.versionCount || 0,
      accentClass: "bg-teal-500/15 text-teal-300 border-teal-500/30",
    });
  }

  if (data.project.dockerImage && data.dockerStats) {
    entries.push({
      id: `docker:${data.project.dockerImage}`,
      ecosystem: "Docker Hub",
      packageName: data.project.dockerImage,
      version: "latest",
      daysAgo: null,
      downloadsMonthly: data.dockerStats.pullCount || 0,
      accentClass: "bg-cyan-500/15 text-cyan-300 border-cyan-500/30",
    });
  }

  if (data.project.vscodeExtension && data.vscodeStats) {
    entries.push({
      id: `vscode:${data.project.vscodeExtension}`,
      ecosystem: data.vscodeStats.openVsxInstalls > 0 ? "VS Code / Open VSX" : "VS Code",
      packageName: data.vscodeStats.extensionId,
      version: data.vscodeStats.version || "latest",
      daysAgo: null,
      downloadsMonthly: data.vscodeStats.installs || 0,
      accentClass: "bg-sky-500/15 text-sky-300 border-sky-500/30",
    });
  }

  for (const extra of data.extraPackages || []) {
    entries.push({
      id: `extra:${extra.provider}:${extra.identifier}`,
      ecosystem: extra.provider.toUpperCase(),
      packageName: extra.identifier,
      version: extra.latestVersion || "latest",
      daysAgo: null,
      downloadsMonthly: extra.metricValue || 0,
      accentClass: "bg-indigo-500/15 text-indigo-300 border-indigo-500/30",
    });
  }

  const sorted = [...entries].sort((a, b) => (a.daysAgo ?? 99) - (b.daysAgo ?? 99));
  const latestRelHealth = (data.releases || [])[0] || null;
  const ghTag = data.githubStats?.latestRelease?.tagName || null;
  const openPrs = data.githubStats?.openPrCount ?? 0;

  return (
    <section className="p-5 rounded-2xl bg-zinc-900/90 border border-zinc-800 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-bold text-white flex items-center gap-2">
            <Radio className="w-4 h-4 text-emerald-400" />
            <span>Cross-Registry &ldquo;Release Pulse&rdquo; Timeline</span>
          </h2>
          <p className="text-xs text-zinc-400">
            Correlates GitHub release tags, multi-registry publish parity, session adoption, crash-free rate, and active PRs
          </p>
        </div>
        <span className="text-[11px] font-mono px-2.5 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/25 text-emerald-300 tabular-nums">
          {sorted.length} Active Stream{sorted.length === 1 ? "" : "s"}
        </span>
      </div>

      {/* Correlated Release Pipeline Strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
        <div className="p-2.5 rounded-xl bg-zinc-950 border border-zinc-800">
          <div className="text-[10px] uppercase tracking-wider text-zinc-500">GitHub Release Tag</div>
          <div className="font-mono font-bold text-white mt-0.5 truncate">{ghTag || "Unlinked"}</div>
        </div>
        <div className="p-2.5 rounded-xl bg-zinc-950 border border-zinc-800">
          <div className="text-[10px] uppercase tracking-wider text-zinc-500">Latest Rollout Share</div>
          <div className="font-mono font-bold text-cyan-300 mt-0.5 tabular-nums">
            {latestRelHealth?.sessionSharePct != null ? `${latestRelHealth.sessionSharePct}%` : "N/A"}
          </div>
        </div>
        <div className="p-2.5 rounded-xl bg-zinc-950 border border-zinc-800">
          <div className="text-[10px] uppercase tracking-wider text-zinc-500">Crash-Free Sessions</div>
          <div className="font-mono font-bold text-emerald-300 mt-0.5 tabular-nums">
            {latestRelHealth?.crashFreeRate != null ? `${latestRelHealth.crashFreeRate}%` : "100%"}
          </div>
        </div>
        <div className="p-2.5 rounded-xl bg-zinc-950 border border-zinc-800">
          <div className="text-[10px] uppercase tracking-wider text-zinc-500">Suspect Open PRs</div>
          <div className="font-mono font-bold text-amber-300 mt-0.5 tabular-nums">{openPrs}</div>
        </div>
      </div>

      {sorted.length === 0 ? (
        <div className="p-6 rounded-xl bg-zinc-950/60 border border-zinc-800 text-center text-xs text-zinc-500">
          Connect npm, PyPI, Crates.io, Go, Docker Hub, VS Code, or Open VSX targets to track synchronized release cadence.
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {sorted.map((item) => (
            <div
              key={item.id}
              className="p-3.5 rounded-xl bg-zinc-950/80 border border-zinc-800 hover:border-zinc-700 transition flex flex-col justify-between gap-2"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <span
                    className={`inline-flex items-center gap-1 text-[10px] font-mono font-semibold px-2 py-0.5 rounded-full border ${item.accentClass}`}
                  >
                    <Package className="w-3 h-3" />
                    {item.ecosystem}
                  </span>
                  <div className="text-xs font-mono font-bold text-white truncate mt-1.5">
                    {item.packageName}
                  </div>
                </div>
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-zinc-900 border border-zinc-800 text-[11px] font-mono text-cyan-300 shrink-0">
                  <Tag className="w-3 h-3" />
                  {item.version}
                </span>
              </div>

              <div className="flex items-center justify-between text-[11px] text-zinc-400 pt-2 border-t border-zinc-800/70 tabular-nums">
                <span className="inline-flex items-center gap-1">
                  <Clock className="w-3 h-3 text-zinc-500" />
                  {item.daysAgo === null ? "Synced via API" : item.daysAgo === 0 ? "Released today" : `${item.daysAgo}d ago`}
                </span>
                <span className="inline-flex items-center gap-1 font-mono text-zinc-200" suppressHydrationWarning>
                  <ShieldCheck className="w-3 h-3 text-emerald-400" />
                  {item.downloadsMonthly.toLocaleString("en-US")}/mo
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
