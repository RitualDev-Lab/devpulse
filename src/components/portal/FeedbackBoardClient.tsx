"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import {
  ChevronUp,
  Plus,
  Sparkles,
  Tag,
  CheckCircle2,
  Loader2,
  Code2,
} from "lucide-react";
import { PUBLIC_APP_URL } from "@/lib/config/app-url";

export interface FeatureRequestItem {
  id: string;
  title: string;
  description: string;
  category: "feature" | "improvement" | "integration" | "sdk";
  status: "open" | "planned" | "in_progress" | "shipped";
  targetVersion: string | null;
  releaseUrl?: string | null;
  voteCount: number;
  authorName: string | null;
  viewerVoted: boolean;
  createdAt: string;
}

const STATUS_BADGE: Record<
  FeatureRequestItem["status"],
  { label: string; cls: string }
> = {
  open: { label: "Under Review", cls: "bg-zinc-800 text-zinc-300 border-zinc-700" },
  planned: { label: "Planned", cls: "bg-indigo-500/15 text-indigo-300 border-indigo-500/30" },
  in_progress: { label: "In Progress", cls: "bg-amber-500/15 text-amber-300 border-amber-500/30" },
  shipped: { label: "Shipped", cls: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30" },
};

export function FeedbackBoardClient({
  projectSlug,
  projectName,
  compact = false,
}: {
  projectSlug: string;
  projectName: string;
  compact?: boolean;
}) {
  const [items, setItems] = useState<FeatureRequestItem[]>([]);
  const [releases, setReleases] = useState<Array<{ version: string; url: string | null }>>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [filterStatus, setFilterStatus] = useState<string>("all");

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState<FeatureRequestItem["category"]>("feature");
  const [targetVersion, setTargetVersion] = useState("");
  const [authorName, setAuthorName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void fetch(`/api/v1/feedback?projectSlug=${encodeURIComponent(projectSlug)}`)
      .then(async (res) => {
        const data = await res.json();
        if (res.ok && !cancelled) { setItems(data.items || []); setReleases(data.releases || []); }
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [projectSlug]);

  const handleToggleVote = async (featureId: string) => {
    // Optimistic update
    setItems((prev) =>
      prev
        .map((item) => {
          if (item.id !== featureId) return item;
          const voted = !item.viewerVoted;
          return {
            ...item,
            viewerVoted: voted,
            voteCount: Math.max(0, item.voteCount + (voted ? 1 : -1)),
          };
        })
        .sort((a, b) => b.voteCount - a.voteCount)
    );

    const res = await fetch("/api/v1/feedback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "upvote", featureId }),
    });

    if (res.ok) {
      const data = await res.json();
      setItems((prev) =>
        prev
          .map((item) =>
            item.id === featureId
              ? { ...item, viewerVoted: data.voted, voteCount: data.voteCount }
              : item
          )
          .sort((a, b) => b.voteCount - a.voteCount)
      );
    }
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !description.trim()) return;
    setSubmitting(true);
    setNotice(null);
    try {
      const res = await fetch("/api/v1/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "create",
          projectSlug,
          title: title.trim(),
          description: description.trim(),
          category,
          targetVersion: targetVersion.trim() || null,
          authorName: authorName.trim() || null,
        }),
      });
      const data = await res.json();
      if (res.ok && data.item) {
        setItems((prev) => [data.item, ...prev].sort((a, b) => b.voteCount - a.voteCount));
        setTitle("");
        setDescription("");
        setTargetVersion("");
        setShowForm(false);
        setNotice("Feature request posted & upvoted!");
      } else {
        setNotice(data.error || "Could not submit feature request.");
      }
    } finally {
      setSubmitting(false);
    }
  };

  const visibleItems =
    filterStatus === "all" ? items : items.filter((i) => i.status === filterStatus);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-bold text-white flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-indigo-400" />
            <span>{projectName} Feature Voting &amp; Roadmap</span>
          </h2>
          {!compact && (
            <p className="text-xs text-zinc-400 mt-0.5">
              Upvote top ideas or propose improvements tied to upcoming package releases.
            </p>
          )}
        </div>

        <button
          type="button"
          onClick={() => setShowForm((v) => !v)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold transition"
        >
          <Plus className="w-3.5 h-3.5" />
          <span>{showForm ? "Cancel" : "Request Feature"}</span>
        </button>
      </div>

      {/* Filter pills */}
      <div className="flex flex-wrap items-center gap-1.5">
        {(["all", "open", "planned", "in_progress", "shipped"] as const).map((st) => (
          <button
            key={st}
            type="button"
            onClick={() => setFilterStatus(st)}
            className={`px-2.5 py-1 rounded-lg text-[11px] font-medium transition border ${
              filterStatus === st
                ? "bg-indigo-600/20 border-indigo-500/40 text-indigo-200"
                : "bg-zinc-950 border-zinc-800 text-zinc-400 hover:text-white"
            }`}
          >
            {st === "all" ? `All (${items.length})` : STATUS_BADGE[st].label}
          </button>
        ))}
      </div>

      {notice && (
        <div className="p-2.5 rounded-xl bg-emerald-950/50 border border-emerald-700/60 text-xs text-emerald-200 flex items-center gap-2">
          <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
          <span>{notice}</span>
        </div>
      )}

      {showForm && (
        <form
          onSubmit={handleCreate}
          className="p-4 rounded-2xl bg-zinc-950/90 border border-zinc-800 space-y-3"
        >
          <input
            type="text"
            required
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Feature title (e.g., Support OTLP gRPC export in Python SDK)"
            className="w-full px-3 py-2 rounded-xl bg-zinc-900 border border-zinc-800 text-xs text-white focus:outline-none focus:border-indigo-500"
          />
          <textarea
            required
            rows={3}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Describe your use case and expected outcome..."
            className="w-full px-3 py-2 rounded-xl bg-zinc-900 border border-zinc-800 text-xs text-white focus:outline-none focus:border-indigo-500"
          />
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value as FeatureRequestItem["category"])}
              className="px-3 py-2 rounded-xl bg-zinc-900 border border-zinc-800 text-xs text-white"
            >
              <option value="feature">New Feature</option>
              <option value="improvement">Improvement</option>
              <option value="integration">Integration</option>
              <option value="sdk">SDK / CLI</option>
            </select>
            <input
              type="text"
              list={`releases-${projectSlug}`}
              value={targetVersion}
              onChange={(e) => setTargetVersion(e.target.value)}
              placeholder="Target version (optional)"
              className="px-3 py-2 rounded-xl bg-zinc-900 border border-zinc-800 text-xs text-white"
            />
            <datalist id={`releases-${projectSlug}`}>
              {releases.map((rel) => (
                <option key={rel.version} value={rel.version} />
              ))}
            </datalist>
            <input
              type="text"
              value={authorName}
              onChange={(e) => setAuthorName(e.target.value)}
              placeholder="Your name / @handle"
              className="px-3 py-2 rounded-xl bg-zinc-900 border border-zinc-800 text-xs text-white"
            />
          </div>
          <div className="flex justify-end">
            <button
              type="submit"
              disabled={submitting}
              className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold flex items-center gap-1.5 disabled:opacity-50"
            >
              {submitting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
              <span>Submit Idea</span>
            </button>
          </div>
        </form>
      )}

      {loading ? (
        <div className="py-8 flex items-center justify-center text-xs text-zinc-400 gap-2">
          <Loader2 className="w-4 h-4 animate-spin" />
          <span>Loading feature board...</span>
        </div>
      ) : visibleItems.length === 0 ? (
        <div className="p-6 rounded-2xl bg-zinc-950/70 border border-zinc-800 text-center text-xs text-zinc-400">
          No feature requests yet. Be the first to suggest a roadmap item!
        </div>
      ) : (
        <div className="space-y-2.5">
          {visibleItems.map((item) => {
            const st = STATUS_BADGE[item.status] || STATUS_BADGE.open;
            return (
              <div
                key={item.id}
                className="p-3.5 rounded-2xl bg-zinc-950/80 border border-zinc-800/90 flex items-start gap-3"
              >
                <button
                  type="button"
                  onClick={() => handleToggleVote(item.id)}
                  className={`shrink-0 w-12 py-2 rounded-xl border flex flex-col items-center justify-center transition ${
                    item.viewerVoted
                      ? "bg-indigo-600/20 border-indigo-500/60 text-indigo-300"
                      : "bg-zinc-900 border-zinc-800 text-zinc-400 hover:text-white hover:border-zinc-700"
                  }`}
                >
                  <ChevronUp className="w-4 h-4" />
                  <span className="text-xs font-bold font-mono">{item.voteCount}</span>
                </button>

                <div className="flex-1 min-w-0 space-y-1.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-xs sm:text-sm font-bold text-white">{item.title}</h3>
                    <span className={`px-2 py-0.5 rounded-full text-[10px] border font-semibold ${st.cls}`}>
                      {st.label}
                    </span>
                    <span className="px-2 py-0.5 rounded-full text-[10px] bg-zinc-900 border border-zinc-800 text-zinc-400 font-mono">
                      {item.category}
                    </span>
                    {item.targetVersion && (
                      <span className="px-2 py-0.5 rounded-full text-[10px] bg-cyan-500/10 border border-cyan-500/30 text-cyan-300 font-mono flex items-center gap-1">
                        <Tag className="w-2.5 h-2.5" />
                        {item.targetVersion}
                      </span>
                    )}
                    {item.status === "shipped" && item.releaseUrl && <Link href={item.releaseUrl} target="_blank" rel="noreferrer" className="text-[10px] text-emerald-300 hover:underline">View release</Link>}
                  </div>
                  <p className="text-xs text-zinc-400 leading-relaxed">{item.description}</p>
                  {item.authorName && (
                    <div className="text-[10px] text-zinc-500">Submitted by {item.authorName}</div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {!compact && (
        <div className="p-3 rounded-xl bg-zinc-950 border border-zinc-800/80 flex flex-wrap items-center justify-between gap-2 text-[11px] text-zinc-400">
          <span className="flex items-center gap-1.5">
            <Code2 className="w-3.5 h-3.5 text-cyan-400" />
            Embeddable widget:
          </span>
          <code className="font-mono text-[10px] text-emerald-300 bg-zinc-900 px-2 py-1 rounded-lg border border-zinc-800">
            {`<iframe src="${PUBLIC_APP_URL}/embed/feedback/${projectSlug}" width="100%" height="560"></iframe>`}
          </code>
        </div>
      )}
    </div>
  );
}
