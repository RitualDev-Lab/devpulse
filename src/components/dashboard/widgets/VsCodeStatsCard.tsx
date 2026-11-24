import React from "react";
import { Download, Star, ExternalLink, Code2, CheckCircle2 } from "lucide-react";
import type { VsCodeStats } from "@/lib/integrations/vscode";

interface VsCodeStatsCardProps {
  stats: VsCodeStats | null;
  extensionId: string;
}

export function VsCodeStatsCard({ stats, extensionId }: VsCodeStatsCardProps) {
  if (!stats) {
    return (
      <div className="p-5 rounded-2xl bg-zinc-900/80 border border-zinc-800 text-zinc-400">
        <div className="flex items-center justify-between mb-3">
          <span className="font-semibold text-zinc-200">VS Code Extension</span>
          <span className="text-xs px-2 py-0.5 rounded bg-zinc-800 text-zinc-400">Offline</span>
        </div>
        <p className="text-sm">Unable to load stats for {extensionId}.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full justify-between p-5 rounded-2xl bg-zinc-900/90 border border-zinc-800/80 shadow-lg shadow-black/40 hover:border-zinc-700 transition">
      <div>
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-sky-950/80 border border-sky-800/60 flex items-center justify-center text-sky-400">
              <Code2 className="w-4 h-4" />
            </div>
            <div>
              <h3 className="font-semibold text-white text-base leading-tight">
                {stats.displayName || stats.name}
              </h3>
              <p className="text-xs text-zinc-400 font-mono">{stats.extensionId}</p>
            </div>
          </div>
          <a
            href={stats.marketplaceUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-zinc-400 hover:text-white transition p-1.5 rounded-lg hover:bg-zinc-800"
            title="Open in VS Marketplace"
          >
            <ExternalLink className="w-4 h-4" />
          </a>
        </div>

        {stats.description && (
          <p className="text-xs text-zinc-300 line-clamp-2 mb-4">{stats.description}</p>
        )}

        {/* 3 Metric Stats */}
        <div className="grid grid-cols-3 gap-2.5 mb-4">
          <div className="p-2.5 rounded-xl bg-zinc-950/60 border border-zinc-800/60 flex flex-col items-center justify-center">
            <span className="text-[10px] text-zinc-400 block mb-0.5">Total Installs</span>
            <div className="flex items-center gap-1 text-sky-400 font-bold text-sm">
              <Download className="w-3.5 h-3.5" />
              <span>{stats.installs.toLocaleString()}</span>
            </div>
          </div>

          <div className="p-2.5 rounded-xl bg-zinc-950/60 border border-zinc-800/60 flex flex-col items-center justify-center">
            <span className="text-[10px] text-zinc-400 block mb-0.5">User Rating</span>
            <div className="flex items-center gap-1 text-amber-400 font-bold text-sm">
              <Star className="w-3.5 h-3.5 fill-amber-400" />
              <span>{stats.averageRating}</span>
            </div>
          </div>

          <div className="p-2.5 rounded-xl bg-zinc-950/60 border border-zinc-800/60 flex flex-col items-center justify-center">
            <span className="text-[10px] text-zinc-400 block mb-0.5">Version</span>
            <span className="text-xs font-mono font-semibold text-zinc-200">
              {stats.version}
            </span>
          </div>
        </div>

        <div className="flex items-center justify-between p-2.5 rounded-xl bg-zinc-950/50 border border-zinc-800/60 text-xs text-zinc-400">
          <div className="flex items-center gap-1.5 text-zinc-300">
            <CheckCircle2 className="w-3.5 h-3.5 text-sky-400" />
            <span>Open-VSX & VS Code Marketplace Synced</span>
          </div>
          <span className="text-[10px] font-mono text-zinc-500">{stats.reviewCount} reviews</span>
        </div>
      </div>

      <div className="mt-3 pt-2 flex items-center justify-between text-[11px] text-zinc-500 border-t border-zinc-800/40">
        <span>Visual Studio Marketplace</span>
        <span className="text-emerald-400 font-medium">Verified Publisher</span>
      </div>
    </div>
  );
}
