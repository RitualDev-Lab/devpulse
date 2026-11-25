import React from "react";
import { Box, Tag, ExternalLink, Clock, Layers } from "lucide-react";
import type { GoModuleStats } from "@/lib/integrations/go";
import { formatDate } from "@/lib/utils/format";

interface GoModuleCardProps {
  stats: GoModuleStats | null;
  modulePath: string;
}

export function GoModuleCard({ stats, modulePath }: GoModuleCardProps) {
  if (!stats) {
    return (
      <div className="flex flex-col h-full justify-between p-5 rounded-2xl bg-zinc-900/80 border border-zinc-800 text-zinc-400">
        <div className="flex items-center justify-between mb-3">
          <span className="font-semibold text-zinc-200">Go Module</span>
          <span className="text-xs px-2 py-0.5 rounded bg-zinc-800 text-zinc-400">Offline</span>
        </div>
        <p className="text-sm">
          Unable to locate <code className="text-cyan-400">{modulePath}</code> on proxy.golang.org.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full justify-between p-5 rounded-2xl bg-zinc-900/90 border border-zinc-800/80 shadow-lg shadow-black/40 hover:border-zinc-700 transition">
      <div>
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-8 h-8 rounded-lg bg-cyan-950/80 border border-cyan-800/60 flex items-center justify-center text-cyan-400 shrink-0">
              <Box className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <h3 className="font-semibold text-white text-base leading-tight truncate">
                Go Module Registry
              </h3>
              <p className="text-xs text-zinc-400 font-mono truncate">{stats.modulePath}</p>
            </div>
          </div>
          <a
            href={stats.pkgGoDevUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-zinc-400 hover:text-white transition p-1.5 rounded-lg hover:bg-zinc-800 shrink-0"
            title="View on pkg.go.dev"
          >
            <ExternalLink className="w-4 h-4" />
          </a>
        </div>

        <div className="grid grid-cols-3 gap-2.5 mb-3.5">
          <div className="p-2.5 rounded-xl bg-zinc-950/60 border border-zinc-800/60 flex flex-col items-center justify-center">
            <span className="text-[10px] text-zinc-400 block mb-0.5">Latest Tag</span>
            <div className="flex items-center gap-1 text-cyan-400 font-bold text-xs font-mono">
              <Tag className="w-3 h-3" />
              <span className="truncate max-w-[85px]">{stats.latestVersion}</span>
            </div>
          </div>

          <div className="p-2.5 rounded-xl bg-zinc-950/60 border border-zinc-800/60 flex flex-col items-center justify-center">
            <span className="text-[10px] text-zinc-400 block mb-0.5">Published Tags</span>
            <div className="flex items-center gap-1 text-zinc-200 font-bold text-sm">
              <Layers className="w-3.5 h-3.5 text-zinc-400" />
              <span>{stats.versionCount}</span>
            </div>
          </div>

          <div className="p-2.5 rounded-xl bg-zinc-950/60 border border-zinc-800/60 flex flex-col items-center justify-center">
            <span className="text-[10px] text-zinc-400 block mb-0.5">Last Push</span>
            <div className="flex items-center gap-1 text-zinc-300 font-medium text-[11px]" suppressHydrationWarning>
              <Clock className="w-3 h-3 text-zinc-500" />
              <span>{stats.publishedAt ? formatDate(stats.publishedAt) : "Indexed"}</span>
            </div>
          </div>
        </div>

        {stats.recentVersions.length > 0 && (
          <div className="p-2.5 rounded-xl bg-zinc-950/60 border border-zinc-800/70">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400 block mb-1.5">
              Recent Tagged Versions
            </span>
            <div className="flex flex-wrap gap-1.5">
              {stats.recentVersions.map((ver) => (
                <span
                  key={ver}
                  className="px-2 py-0.5 rounded-lg bg-zinc-900 border border-zinc-800 font-mono text-[11px] text-cyan-300"
                >
                  {ver}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="mt-3 pt-2 flex items-center justify-between text-[11px] text-zinc-500 border-t border-zinc-800/40">
        <span>proxy.golang.org</span>
        <span className="text-cyan-400 font-medium">Checksum Verified</span>
      </div>
    </div>
  );
}
