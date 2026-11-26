"use client";

import React, { useState, useEffect, useCallback } from "react";
import {
  Flag,
  Plus,
  Trash2,
  ShieldAlert,
  CheckCircle2,
  Code2,
  Copy,
  Check,
  RefreshCw,
} from "lucide-react";
import type { LoadedWorkspaceReady } from "@/lib/dashboard/load-workspace";
import { WorkspaceShell } from "../WorkspaceShell";
import { maskApiKey } from "@/lib/security/mask-key";

interface AbStat {
  variant: string;
  weight: number;
  exposures: number;
  conversions: number;
  conversionRate: number;
  crashes: number;
  status: "control" | "insufficient_data" | "significant_positive" | "significant_negative" | "inconclusive";
  differencePoints: number | null;
  ciLowerPoints: number | null;
  ciUpperPoints: number | null;
}

interface ExperimentSummary {
  available: boolean;
  reason: string | null;
  controlVariant: string | null;
  minUsersPerArm: number;
  excludedCrossVariantUsers: number;
}

const EXPERIMENT_STATUS_LABEL: Record<AbStat["status"], string> = {
  control: "control",
  insufficient_data: "collecting data",
  significant_positive: "significant win",
  significant_negative: "significant loss",
  inconclusive: "no clear difference",
};

interface FlagRow {
  id: string;
  key: string;
  description: string | null;
  isEnabled: boolean;
  rolloutPercent: number;
  autoRollbackEnabled: boolean;
  crashRateThresholdPercent: number;
  status: "active" | "rolled_back" | "paused";
  rollbackReason: string | null;
  totalExposures: number;
  totalCrashes: number;
  abStats: AbStat[];
  experiment: ExperimentSummary;
}

export function FlagsFullView({ workspace }: { workspace: LoadedWorkspaceReady }) {
  const { initialData, projects, customDomain, storageTier, isDemo } = workspace;
  const project = initialData.project;

  const [flags, setFlags] = useState<FlagRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [copiedSdk, setCopiedSdk] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  // Create flag form
  const [key, setKey] = useState("new-checkout");
  const [description, setDescription] = useState("Stripe Payment Element v2 flow");
  const [rolloutPercent, setRolloutPercent] = useState(25);
  const [crashThreshold, setCrashThreshold] = useState(5);
  const [autoRollback, setAutoRollback] = useState(true);

  const loadFlags = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/v1/flags?projectId=${encodeURIComponent(project.id)}`);
      const d = await res.json();
      if (res.ok) setFlags(d.flags || []);
    } finally {
      setLoading(false);
    }
  }, [project.id]);

  useEffect(() => {
    loadFlags();
  }, [loadFlags]);

  const handleCreateFlag = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isDemo || !key.trim()) return;
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/v1/flags", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId: project.id,
          action: "create_flag",
          key,
          description,
          rolloutPercent,
          crashRateThresholdPercent: crashThreshold,
          autoRollbackEnabled: autoRollback,
        }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Failed to create flag");
      setMsg(`Feature flag '${key}' created with A/B control/treatment variants.`);
      await loadFlags();
    } catch (err: any) {
      setMsg(err.message);
    } finally {
      setBusy(false);
    }
  };

  const handleUpdateRollout = async (flag: FlagRow, nextPct: number, nextEnabled: boolean) => {
    if (isDemo) return;
    setBusy(true);
    try {
      await fetch("/api/v1/flags", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId: project.id,
          action: "update_rollout",
          flagId: flag.id,
          rolloutPercent: nextPct,
          isEnabled: nextEnabled,
        }),
      });
      await loadFlags();
    } finally {
      setBusy(false);
    }
  };

  const sdkCode = `import { DevPulse } from "@ritualdev/devpulse";
const pulse = new DevPulse({ apiKey: "${maskApiKey(project.telemetryApiKey, "YOUR_API_KEY")}" }).init();

if (await pulse.flag("new-checkout", { userId: "usr_123" })) {
  const variant = await pulse.getFlagVariant("new-checkout", "usr_123"); // "control" | "treatment"
  renderCheckoutV2(variant);
}`;

  return (
    <WorkspaceShell
      currentProject={{ ...project, telemetryApiKey: project.telemetryApiKey }}
      projects={projects}
      storageTier={storageTier}
      customDomain={customDomain}
      isDemo={isDemo}
    >
      <div className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-extrabold text-white flex items-center gap-2.5">
              <Flag className="w-6 h-6 text-indigo-400" />
              <span>Feature Flags, A/B Testing &amp; Crash Auto-Rollback</span>
            </h1>
            <p className="text-xs text-zinc-400 mt-0.5">
              Percentage rollouts &amp; A/B experiment variants that auto-rollback if correlated crashes spike.
            </p>
          </div>
          {!isDemo && (
            <button
              type="button"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                const r = await fetch("/api/v1/flags", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ projectId: project.id, action: "check_rollback" }),
                });
                const d = await r.json();
                setMsg(
                  d.rolledBack?.length
                    ? `Auto-rolled back flags: ${d.rolledBack.join(", ")}`
                    : "All active rollouts are below crash-rate threshold."
                );
                await loadFlags();
                setBusy(false);
              }}
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-amber-600/20 hover:bg-amber-600/35 border border-amber-500/40 text-amber-200 text-xs font-semibold"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>Evaluate Crash Rollback Guard</span>
            </button>
          )}
        </div>

        {msg && (
          <div className="p-3 rounded-xl bg-zinc-900 border border-zinc-800 text-xs text-indigo-200">
            {msg}
          </div>
        )}

        {/* SDK Snippet */}
        <div className="p-4 rounded-2xl bg-zinc-900/90 border border-zinc-800 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-white flex items-center gap-1.5">
              <Code2 className="w-4 h-4 text-cyan-400" />
              <span>Feature Flag &amp; A/B SDK Usage</span>
            </span>
            <button
              type="button"
              onClick={() => {
                navigator.clipboard.writeText(sdkCode);
                setCopiedSdk(true);
                setTimeout(() => setCopiedSdk(false), 1500);
              }}
              className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-xs text-white"
            >
              {copiedSdk ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
              <span>Copy SDK Code</span>
            </button>
          </div>
          <pre className="p-3 rounded-xl bg-zinc-950 border border-zinc-800 text-[11px] font-mono text-cyan-200 overflow-x-auto">
            {sdkCode}
          </pre>
        </div>

        {/* Create Flag Form */}
        {!isDemo && (
          <form
            onSubmit={handleCreateFlag}
            className="p-5 rounded-2xl bg-zinc-900/90 border border-zinc-800 grid grid-cols-1 sm:grid-cols-5 gap-3 items-end"
          >
            <div>
              <label className="block text-[11px] text-zinc-400 mb-1">Flag Key</label>
              <input
                type="text"
                required
                value={key}
                onChange={(e) => setKey(e.target.value)}
                className="w-full px-3 py-2 rounded-xl bg-zinc-950 border border-zinc-800 text-xs text-white font-mono"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-[11px] text-zinc-400 mb-1">Description</label>
              <input
                type="text"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="w-full px-3 py-2 rounded-xl bg-zinc-950 border border-zinc-800 text-xs text-white"
              />
            </div>
            <div>
              <label className="block text-[11px] text-zinc-400 mb-1">Rollout ({rolloutPercent}%)</label>
              <input
                type="range"
                min="0"
                max="100"
                value={rolloutPercent}
                onChange={(e) => setRolloutPercent(Number(e.target.value))}
                className="w-full accent-indigo-500"
              />
            </div>
            <div>
              <label className="block text-[11px] text-zinc-400 mb-1">
                Rollback Crash % ({crashThreshold}%)
              </label>
              <div className="flex gap-2">
                <input
                  type="number"
                  min="1"
                  max="100"
                  value={crashThreshold}
                  onChange={(e) => setCrashThreshold(Number(e.target.value))}
                  className="w-16 px-2 py-2 rounded-xl bg-zinc-950 border border-zinc-800 text-xs text-white font-mono"
                />
                <button
                  type="submit"
                  disabled={busy}
                  className="flex-1 px-3 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold flex items-center justify-center gap-1"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Create</span>
                </button>
              </div>
            </div>
          </form>
        )}

        {/* Active Flags + A/B Analytics */}
        <div className="space-y-3">
          {loading && flags.length === 0 ? (
            <div className="text-xs text-zinc-500">Loading feature flags...</div>
          ) : flags.length === 0 ? (
            <div className="p-6 rounded-2xl bg-zinc-900/70 border border-zinc-800 text-xs text-zinc-400">
              No feature flags created yet. Add one above to run A/B experiments and tie rollout % to live crash protection.
            </div>
          ) : (
            flags.map((f) => (
              <div
                key={f.id}
                className="p-5 rounded-2xl bg-zinc-900/90 border border-zinc-800 space-y-3"
              >
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <code className="text-sm font-bold text-white font-mono">{f.key}</code>
                      <span
                        className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded-full ${
                          f.status === "rolled_back"
                            ? "bg-red-500/20 text-red-300 border border-red-500/40"
                            : f.isEnabled
                            ? "bg-emerald-500/15 text-emerald-300 border border-emerald-500/30"
                            : "bg-zinc-800 text-zinc-400"
                        }`}
                      >
                        {f.status}
                      </span>
                      {f.autoRollbackEnabled && (
                        <span className="text-[10px] px-2 py-0.5 rounded bg-amber-500/10 text-amber-300 border border-amber-500/25">
                          Auto-Rollback &gt;{f.crashRateThresholdPercent}% crash rate
                        </span>
                      )}
                    </div>
                    {f.description && (
                      <p className="text-xs text-zinc-400 mt-0.5">{f.description}</p>
                    )}
                    {f.rollbackReason && (
                      <p className="text-xs text-red-300 mt-1 flex items-center gap-1">
                        <ShieldAlert className="w-3.5 h-3.5" />
                        <span>{f.rollbackReason}</span>
                      </p>
                    )}
                  </div>

                  {!isDemo && (
                    <div className="flex items-center gap-3">
                      <div className="flex items-center gap-2 text-xs font-mono">
                        <span className="text-zinc-400">Rollout: {f.rolloutPercent}%</span>
                        <input
                          type="range"
                          min="0"
                          max="100"
                          value={f.rolloutPercent}
                          onChange={(e) =>
                            handleUpdateRollout(f, Number(e.target.value), f.isEnabled)
                          }
                          className="w-24 accent-indigo-500"
                        />
                      </div>
                      <button
                        type="button"
                        onClick={() =>
                          handleUpdateRollout(
                            f,
                            f.isEnabled ? f.rolloutPercent : Math.max(25, f.rolloutPercent),
                            !f.isEnabled
                          )
                        }
                        className={`px-3 py-1.5 rounded-lg text-xs font-semibold ${
                          f.isEnabled
                            ? "bg-zinc-800 text-zinc-200 hover:bg-zinc-700"
                            : "bg-emerald-600 text-white hover:bg-emerald-500"
                        }`}
                      >
                        {f.isEnabled ? "Pause" : f.status === "rolled_back" ? "Restore" : "Enable"}
                      </button>
                      <button
                        type="button"
                        onClick={async () => {
                          await fetch("/api/v1/flags", {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({
                              projectId: project.id,
                              action: "delete_flag",
                              flagId: f.id,
                            }),
                          });
                          loadFlags();
                        }}
                        className="p-1.5 text-zinc-500 hover:text-red-400"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  )}
                </div>

                {/* A/B Variant Performance (distinct users, 30-day window) */}
                {!f.experiment.available && f.experiment.reason && (
                  <p className="text-[11px] text-amber-300/90 pt-2 border-t border-zinc-800/70">Experiment readout paused: {f.experiment.reason}</p>
                )}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-2 border-t border-zinc-800/70">
                  {f.abStats.map((ab) => (
                    <div
                      key={ab.variant}
                      className="p-3 rounded-xl bg-zinc-950 border border-zinc-800 flex items-center justify-between text-xs"
                    >
                      <div>
                        <div className="font-mono font-bold text-white flex items-center gap-1.5">
                          <CheckCircle2 className="w-3 h-3 text-indigo-400" />
                          <span>{ab.variant}</span>
                          <span className="text-[10px] text-zinc-500">({ab.weight}%)</span>
                        </div>
                        <div className="text-[11px] text-zinc-400 font-mono mt-0.5">
                          {ab.exposures} users • {ab.conversions} converted ({ab.conversionRate}%)
                        </div>
                        {ab.differencePoints !== null && ab.ciLowerPoints !== null && ab.ciUpperPoints !== null && (
                          <div className="text-[11px] text-zinc-400 font-mono mt-0.5">
                            {ab.differencePoints >= 0 ? "+" : ""}{ab.differencePoints} pp vs control (adjusted CI {ab.ciLowerPoints} to {ab.ciUpperPoints})
                          </div>
                        )}
                        <div className="text-[10px] text-zinc-500 mt-0.5">{EXPERIMENT_STATUS_LABEL[ab.status]}</div>
                      </div>
                      <span
                        className={`font-mono text-xs font-bold ${
                          ab.crashes > 0 ? "text-red-400" : "text-emerald-400"
                        }`}
                      >
                        {ab.crashes} crash(es)
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </WorkspaceShell>
  );
}
