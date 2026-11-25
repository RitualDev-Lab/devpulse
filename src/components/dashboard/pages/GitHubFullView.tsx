"use client";

import React, { useState, useEffect, useCallback } from "react";
import {
  GitBranch,
  GitPullRequest,
  CircleDot,
  Star,
  GitFork,
  ExternalLink,
  MessageSquare,
  CheckCircle2,
  RotateCcw,
  GitMerge,
  Loader2,
  ShieldAlert,
  TrendingUp,
} from "lucide-react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import type { LoadedWorkspaceReady } from "@/lib/dashboard/load-workspace";
import { WorkspaceShell } from "../WorkspaceShell";

interface GitHubManagePayload {
  repo: string;
  htmlUrl: string;
  hasWriteToken: boolean;
  issues: Array<{
    id: number;
    number: number;
    title: string;
    state: string;
    comments: number;
    author: string;
    htmlUrl: string;
    createdAt: string;
  }>;
  pulls: Array<{
    id: number;
    number: number;
    title: string;
    state: string;
    draft: boolean;
    author: string;
    headRef: string;
    baseRef: string;
    htmlUrl: string;
    createdAt: string;
  }>;
  trafficClones: {
    count: number;
    uniques: number;
    daily: Array<{ date: string; count: number; uniques: number }>;
  } | null;
  trafficViews: {
    count: number;
    uniques: number;
    daily: Array<{ date: string; count: number; uniques: number }>;
  } | null;
}

export function GitHubFullView({ workspace }: { workspace: LoadedWorkspaceReady }) {
  const { initialData, projects, customDomain, storageTier, isDemo } = workspace;
  const gh = initialData.githubStats;
  const project = initialData.project;

  const [stateFilter, setStateFilter] = useState<"open" | "closed">("open");
  const [activeTab, setActiveTab] = useState<"issues" | "pulls">("pulls");
  const [liveData, setLiveData] = useState<GitHubManagePayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [busyNumber, setBusyNumber] = useState<number | null>(null);
  const [commentTarget, setCommentTarget] = useState<number | null>(null);
  const [commentText, setCommentText] = useState("");
  const [feedback, setFeedback] = useState<{ ok: boolean; msg: string } | null>(null);

  const loadGitHubData = useCallback(async () => {
    if (!project.githubRepo || isDemo) return;
    setLoading(true);
    try {
      const res = await fetch(
        `/api/v1/github/manage?projectId=${encodeURIComponent(project.id)}&state=${stateFilter}`
      );
      if (res.ok) {
        const d = await res.json();
        setLiveData(d);
      }
    } finally {
      setLoading(false);
    }
  }, [project.id, project.githubRepo, stateFilter, isDemo]);

  useEffect(() => {
    loadGitHubData();
  }, [loadGitHubData]);

  const handleGitHubAction = async (
    action: "close_issue" | "reopen_issue" | "comment" | "merge_pr",
    num: number,
    body?: string
  ) => {
    if (isDemo) {
      setFeedback({ ok: false, msg: "Sign in with GitHub to manage Issues and Pull Requests." });
      return;
    }
    setBusyNumber(num);
    setFeedback(null);
    try {
      const res = await fetch("/api/v1/github/manage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId: project.id, action, number: num, body }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "GitHub operation failed");
      setFeedback({ ok: true, msg: `Updated #${num} on GitHub (${action}).` });
      setCommentTarget(null);
      setCommentText("");
      await loadGitHubData();
    } catch (e: any) {
      setFeedback({ ok: false, msg: e.message || "Action failed" });
    } finally {
      setBusyNumber(null);
    }
  };

  const displayIssues =
    liveData?.issues ??
    (gh?.recentIssues || [])
      .filter((i) => !i.isPullRequest)
      .map((i) => ({
        id: i.id,
        number: i.number,
        title: i.title,
        state: i.state,
        comments: 0,
        author: i.author,
        htmlUrl: i.htmlUrl,
        createdAt: i.createdAt,
      }));

  const displayPulls =
    liveData?.pulls ??
    (gh?.pulls || []).map((p) => ({
      id: p.id,
      number: p.number,
      title: p.title,
      state: p.state,
      draft: p.draft,
      author: p.author,
      headRef: p.headRef,
      baseRef: p.baseRef,
      htmlUrl: p.htmlUrl,
      createdAt: p.createdAt,
    }));

  const clonesSeries = liveData?.trafficClones?.daily || gh?.trafficClones?.daily || [];
  const viewsSeries = liveData?.trafficViews?.daily || gh?.trafficViews?.daily || [];

  return (
    <WorkspaceShell
      currentProject={{ ...project, telemetryApiKey: project.telemetryApiKey }}
      projects={projects}
      storageTier={storageTier}
      customDomain={customDomain}
      isDemo={isDemo}
    >
      <div className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-extrabold text-white flex items-center gap-2.5">
              <GitBranch className="w-6 h-6 text-indigo-400" />
              <span>GitHub Command Center</span>
            </h1>
            <p className="text-xs text-zinc-400 mt-0.5">
              {project.githubRepo || "No repository connected"} &bull; Manage PRs, Issues, Daily Clones &amp; Repo Views
            </p>
          </div>
          {project.githubRepo && (
            <a
              href={`https://github.com/${project.githubRepo}`}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-2 px-4 py-2 rounded-xl bg-zinc-900 hover:bg-zinc-800 border border-zinc-700 text-xs font-semibold text-white transition"
            >
              <span>Open {project.githubRepo} on GitHub</span>
              <ExternalLink className="w-3.5 h-3.5 text-indigo-400" />
            </a>
          )}
        </div>

        {/* Summary KPI Strip */}
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          <div className="p-4 rounded-2xl bg-zinc-900/90 border border-zinc-800">
            <div className="text-xs text-zinc-400 flex items-center gap-1.5">
              <Star className="w-3.5 h-3.5 text-amber-400" /> Stars
            </div>
            <div className="text-2xl font-bold text-white mt-1">
              {(gh?.stars || 0).toLocaleString()}
            </div>
          </div>
          <div className="p-4 rounded-2xl bg-zinc-900/90 border border-zinc-800">
            <div className="text-xs text-zinc-400 flex items-center gap-1.5">
              <GitFork className="w-3.5 h-3.5 text-zinc-400" /> Forks
            </div>
            <div className="text-2xl font-bold text-white mt-1">
              {(gh?.forks || 0).toLocaleString()}
            </div>
          </div>
          <div className="p-4 rounded-2xl bg-zinc-900/90 border border-zinc-800">
            <div className="text-xs text-zinc-400 flex items-center gap-1.5">
              <GitPullRequest className="w-3.5 h-3.5 text-indigo-400" /> Open PRs
            </div>
            <div className="text-2xl font-bold text-white mt-1">
              {gh?.openPrCount ?? displayPulls.length}
            </div>
          </div>
          <div className="p-4 rounded-2xl bg-zinc-900/90 border border-zinc-800">
            <div className="text-xs text-zinc-400 flex items-center gap-1.5">
              <CircleDot className="w-3.5 h-3.5 text-emerald-400" /> Open Issues
            </div>
            <div className="text-2xl font-bold text-white mt-1">
              {gh?.openIssuesCount ?? displayIssues.length}
            </div>
          </div>
          <div className="p-4 rounded-2xl bg-zinc-900/90 border border-zinc-800">
            <div className="text-xs text-zinc-400 flex items-center gap-1.5">
              <ShieldAlert className="w-3.5 h-3.5 text-red-400" /> Dependabot
            </div>
            <div className="text-2xl font-bold text-white mt-1">
              {gh?.dependabotAlertsCount || 0}
            </div>
          </div>
        </div>

        {/* Daily Clones & Daily Views Charts */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          <div className="p-5 rounded-2xl bg-zinc-900/90 border border-zinc-800 space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-sm font-bold text-white flex items-center gap-1.5">
                  <TrendingUp className="w-4 h-4 text-emerald-400" />
                  <span>Daily Git Clones (14-Day)</span>
                </h2>
                <p className="text-xs text-zinc-400">
                  {liveData?.trafficClones
                    ? `${liveData.trafficClones.count.toLocaleString()} total clones • ${liveData.trafficClones.uniques.toLocaleString()} unique cloners`
                    : "Requires GitHub push permission / PAT in Settings -> Quick Connect"}
                </p>
              </div>
            </div>
            <div className="h-44">
              {clonesSeries.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={clonesSeries}>
                    <XAxis dataKey="date" tick={{ fill: "#71717a", fontSize: 10 }} />
                    <YAxis tick={{ fill: "#71717a", fontSize: 10 }} width={32} />
                    <Tooltip
                      contentStyle={{ backgroundColor: "#09090b", borderColor: "#27272a", borderRadius: "8px", fontSize: "12px" }}
                    />
                    <Area type="monotone" dataKey="count" name="Clones" stroke="#10b981" fill="#10b98130" />
                    <Area type="monotone" dataKey="uniques" name="Unique Cloners" stroke="#06b6d4" fill="#06b6d420" />
                  </AreaChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-full rounded-xl bg-zinc-950/60 border border-zinc-800/70 flex items-center justify-center text-xs text-zinc-500 text-center px-4">
                  Connect a GitHub PAT (repo scope) in Quick Connect to unlock daily git clone charts.
                </div>
              )}
            </div>
          </div>

          <div className="p-5 rounded-2xl bg-zinc-900/90 border border-zinc-800 space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-sm font-bold text-white flex items-center gap-1.5">
                  <TrendingUp className="w-4 h-4 text-indigo-400" />
                  <span>Daily Repository Views (14-Day)</span>
                </h2>
                <p className="text-xs text-zinc-400">
                  {liveData?.trafficViews
                    ? `${liveData.trafficViews.count.toLocaleString()} views • ${liveData.trafficViews.uniques.toLocaleString()} unique visitors`
                    : "Tracks daily GitHub repository traffic & unique visitors"}
                </p>
              </div>
            </div>
            <div className="h-44">
              {viewsSeries.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={viewsSeries}>
                    <XAxis dataKey="date" tick={{ fill: "#71717a", fontSize: 10 }} />
                    <YAxis tick={{ fill: "#71717a", fontSize: 10 }} width={32} />
                    <Tooltip
                      contentStyle={{ backgroundColor: "#09090b", borderColor: "#27272a", borderRadius: "8px", fontSize: "12px" }}
                    />
                    <Area type="monotone" dataKey="count" name="Views" stroke="#6366f1" fill="#6366f130" />
                    <Area type="monotone" dataKey="uniques" name="Unique Visitors" stroke="#a855f7" fill="#a855f720" />
                  </AreaChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-full rounded-xl bg-zinc-950/60 border border-zinc-800/70 flex items-center justify-center text-xs text-zinc-500 text-center px-4">
                  Daily repository page views appear here once GitHub traffic scope is enabled.
                </div>
              )}
            </div>
          </div>
        </div>

        {feedback && (
          <div
            className={`p-3 rounded-xl text-xs border ${
              feedback.ok
                ? "bg-emerald-950/60 border-emerald-700/60 text-emerald-200"
                : "bg-red-950/60 border-red-700/60 text-red-200"
            }`}
          >
            {feedback.msg}
          </div>
        )}

        {/* PR & Issue Manager */}
        <div className="rounded-2xl bg-zinc-900/90 border border-zinc-800 overflow-hidden">
          <div className="p-4 border-b border-zinc-800 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setActiveTab("pulls")}
                className={`px-3.5 py-1.5 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition ${
                  activeTab === "pulls" ? "bg-indigo-600 text-white" : "bg-zinc-950 text-zinc-400 hover:text-white border border-zinc-800"
                }`}
              >
                <GitPullRequest className="w-3.5 h-3.5" />
                <span>Pull Requests ({displayPulls.length})</span>
              </button>
              <button
                type="button"
                onClick={() => setActiveTab("issues")}
                className={`px-3.5 py-1.5 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition ${
                  activeTab === "issues" ? "bg-emerald-600 text-white" : "bg-zinc-950 text-zinc-400 hover:text-white border border-zinc-800"
                }`}
              >
                <CircleDot className="w-3.5 h-3.5" />
                <span>Issues ({displayIssues.length})</span>
              </button>
            </div>

            <div className="flex items-center gap-1.5 text-xs">
              {(["open", "closed"] as const).map((st) => (
                <button
                  key={st}
                  type="button"
                  onClick={() => setStateFilter(st)}
                  className={`px-3 py-1 rounded-lg capitalize font-medium ${
                    stateFilter === st ? "bg-zinc-800 text-white" : "text-zinc-500 hover:text-zinc-300"
                  }`}
                >
                  {st}
                </button>
              ))}
              {loading && <Loader2 className="w-4 h-4 animate-spin text-indigo-400 ml-2" />}
            </div>
          </div>

          <div className="divide-y divide-zinc-800/70">
            {(activeTab === "pulls" ? displayPulls : displayIssues).length === 0 ? (
              <div className="p-8 text-center text-xs text-zinc-500">
                No {stateFilter} {activeTab === "pulls" ? "pull requests" : "issues"} found for this repository.
              </div>
            ) : (
              (activeTab === "pulls" ? displayPulls : displayIssues).map((item) => (
                <div key={item.id} className="p-4 hover:bg-zinc-950/60 transition space-y-2">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-xs font-mono text-zinc-500">#{item.number}</span>
                        <a
                          href={item.htmlUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="text-sm font-semibold text-white hover:text-indigo-300 transition truncate"
                        >
                          {item.title}
                        </a>
                        {"draft" in item && item.draft && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400">Draft</span>
                        )}
                      </div>
                      <div className="text-[11px] text-zinc-500 mt-0.5 font-mono">
                        @{item.author} &bull; {new Date(item.createdAt).toLocaleDateString()}
                        {"headRef" in item && item.headRef ? ` • ${item.headRef} → ${item.baseRef}` : ""}
                      </div>
                    </div>

                    <div className="flex items-center gap-1.5 shrink-0 text-xs">
                      <button
                        type="button"
                        onClick={() =>
                          setCommentTarget(commentTarget === item.number ? null : item.number)
                        }
                        className="px-2.5 py-1 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-200 flex items-center gap-1"
                      >
                        <MessageSquare className="w-3 h-3" />
                        <span>Comment</span>
                      </button>

                      {activeTab === "pulls" && item.state === "open" && (
                        <button
                          type="button"
                          disabled={busyNumber === item.number}
                          onClick={() => handleGitHubAction("merge_pr", item.number)}
                          className="px-2.5 py-1 rounded-lg bg-indigo-600/25 hover:bg-indigo-600/40 border border-indigo-500/40 text-indigo-200 flex items-center gap-1 disabled:opacity-40"
                        >
                          <GitMerge className="w-3 h-3" />
                          <span>Merge</span>
                        </button>
                      )}

                      {item.state === "open" ? (
                        <button
                          type="button"
                          disabled={busyNumber === item.number}
                          onClick={() => handleGitHubAction("close_issue", item.number)}
                          className="px-2.5 py-1 rounded-lg bg-emerald-600/20 hover:bg-emerald-600/35 border border-emerald-500/30 text-emerald-300 flex items-center gap-1 disabled:opacity-40"
                        >
                          <CheckCircle2 className="w-3 h-3" />
                          <span>Close</span>
                        </button>
                      ) : (
                        <button
                          type="button"
                          disabled={busyNumber === item.number}
                          onClick={() => handleGitHubAction("reopen_issue", item.number)}
                          className="px-2.5 py-1 rounded-lg bg-amber-600/20 hover:bg-amber-600/35 border border-amber-500/30 text-amber-300 flex items-center gap-1 disabled:opacity-40"
                        >
                          <RotateCcw className="w-3 h-3" />
                          <span>Reopen</span>
                        </button>
                      )}

                      <a
                        href={item.htmlUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="px-2.5 py-1 rounded-lg bg-zinc-950 hover:bg-zinc-800 border border-zinc-800 text-zinc-300 flex items-center gap-1"
                      >
                        <span>GitHub</span>
                        <ExternalLink className="w-3 h-3" />
                      </a>
                    </div>
                  </div>

                  {commentTarget === item.number && (
                    <div className="flex gap-2 pt-2">
                      <input
                        type="text"
                        value={commentText}
                        onChange={(e) => setCommentText(e.target.value)}
                        placeholder={`Post comment to #${item.number}...`}
                        className="flex-1 px-3 py-1.5 rounded-lg bg-zinc-950 border border-zinc-800 text-xs text-white"
                      />
                      <button
                        type="button"
                        disabled={busyNumber === item.number || !commentText.trim()}
                        onClick={() => handleGitHubAction("comment", item.number, commentText)}
                        className="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold disabled:opacity-40"
                      >
                        Send Comment
                      </button>
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </WorkspaceShell>
  );
}
