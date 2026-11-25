"use client";

import React, { useState, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
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
  Search,
  Tag,
  Eye,
  X,
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
import { useWorkspaceData } from "../WorkspaceCacheContext";

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
    labels?: Array<{ name: string; color: string }>;
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
    labels?: Array<{ name: string; color: string }>;
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
  starsDaily?: Array<{ date: string; stars: number }>;
}

export function GitHubFullView({ workspace }: { workspace: LoadedWorkspaceReady }) {
  const { projects, customDomain, storageTier, isDemo } = workspace;
  const initialData = useWorkspaceData(workspace.initialData);
  const gh = initialData.githubStats;
  const project = initialData.project;

  const [stateFilter, setStateFilter] = useState<"open" | "closed">("open");
  const [activeTab, setActiveTab] = useState<"issues" | "pulls">("pulls");
  const [searchQuery, setSearchQuery] = useState("");
  const [liveData, setLiveData] = useState<GitHubManagePayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [busyNumber, setBusyNumber] = useState<number | null>(null);
  const [commentTarget, setCommentTarget] = useState<number | null>(null);
  const [commentText, setCommentText] = useState("");
  const [labelTarget, setLabelTarget] = useState<number | null>(null);
  const [labelText, setLabelText] = useState("");
  const [threadModal, setThreadModal] = useState<{
    number: number;
    title: string;
    body: string;
    author: string;
    state: string;
    htmlUrl: string;
    labels: Array<{ name: string; color: string }>;
    comments: Array<{ id: number; author: string; body: string; createdAt: string }>;
  } | null>(null);
  const [loadingThread, setLoadingThread] = useState(false);
  const [feedback, setFeedback] = useState<{ ok: boolean; msg: string } | null>(null);

  const inspectThread = async (itemNumber: number, fallback: { title: string; author: string; state: string; htmlUrl: string }) => {
    setLoadingThread(true);
    setThreadModal({
      number: itemNumber,
      title: fallback.title,
      body: isDemo ? "Sign in with GitHub to inspect live issue & PR discussion threads directly from GitHub API." : "Loading discussion thread...",
      author: fallback.author,
      state: fallback.state,
      htmlUrl: fallback.htmlUrl,
      labels: [],
      comments: [],
    });
    if (isDemo) {
      setLoadingThread(false);
      return;
    }
    try {
      const res = await fetch(
        `/api/v1/github/manage?projectId=${encodeURIComponent(project.id)}&mode=thread&number=${itemNumber}`
      );
      if (res.ok) {
        const d = await res.json();
        setThreadModal(d);
      }
    } finally {
      setLoadingThread(false);
    }
  };

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
    action: "close_issue" | "reopen_issue" | "comment" | "merge_pr" | "add_label" | "remove_label",
    num: number,
    payloadArg?: string
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
        body: JSON.stringify({
          projectId: project.id,
          action,
          number: num,
          ...(action === "add_label" || action === "remove_label"
            ? { label: payloadArg }
            : { body: payloadArg }),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "GitHub operation failed");
      setFeedback({ ok: true, msg: `Updated #${num} on GitHub (${action}).` });
      setCommentTarget(null);
      setCommentText("");
      setLabelTarget(null);
      setLabelText("");
      await loadGitHubData();
    } catch (e: any) {
      setFeedback({ ok: false, msg: e.message || "Action failed" });
    } finally {
      setBusyNumber(null);
    }
  };

  const matchQuery = (item: { title: string; author: string; number: number }) => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return true;
    return (
      item.title.toLowerCase().includes(q) ||
      item.author.toLowerCase().includes(q) ||
      String(item.number).includes(q)
    );
  };

  const displayIssues = (
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
        labels: [] as Array<{ name: string; color: string }>,
        htmlUrl: i.htmlUrl,
        createdAt: i.createdAt,
      }))
  ).filter(matchQuery);

  const displayPulls = (
    liveData?.pulls ??
    (gh?.pulls || []).map((p) => ({
      id: p.id,
      number: p.number,
      title: p.title,
      state: p.state,
      draft: p.draft,
      author: p.author,
      labels: [] as Array<{ name: string; color: string }>,
      headRef: p.headRef,
      baseRef: p.baseRef,
      htmlUrl: p.htmlUrl,
      createdAt: p.createdAt,
    }))
  ).filter(matchQuery);

  const clonesSeries =
    liveData?.trafficClones?.daily ||
    gh?.trafficClones?.daily ||
    initialData.githubHistory?.clonesDaily ||
    [];
  const viewsSeries =
    liveData?.trafficViews?.daily ||
    gh?.trafficViews?.daily ||
    initialData.githubHistory?.viewsDaily ||
    [];
  const starsSeries =
    liveData?.starsDaily && liveData.starsDaily.length > 0
      ? liveData.starsDaily
      : initialData.githubHistory?.starsDaily || [];

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

        {/* Daily Clones, Views & Daily Star Growth Charts */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
          <div className="p-5 rounded-2xl bg-zinc-900/90 border border-zinc-800 space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-sm font-bold text-white flex items-center gap-1.5">
                  <TrendingUp className="w-4 h-4 text-emerald-400" />
                  <span>Daily Git Clones</span>
                </h2>
                <p className="text-xs text-zinc-400">
                  {liveData?.trafficClones
                    ? `${liveData.trafficClones.count.toLocaleString()} clones • ${liveData.trafficClones.uniques.toLocaleString()} unique`
                    : "Archived daily in Turso (never expires)"}
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
                  <span>Daily Repository Views</span>
                </h2>
                <p className="text-xs text-zinc-400">
                  {liveData?.trafficViews
                    ? `${liveData.trafficViews.count.toLocaleString()} views • ${liveData.trafficViews.uniques.toLocaleString()} unique`
                    : "Tracks daily repo views & unique visitors"}
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

          <div className="p-5 rounded-2xl bg-zinc-900/90 border border-zinc-800 space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-sm font-bold text-white flex items-center gap-1.5">
                  <Star className="w-4 h-4 text-amber-400" />
                  <span>Daily Star Growth</span>
                </h2>
                <p className="text-xs text-zinc-400">
                  Historical star snapshots persisted in Turso daily_metrics
                </p>
              </div>
            </div>
            <div className="h-44">
              {starsSeries.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={starsSeries}>
                    <XAxis dataKey="date" tick={{ fill: "#71717a", fontSize: 10 }} />
                    <YAxis tick={{ fill: "#71717a", fontSize: 10 }} width={32} />
                    <Tooltip
                      contentStyle={{ backgroundColor: "#09090b", borderColor: "#27272a", borderRadius: "8px", fontSize: "12px" }}
                    />
                    <Area type="monotone" dataKey="stars" name="Stars" stroke="#f59e0b" fill="#f59e0b25" />
                  </AreaChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-full rounded-xl bg-zinc-950/60 border border-zinc-800/70 flex items-center justify-center text-xs text-zinc-500 text-center px-4">
                  Star history populates as daily sync records snapshots for {project.githubRepo || "your repository"}.
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

            <div className="flex items-center gap-2 text-xs flex-wrap">
              <div className="relative">
                <Search className="w-3.5 h-3.5 text-zinc-500 absolute left-2.5 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Filter #number, author, title..."
                  className="pl-8 pr-3 py-1.5 rounded-lg bg-zinc-950 border border-zinc-800 text-xs text-white placeholder-zinc-500 w-52"
                />
              </div>
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
                        <button
                          type="button"
                          onClick={() => inspectThread(item.number, item)}
                          className="text-sm font-semibold text-white hover:text-indigo-300 transition truncate text-left"
                        >
                          {item.title}
                        </button>
                        {"draft" in item && item.draft && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400">Draft</span>
                        )}
                        {(item.labels || []).map((lbl) => (
                          <span
                            key={lbl.name}
                            className="text-[10px] px-2 py-0.5 rounded-full bg-zinc-900 border border-zinc-700 text-zinc-300 font-medium"
                          >
                            {lbl.name}
                          </span>
                        ))}
                      </div>
                      <div className="text-[11px] text-zinc-500 mt-0.5 font-mono">
                        @{item.author} &bull; {new Date(item.createdAt).toLocaleDateString()}
                        {"headRef" in item && item.headRef ? ` • ${item.headRef} → ${item.baseRef}` : ""}
                      </div>
                    </div>

                    <div className="flex items-center gap-1.5 shrink-0 text-xs flex-wrap">
                      <button
                        type="button"
                        onClick={() => inspectThread(item.number, item)}
                        className="px-2.5 py-1 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-200 flex items-center gap-1"
                      >
                        <Eye className="w-3 h-3" />
                        <span>Inspect</span>
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          setLabelTarget(labelTarget === item.number ? null : item.number)
                        }
                        className="px-2.5 py-1 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-200 flex items-center gap-1"
                      >
                        <Tag className="w-3 h-3" />
                        <span>Label</span>
                      </button>
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

                  {labelTarget === item.number && (
                    <div className="flex gap-2 pt-2">
                      <input
                        type="text"
                        value={labelText}
                        onChange={(e) => setLabelText(e.target.value)}
                        placeholder={`Label name (e.g. bug, priority:high)...`}
                        className="flex-1 px-3 py-1.5 rounded-lg bg-zinc-950 border border-zinc-800 text-xs text-white"
                      />
                      <button
                        type="button"
                        disabled={busyNumber === item.number || !labelText.trim()}
                        onClick={() => handleGitHubAction("add_label", item.number, labelText)}
                        className="px-3 py-1.5 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-semibold disabled:opacity-40"
                      >
                        Apply Label
                      </button>
                    </div>
                  )}

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

      {/* Issue / PR Thread Inspector Modal (Portaled to document.body) */}
      {threadModal &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            onClick={() => setThreadModal(null)}
            className="fixed inset-0 z-[120] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm"
          >
            <div
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-2xl rounded-2xl bg-zinc-900 border border-zinc-700 shadow-2xl p-6 max-h-[85vh] flex flex-col"
            >
            <div className="flex items-start justify-between gap-3 pb-3 border-b border-zinc-800">
              <div>
                <div className="text-xs font-mono text-zinc-400">
                  #{threadModal.number} &bull; {threadModal.state.toUpperCase()} &bull; @{threadModal.author}
                </div>
                <h3 className="text-base font-bold text-white mt-0.5">{threadModal.title}</h3>
              </div>
              <div className="flex items-center gap-2">
                <a
                  href={threadModal.htmlUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-xs text-white flex items-center gap-1"
                >
                  <span>Open on GitHub</span>
                  <ExternalLink className="w-3 h-3" />
                </a>
                <button
                  type="button"
                  onClick={() => setThreadModal(null)}
                  className="p-1.5 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto py-4 space-y-3 text-xs">
              {loadingThread ? (
                <div className="flex items-center gap-2 text-zinc-400">
                  <Loader2 className="w-4 h-4 animate-spin text-indigo-400" />
                  <span>Loading thread from GitHub...</span>
                </div>
              ) : (
                <>
                  <div className="p-3.5 rounded-xl bg-zinc-950 border border-zinc-800 text-zinc-200 whitespace-pre-wrap leading-relaxed">
                    {threadModal.body || "No description provided."}
                  </div>
                  {threadModal.comments.map((c) => (
                    <div key={c.id} className="p-3 rounded-xl bg-zinc-950/70 border border-zinc-800/80 space-y-1">
                      <div className="text-[11px] font-mono text-zinc-400">
                        @{c.author} &bull; {new Date(c.createdAt).toLocaleString()}
                      </div>
                      <div className="text-zinc-200 whitespace-pre-wrap">{c.body}</div>
                    </div>
                  ))}
                </>
              )}
            </div>
          </div>
        </div>,
        document.body
      )}
    </WorkspaceShell>
  );
}
