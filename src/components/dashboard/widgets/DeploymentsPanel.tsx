"use client";

import React, { useState, useEffect, useCallback } from "react";
import {
  Rocket,
  GitCommit,
  RotateCcw,
  Copy,
  Check,
  Plus,
  ExternalLink,
  ShieldCheck,
  AlertTriangle,
  Loader2,
} from "lucide-react";

interface DeploymentRow {
  id: string;
  provider: string;
  version: string;
  commitSha: string | null;
  branch: string | null;
  deployer: string | null;
  environment: string;
  status: "success" | "failure" | "pending" | "rolled_back";
  changelogSummary: string | null;
  deploymentUrl: string | null;
  rollbackUrl: string | null;
  totalSessions: number;
  crashCount: number;
  crashFreeRate: number | null;
  deployedAt: string;
}

export function DeploymentsPanel({
  projectId,
  telemetryApiKey,
  isDemo = false,
}: {
  projectId: string;
  telemetryApiKey?: string | null;
  isDemo?: boolean;
}) {
  const [items, setItems] = useState<DeploymentRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [copiedUrl, setCopiedUrl] = useState(false);

  // Manual deploy form
  const [showForm, setShowForm] = useState(false);
  const [version, setVersion] = useState("v1.2.1");
  const [commitSha, setCommitSha] = useState("");
  const [provider, setProvider] = useState("github_actions");
  const [changelogSummary, setChangelogSummary] = useState("");

  const loadDeployments = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/v1/deployments?projectId=${encodeURIComponent(projectId)}`);
      const d = await res.json();
      if (res.ok) setItems(d.deployments || []);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    loadDeployments();
  }, [loadDeployments]);

  const webhookEndpoint = `${typeof window !== "undefined" ? window.location.origin : ""}/api/v1/webhooks/deploy`;
  // The key travels in a header, not the URL, so the copied snippet sends it that way.
  const webhookCurl = `curl -X POST "${webhookEndpoint}" -H "Authorization: Bearer ${telemetryApiKey || "YOUR_API_KEY"}"`;

  const handleRecordDeploy = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isDemo) return;
    setBusyId("create");
    setMsg(null);
    try {
      const res = await fetch("/api/v1/deployments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId,
          action: "record_deploy",
          version,
          commitSha: commitSha || undefined,
          provider,
          changelogSummary: changelogSummary || undefined,
        }),
      });
      if (!res.ok) throw new Error((await res.json()).error || "Failed");
      setShowForm(false);
      setCommitSha("");
      setChangelogSummary("");
      setMsg(`Deployment ${version} recorded.`);
      await loadDeployments();
    } catch (err: any) {
      setMsg(err.message);
    } finally {
      setBusyId(null);
    }
  };

  const handleRollback = async (dep: DeploymentRow) => {
    if (isDemo) {
      setMsg("Sign in to trigger 1-click GitHub rollbacks.");
      return;
    }
    setBusyId(dep.id);
    setMsg(null);
    try {
      const res = await fetch("/api/v1/deployments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, action: "rollback", deploymentId: dep.id }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Rollback failed");
      setMsg(d.message || `Rolled back ${dep.version}.`);
      await loadDeployments();
    } catch (err: any) {
      setMsg(err.message);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="p-5 rounded-2xl bg-zinc-900/90 border border-zinc-800 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-bold text-white flex items-center gap-2">
            <Rocket className="w-4 h-4 text-indigo-400" />
            <span>Release Deployments &amp; 1-Click GitHub Rollback</span>
          </h3>
          <p className="text-xs text-zinc-400 mt-0.5">
            Track GitHub Actions, Vercel, Railway &amp; Fly.io deploys with per-deploy crash-free deltas and automated GitHub revert PRs.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => {
              navigator.clipboard.writeText(webhookCurl);
              setCopiedUrl(true);
              setTimeout(() => setCopiedUrl(false), 1500);
            }}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-zinc-950 hover:bg-zinc-800 border border-zinc-800 text-xs text-zinc-200 font-semibold"
          >
            {copiedUrl ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
            <span>Copy CI Deploy Webhook</span>
          </button>
          {!isDemo && (
            <button
              type="button"
              onClick={() => setShowForm((s) => !s)}
              className="flex items-center gap-1 px-3 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Record Deploy</span>
            </button>
          )}
        </div>
      </div>

      {msg && (
        <div className="p-2.5 rounded-xl bg-zinc-950 border border-zinc-800 text-xs text-indigo-200">
          {msg}
        </div>
      )}

      {showForm && (
        <form
          onSubmit={handleRecordDeploy}
          className="p-4 rounded-xl bg-zinc-950 border border-zinc-800 grid grid-cols-1 sm:grid-cols-4 gap-2"
        >
          <input
            type="text"
            required
            value={version}
            onChange={(e) => setVersion(e.target.value)}
            placeholder="Release (e.g. v1.2.1)"
            className="px-3 py-1.5 rounded-lg bg-zinc-900 border border-zinc-800 text-xs text-white font-mono"
          />
          <select
            value={provider}
            onChange={(e) => setProvider(e.target.value)}
            className="px-3 py-1.5 rounded-lg bg-zinc-900 border border-zinc-800 text-xs text-white"
          >
            <option value="github_actions">GitHub Actions</option>
            <option value="vercel">Vercel</option>
            <option value="railway">Railway</option>
            <option value="fly">Fly.io</option>
            <option value="manual">Manual</option>
          </select>
          <input
            type="text"
            value={commitSha}
            onChange={(e) => setCommitSha(e.target.value)}
            placeholder="Commit SHA (optional)"
            className="px-3 py-1.5 rounded-lg bg-zinc-900 border border-zinc-800 text-xs text-white font-mono"
          />
          <button
            type="submit"
            disabled={busyId === "create"}
            className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold"
          >
            Save Deploy
          </button>
          <input
            type="text"
            value={changelogSummary}
            onChange={(e) => setChangelogSummary(e.target.value)}
            placeholder="What changed in this deploy?"
            className="sm:col-span-4 px-3 py-1.5 rounded-lg bg-zinc-900 border border-zinc-800 text-xs text-white"
          />
        </form>
      )}

      <div className="space-y-2">
        {loading && items.length === 0 ? (
          <div className="text-xs text-zinc-500 py-4">Loading deployment history...</div>
        ) : items.length === 0 ? (
          <div className="p-4 rounded-xl bg-zinc-950 border border-zinc-800 text-xs text-zinc-400">
            No webhook deployments logged yet. Connect GitHub Actions, Vercel, Railway, or Fly.io to track every release and rollback cleanly.
          </div>
        ) : (
          items.map((dep, idx) => {
            const prev = items[idx + 1];
            const delta =
              prev && dep.crashFreeRate !== null && prev.crashFreeRate !== null
                ? Number((dep.crashFreeRate - prev.crashFreeRate).toFixed(2))
                : null;
            const healthy = dep.crashFreeRate !== null && dep.crashFreeRate >= 98;

            return (
              <div
                key={dep.id}
                className="p-3.5 rounded-xl bg-zinc-950 border border-zinc-800 flex flex-wrap items-center justify-between gap-3 text-xs"
              >
                <div className="min-w-0 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono font-bold text-white">{dep.version}</span>
                    <span className="px-2 py-0.5 rounded bg-zinc-900 border border-zinc-800 text-[10px] uppercase text-cyan-300 font-semibold">
                      {dep.provider.replace("_", " ")}
                    </span>
                    {dep.commitSha && (
                      <span className="inline-flex items-center gap-1 text-[10px] font-mono text-zinc-400">
                        <GitCommit className="w-3 h-3" />
                        {dep.commitSha.slice(0, 7)}
                      </span>
                    )}
                    <span
                      className={`text-[10px] uppercase font-bold px-2 py-0.5 rounded-full ${
                        dep.status === "rolled_back"
                          ? "bg-amber-500/20 text-amber-300"
                          : dep.status === "failure"
                          ? "bg-red-500/20 text-red-300"
                          : "bg-emerald-500/15 text-emerald-300"
                      }`}
                    >
                      {dep.status.replace("_", " ")}
                    </span>
                  </div>
                  <div className="text-[11px] text-zinc-400">
                    Deployed by <strong className="text-zinc-200">@{dep.deployer || "ci"}</strong> •{" "}
                    {dep.deployedAt.slice(0, 16).replace("T", " ")}
                    {dep.changelogSummary ? ` — ${dep.changelogSummary}` : ""}
                  </div>
                </div>

                <div className="flex items-center gap-3 shrink-0">
                  <div className="text-right">
                    <div
                      className={`inline-flex items-center gap-1 font-mono font-bold ${
                        healthy ? "text-emerald-400" : "text-amber-400"
                      }`}
                    >
                      {healthy ? (
                        <ShieldCheck className="w-3.5 h-3.5" />
                      ) : (
                        <AlertTriangle className="w-3.5 h-3.5" />
                      )}
                      <span>{dep.crashFreeRate === null ? "No session data" : `${dep.crashFreeRate}% crash-free`}</span>
                    </div>
                    {delta !== null && (
                      <div
                        className={`text-[10px] font-mono ${
                          delta >= 0 ? "text-emerald-400" : "text-red-400"
                        }`}
                      >
                        {delta >= 0 ? `+${delta}%` : `${delta}%`} vs {prev.version}
                      </div>
                    )}
                  </div>

                  {dep.rollbackUrl && (
                    <a
                      href={dep.rollbackUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-zinc-900 border border-zinc-700 text-[11px] text-cyan-300 hover:underline"
                    >
                      <span>Revert PR</span>
                      <ExternalLink className="w-3 h-3" />
                    </a>
                  )}

                  {!isDemo && dep.status !== "rolled_back" && (
                    <button
                      type="button"
                      disabled={busyId === dep.id}
                      onClick={() => handleRollback(dep)}
                      className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-red-950/60 hover:bg-red-900/70 border border-red-800/60 text-red-200 text-[11px] font-semibold"
                    >
                      {busyId === dep.id ? (
                        <Loader2 className="w-3 h-3 animate-spin" />
                      ) : (
                        <RotateCcw className="w-3 h-3" />
                      )}
                      <span>Rollback</span>
                    </button>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
