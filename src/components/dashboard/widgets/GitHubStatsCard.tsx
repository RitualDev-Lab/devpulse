import React from "react";
import { GitFork, Star, AlertCircle, Tag, ExternalLink, GitPullRequest, Clock, ShieldAlert } from "lucide-react";
import type { GitHubRepoStats } from "@/lib/integrations/github";
import { formatNumber, formatDate } from "@/lib/utils/format";

interface GitHubStatsCardProps {
  stats: GitHubRepoStats | null;
  repoName: string;
}

export function GitHubStatsCard({ stats, repoName }: GitHubStatsCardProps) {
  if (!stats) {
    return (
      <div className="p-5 rounded-2xl bg-zinc-900/80 border border-zinc-800 text-zinc-400">
        <div className="flex items-center justify-between mb-3">
          <span className="font-semibold text-zinc-200">GitHub Repository</span>
          <span className="text-xs px-2 py-0.5 rounded bg-zinc-800 text-zinc-400">Offline</span>
        </div>
        <p className="text-sm">Unable to load public stats for {repoName}.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full justify-between p-5 rounded-2xl bg-zinc-900/90 border border-zinc-800/80 shadow-lg shadow-black/40 hover:border-zinc-700 transition">
      <div>
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-zinc-800 flex items-center justify-center text-white">
              <svg className="w-5 h-5 fill-current" viewBox="0 0 24 24">
                <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z" />
              </svg>
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-semibold text-white text-base leading-tight">{stats.repo}</h3>
                {stats.license && (
                  <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400 border border-zinc-700/60">
                    {stats.license}
                  </span>
                )}
              </div>
              <p className="text-xs text-zinc-400">{stats.fullName}</p>
            </div>
          </div>
          <a
            href={`https://github.com/${stats.fullName}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-zinc-400 hover:text-white transition p-1.5 rounded-lg hover:bg-zinc-800"
            title="View on GitHub"
          >
            <ExternalLink className="w-4 h-4" />
          </a>
        </div>

        {stats.description && (
          <p className="text-xs text-zinc-300 line-clamp-2 mb-4">{stats.description}</p>
        )}

        {/* Primary Metric Badges: 4-col */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-3">
          <div className="p-2.5 rounded-xl bg-zinc-950/60 border border-zinc-800/60 flex flex-col items-center justify-center">
            <div className="flex items-center gap-1 text-amber-400 mb-0.5">
              <Star className="w-3.5 h-3.5 fill-amber-400" />
              <span className="font-bold text-sm text-zinc-100">{formatNumber(stats.stars)}</span>
            </div>
            <span className="text-[11px] text-zinc-400">Stars</span>
          </div>

          <div className="p-2.5 rounded-xl bg-zinc-950/60 border border-zinc-800/60 flex flex-col items-center justify-center">
            <div className="flex items-center gap-1 text-blue-400 mb-0.5">
              <GitFork className="w-3.5 h-3.5" />
              <span className="font-bold text-sm text-zinc-100">{formatNumber(stats.forks)}</span>
            </div>
            <span className="text-[11px] text-zinc-400">Forks</span>
          </div>

          <div className="p-2.5 rounded-xl bg-zinc-950/60 border border-zinc-800/60 flex flex-col items-center justify-center">
            <div className="flex items-center gap-1 text-purple-400 mb-0.5">
              <GitPullRequest className="w-3.5 h-3.5" />
              <span className="font-bold text-sm text-zinc-100">{formatNumber(stats.openPrCount)}</span>
            </div>
            <span className="text-[11px] text-zinc-400">Open PRs</span>
          </div>

          <div className="p-2.5 rounded-xl bg-zinc-950/60 border border-zinc-800/60 flex flex-col items-center justify-center">
            <div className="flex items-center gap-1 text-emerald-400 mb-0.5">
              <AlertCircle className="w-3.5 h-3.5" />
              <span className="font-bold text-sm text-zinc-100">{formatNumber(stats.openIssuesCount)}</span>
            </div>
            <span className="text-[11px] text-zinc-400">Open Issues</span>
          </div>
        </div>

        {/* PR Review Velocity & Issue Triage Health Row */}
        <div className="grid grid-cols-2 gap-2 mb-3">
          <div className="flex items-center justify-between p-2 rounded-xl bg-zinc-800/30 border border-zinc-800/60 text-xs">
            <div className="flex items-center gap-1.5 text-zinc-300">
              <Clock className="w-3.5 h-3.5 text-indigo-400" />
              <span className="text-[11px]">PR Velocity</span>
            </div>
            <span className="font-mono font-medium text-indigo-300 text-[11px]">
              {stats.prReviewVelocityHours > 0 ? `${stats.prReviewVelocityHours}h avg` : "Active"}
            </span>
          </div>

          <div className="flex items-center justify-between p-2 rounded-xl bg-zinc-800/30 border border-zinc-800/60 text-xs">
            <div className="flex items-center gap-1.5 text-zinc-300">
              <span className="w-2 h-2 rounded-full bg-amber-400" />
              <span className="text-[11px]">Triage Aging</span>
            </div>
            <div className="flex items-center gap-1.5 text-[11px]">
              <span className="text-emerald-400 font-mono">{stats.freshIssuesCount} fresh</span>
              {stats.staleIssuesCount > 0 && (
                <span className="text-rose-400 font-mono">({stats.staleIssuesCount} &gt;14d)</span>
              )}
            </div>
          </div>
        </div>

        {/* Dependabot Alerts Banner (if any) */}
        {stats.dependabotAlertsCount > 0 && (
          <div className="flex items-center justify-between p-2 rounded-xl bg-rose-950/30 border border-rose-900/50 mb-3 text-xs">
            <div className="flex items-center gap-1.5 text-rose-300">
              <ShieldAlert className="w-3.5 h-3.5 text-rose-400" />
              <span>Dependabot Alerts:</span>
            </div>
            <span className="font-semibold text-rose-300">{stats.dependabotAlertsCount} active</span>
          </div>
        )}

        {/* Latest Release */}
        {stats.latestRelease && (
          <div className="flex items-center justify-between p-2.5 rounded-xl bg-zinc-800/40 border border-zinc-800 mb-3 text-xs">
            <div className="flex items-center gap-2 text-zinc-300">
              <Tag className="w-3.5 h-3.5 text-indigo-400" />
              <span>Latest Release:</span>
              <span className="font-semibold text-white">{stats.latestRelease.tagName}</span>
            </div>
            <span className="text-[11px] text-zinc-400" suppressHydrationWarning>
              {formatDate(stats.latestRelease.publishedAt)}
            </span>
          </div>
        )}
      </div>

      {/* Recent Issues / PRs with Aging indicators */}
      {stats.recentIssues && stats.recentIssues.length > 0 && (
        <div className="mt-2 pt-3 border-t border-zinc-800/60">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[11px] font-medium uppercase tracking-wider text-zinc-400">
              Triage Queue & PR Activity
            </span>
            <span className="text-[10px] text-zinc-500">Last {Math.min(stats.recentIssues.length, 4)} items</span>
          </div>
          <div className="space-y-1.5">
            {stats.recentIssues.slice(0, 4).map((issue) => (
              <a
                key={issue.id}
                href={issue.htmlUrl}
                target="_blank"
                rel="noreferrer"
                className="flex items-center justify-between gap-2 p-1.5 rounded-lg hover:bg-zinc-800/60 text-xs text-zinc-300 hover:text-white transition group"
              >
                <div className="flex items-center gap-2 truncate">
                  <span className="text-zinc-500 font-mono text-[11px]">#{issue.number}</span>
                  <span className="truncate">{issue.title}</span>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  {issue.isStale && !issue.isPullRequest ? (
                    <span className="text-[9px] px-1.5 py-0.5 rounded bg-rose-950/80 text-rose-400 border border-rose-900/60">
                      {issue.ageDays}d stale
                    </span>
                  ) : (
                    <span className="text-[9px] text-zinc-500">
                      {issue.ageDays}d
                    </span>
                  )}
                  <span
                    className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
                      issue.isPullRequest
                        ? "bg-purple-950/80 text-purple-300 border border-purple-800/50"
                        : "bg-zinc-800 text-zinc-400"
                    }`}
                  >
                    {issue.isPullRequest ? "PR" : "Issue"}
                  </span>
                </div>
              </a>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
