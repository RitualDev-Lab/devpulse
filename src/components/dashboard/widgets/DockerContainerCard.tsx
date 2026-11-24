"use client";

import React from "react";
import { Container, Download, Star, ExternalLink, Tag, Clock } from "lucide-react";
import type { DockerRepoStats } from "@/lib/integrations/docker";
import { formatNumber, formatCompactNumber, formatDate } from "@/lib/utils/format";

interface DockerContainerCardProps {
  stats: DockerRepoStats | null;
  imageName: string;
}

export function DockerContainerCard({ stats, imageName }: DockerContainerCardProps) {
  if (!stats) {
    return (
      <div className="flex flex-col h-full justify-between p-5 rounded-2xl bg-zinc-900/90 border border-zinc-800/80 shadow-lg shadow-black/40">
        <div>
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-blue-950/80 border border-blue-800/60 flex items-center justify-center text-blue-400">
                <Container className="w-4 h-4" />
              </div>
              <div>
                <h3 className="font-semibold text-white text-base leading-tight">Docker Container</h3>
                <p className="text-xs text-zinc-400 font-mono">{imageName}</p>
              </div>
            </div>
            <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-zinc-800 text-zinc-400 border border-zinc-700">
              Offline
            </span>
          </div>
          <div className="py-8 text-center text-zinc-500">
            <p className="text-xs">No public image data found for &quot;{imageName}&quot; on Docker Hub.</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full justify-between p-5 rounded-2xl bg-zinc-900/90 border border-zinc-800/80 shadow-lg shadow-black/40 hover:border-zinc-700 transition">
      <div>
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-blue-950/80 border border-blue-800/60 flex items-center justify-center text-blue-400">
              <Container className="w-4 h-4" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-semibold text-white text-base leading-tight">{stats.repository}</h3>
                <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-400 border border-blue-500/20">
                  Docker Hub
                </span>
              </div>
              <p className="text-xs text-zinc-400 font-mono truncate max-w-[200px]">
                {stats.imageName}
              </p>
            </div>
          </div>
          <a
            href={stats.hubUrl}
            target="_blank"
            rel="noreferrer"
            className="text-zinc-500 hover:text-blue-400 p-1.5 rounded-lg hover:bg-zinc-800 transition"
            title="View on Docker Hub"
          >
            <ExternalLink className="w-4 h-4" />
          </a>
        </div>

        {/* Pulls & Stars Grid */}
        <div className="grid grid-cols-2 gap-3 mb-4">
          <div className="p-3.5 rounded-xl bg-zinc-950/70 border border-zinc-800/80">
            <div className="flex items-center gap-1.5 text-zinc-400 text-xs mb-1">
              <Download className="w-3.5 h-3.5 text-blue-400" />
              <span>Container Pulls</span>
            </div>
            <p
              className="text-2xl font-black text-white tracking-tight truncate"
              title={formatNumber(stats.pullCount)}
            >
              {formatCompactNumber(stats.pullCount)}
            </p>
          </div>

          <div className="p-3.5 rounded-xl bg-zinc-950/70 border border-zinc-800/80">
            <div className="flex items-center gap-1.5 text-zinc-400 text-xs mb-1">
              <Star className="w-3.5 h-3.5 text-amber-400" />
              <span>Docker Stars</span>
            </div>
            <p
              className="text-2xl font-black text-white tracking-tight truncate"
              title={formatNumber(stats.starCount)}
            >
              {formatCompactNumber(stats.starCount)}
            </p>
          </div>
        </div>

        {/* Tags / Releases */}
        {stats.tags && stats.tags.length > 0 && (
          <div className="space-y-1.5 mb-3">
            <span className="text-[10px] uppercase font-semibold text-zinc-400 tracking-wider block">
              Recent Tags
            </span>
            <div className="flex flex-wrap gap-1.5">
              {stats.tags.slice(0, 3).map((t) => (
                <div
                  key={t.name}
                  className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-zinc-950 border border-zinc-800 text-[11px] font-mono text-zinc-300"
                >
                  <Tag className="w-3 h-3 text-cyan-400" />
                  <span>{t.name}</span>
                  {t.sizeBytes > 0 && (
                    <span className="text-zinc-500 text-[10px]">
                      ({Math.round(t.sizeBytes / 1024 / 1024)} MB)
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="mt-4 pt-3 border-t border-zinc-800/80 flex items-center justify-between text-[11px] text-zinc-500">
        <span>hub.docker.com API</span>
        <span className="flex items-center gap-1 text-emerald-400">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
          Live Synced
        </span>
      </div>
    </div>
  );
}
