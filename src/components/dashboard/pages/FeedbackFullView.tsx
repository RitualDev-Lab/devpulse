"use client";

import React, { useCallback, useEffect, useState } from "react";
import { ExternalLink, MessageSquare, RefreshCw } from "lucide-react";
import { FeedbackBoardClient } from "@/components/portal/FeedbackBoardClient";
import type { LoadedWorkspaceReady } from "@/lib/dashboard/load-workspace";
import { WorkspaceShell } from "../WorkspaceShell";

interface FeedbackItem {
  id: string;
  title: string;
  description: string;
  status: "open" | "planned" | "in_progress" | "shipped";
  targetVersion: string | null;
  releaseUrl: string | null;
  voteCount: number;
}

interface Release { version: string; url: string | null; createdAt: string }

const DEMO_FEEDBACK_ITEMS: FeedbackItem[] = [
  {
    id: "demo_fb_1",
    title: "Native OpenTelemetry gRPC Collector Endpoint",
    description: "Accept protobuf OTLP/gRPC spans alongside HTTP JSON so Go & Rust microservices need zero sidecars.",
    status: "shipped",
    targetVersion: "v1.4.0",
    releaseUrl: "https://github.com/RitualDev-Lab/devpulse/releases",
    voteCount: 42,
  },
  {
    id: "demo_fb_2",
    title: "GitLab Self-Hosted Merge Request Bot Comments",
    description: "Post automated CWV deltas and new CVEs directly onto GitLab MR discussions.",
    status: "in_progress",
    targetVersion: "v1.5.0",
    releaseUrl: null,
    voteCount: 31,
  },
  {
    id: "demo_fb_3",
    title: "Weekly Slack Digest with Cost-per-Tool Sparkline",
    description: "Summarize MCP token spend and P95 latency spikes in a single Monday morning Slack block.",
    status: "planned",
    targetVersion: "v1.6.0",
    releaseUrl: null,
    voteCount: 19,
  },
  {
    id: "demo_fb_4",
    title: "Terraform Provider for Monitors & Alert Rules",
    description: "Manage heartbeat crons and PagerDuty routing as code.",
    status: "open",
    targetVersion: null,
    releaseUrl: null,
    voteCount: 14,
  },
];

const DEMO_RELEASES: Release[] = [
  { version: "v1.4.2", url: "https://github.com/RitualDev-Lab/devpulse/releases", createdAt: "2026-11-24T00:00:00Z" },
  { version: "v1.4.0", url: "https://github.com/RitualDev-Lab/devpulse/releases", createdAt: "2026-11-18T00:00:00Z" },
];

export function FeedbackFullView({ workspace }: { workspace: LoadedWorkspaceReady }) {
  const { initialData, projects, customDomain, storageTier, isDemo } = workspace;
  const project = initialData.project;
  const [items, setItems] = useState<FeedbackItem[]>(isDemo ? DEMO_FEEDBACK_ITEMS : []);
  const [releases, setReleases] = useState<Release[]>(isDemo ? DEMO_RELEASES : []);
  const [viewMode, setViewMode] = useState<"kanban" | "list">("kanban");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (isDemo) {
      setItems(DEMO_FEEDBACK_ITEMS);
      setReleases(DEMO_RELEASES);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/v1/feedback?projectId=${encodeURIComponent(project.id)}`);
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Could not load feedback");
      setItems(body.items || []);
      setReleases(body.releases || []);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load feedback");
    } finally {
      setLoading(false);
    }
  }, [project.id, isDemo]);

  useEffect(() => {
    if (isDemo) {
      setItems(DEMO_FEEDBACK_ITEMS);
      setReleases(DEMO_RELEASES);
      return;
    }
    let cancelled = false;
    void fetch(`/api/v1/feedback?projectId=${encodeURIComponent(project.id)}`)
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || "Could not load feedback");
        if (!cancelled) { setItems(body.items || []); setReleases(body.releases || []); }
      })
      .catch((cause: unknown) => { if (!cancelled) setError(cause instanceof Error ? cause.message : "Could not load feedback"); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [project.id, isDemo]);

  const update = async (item: FeedbackItem, patch: Partial<FeedbackItem>) => {
    const response = await fetch("/api/v1/feedback", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId: project.id, featureId: item.id, ...patch }),
    });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || "Could not update feature request");
    setItems((current) => current.map((row) => row.id === item.id ? { ...row, ...patch } : row));
  };

  return <WorkspaceShell currentProject={{ ...project, telemetryApiKey: project.telemetryApiKey }} projects={projects} storageTier={storageTier} customDomain={customDomain} isDemo={isDemo}>
    <div className="space-y-5">
      <header className="flex items-start justify-between gap-3">
        <div><h1 className="text-2xl font-extrabold text-white flex items-center gap-2"><MessageSquare className="w-6 h-6 text-indigo-400" /> Feedback → Release loop</h1><p className="text-xs text-zinc-400 mt-1">Triage public requests, link shipped work to an actual release, and publish those links in the changelog.</p></div>
        <button type="button" onClick={() => void load()} disabled={loading} className="px-3 py-2 rounded-lg bg-zinc-800 text-xs text-zinc-200 flex items-center gap-1.5"><RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} /> Refresh</button>
      </header>
      {error && <p role="alert" className="text-xs text-red-300">{error}</p>}
      <section className="p-4 rounded-2xl bg-zinc-900 border border-zinc-800 space-y-3">
        <h2 className="text-sm font-bold text-white">Public feedback board</h2>
        <FeedbackBoardClient projectSlug={project.slug} projectName={project.name} isDemo={isDemo} />
      </section>
      <section className="p-4 rounded-2xl bg-zinc-900 border border-zinc-800 space-y-3">
        <h2 className="text-sm font-bold text-white">Published releases</h2>
        {releases.length ? releases.map((release) => <div key={`${release.version}-${release.createdAt}`} className="flex items-center justify-between gap-3 p-3 rounded-xl bg-zinc-950 border border-zinc-800"><span className="font-mono text-sm text-emerald-300">{release.version}</span>{release.url && <a href={release.url} target="_blank" rel="noreferrer" className="text-xs text-cyan-300 inline-flex items-center gap-1">Deployment <ExternalLink className="w-3 h-3" /></a>}</div>) : <p className="text-xs text-zinc-500">No successful deployments recorded yet. Register releases through the SDK or deployment integration.</p>}
      </section>
      <section className="p-4 rounded-2xl bg-zinc-900 border border-zinc-800 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-bold text-white">Roadmap &amp; Feature Requests ({items.length})</h2>
          <div className="flex items-center gap-1 bg-zinc-950 p-1 rounded-xl border border-zinc-800 text-[11px]">
            <button
              type="button"
              onClick={() => setViewMode("kanban")}
              className={`px-2.5 py-1 rounded-lg font-semibold transition ${
                viewMode === "kanban" ? "bg-indigo-600 text-white" : "text-zinc-400 hover:text-white"
              }`}
            >
              Kanban Board
            </button>
            <button
              type="button"
              onClick={() => setViewMode("list")}
              className={`px-2.5 py-1 rounded-lg font-semibold transition ${
                viewMode === "list" ? "bg-indigo-600 text-white" : "text-zinc-400 hover:text-white"
              }`}
            >
              Triage List
            </button>
          </div>
        </div>

        {items.length === 0 ? (
          <p className="text-xs text-zinc-500">{loading ? "Loading requests…" : "No requests submitted yet."}</p>
        ) : viewMode === "kanban" ? (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
            {(
              [
                { key: "open", label: "Under Review", badge: "text-zinc-300 bg-zinc-800" },
                { key: "planned", label: "Planned", badge: "text-cyan-300 bg-cyan-500/15" },
                { key: "in_progress", label: "In Progress", badge: "text-amber-300 bg-amber-500/15" },
                { key: "shipped", label: "Shipped", badge: "text-emerald-300 bg-emerald-500/15" },
              ] as const
            ).map((col) => {
              const colItems = items.filter((i) => i.status === col.key);
              return (
                <div key={col.key} className="p-3 rounded-xl bg-zinc-950/90 border border-zinc-800 space-y-2.5">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-white">{col.label}</span>
                    <span className={`text-[10px] px-2 py-0.5 rounded-full font-mono ${col.badge}`}>
                      {colItems.length}
                    </span>
                  </div>
                  <div className="space-y-2">
                    {colItems.length === 0 ? (
                      <div className="text-[11px] text-zinc-600 py-3 text-center border border-dashed border-zinc-800 rounded-lg">
                        Empty
                      </div>
                    ) : (
                      colItems.map((item) => (
                        <div key={item.id} className="p-2.5 rounded-lg bg-zinc-900 border border-zinc-800 space-y-1.5">
                          <div className="text-xs font-semibold text-white leading-snug">{item.title}</div>
                          <p className="text-[11px] text-zinc-400 line-clamp-2">{item.description}</p>
                          <div className="flex items-center justify-between gap-2 pt-1 text-[10px] font-mono">
                            <span className="text-indigo-300">{item.voteCount} votes</span>
                            {item.targetVersion && (
                              <span className="px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-300">
                                {item.targetVersion}
                              </span>
                            )}
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          items.map((item) => <article key={item.id} className="p-3 rounded-xl bg-zinc-950 border border-zinc-800 space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2"><div><h3 className="text-sm font-semibold text-white">{item.title}</h3><p className="text-[11px] text-zinc-500">{item.voteCount} votes · {item.id}</p></div><label className="text-[10px] text-zinc-400">Status <select disabled={isDemo} value={item.status} onChange={(event) => void update(item, { status: event.target.value as FeedbackItem["status"] }).catch((cause) => setError(cause.message))} className="ml-2 px-2 py-1 rounded bg-zinc-900 border border-zinc-700 text-zinc-200"><option value="open">Under review</option><option value="planned">Planned</option><option value="in_progress">In progress</option><option value="shipped">Shipped</option></select></label></div>
            <p className="text-xs text-zinc-400">{item.description}</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <label className="text-[10px] text-zinc-500">Linked version<input disabled={isDemo} list={`release-list-${project.id}`} value={item.targetVersion || ""} onBlur={(event) => { const targetVersion = event.target.value.trim() || null; if (targetVersion !== item.targetVersion) void update(item, { targetVersion }).catch((cause) => setError(cause.message)); }} placeholder="e.g. 2.4.0" className="mt-1 w-full px-2.5 py-2 rounded-lg bg-zinc-900 border border-zinc-700 text-xs text-white" /></label>
              <label className="text-[10px] text-zinc-500">Release / changelog URL<input disabled={isDemo || item.status !== "shipped"} key={`${item.id}-${item.releaseUrl || ""}`} defaultValue={item.releaseUrl || ""} onBlur={(event) => { const releaseUrl = event.target.value.trim() || null; if (releaseUrl !== item.releaseUrl) void update(item, { releaseUrl }).catch((cause) => setError(cause.message)); }} placeholder="https://…" className="mt-1 w-full px-2.5 py-2 rounded-lg bg-zinc-900 border border-zinc-700 text-xs text-white disabled:opacity-50" /></label>
            </div>
            {item.status === "shipped" && item.releaseUrl && <a href={item.releaseUrl} target="_blank" rel="noreferrer" className="text-[11px] text-emerald-300 inline-flex items-center gap-1">Published release link <ExternalLink className="w-3 h-3" /></a>}
          </article>)
        )}
        <datalist id={`release-list-${project.id}`}>{releases.map((release) => <option key={release.version} value={release.version} />)}</datalist>
      </section>
    </div>
  </WorkspaceShell>;
}
