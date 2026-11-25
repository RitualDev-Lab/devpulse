"use client";

import React, { useState, useEffect, useCallback } from "react";
import {
  Globe2,
  Play,
  Plus,
  Trash2,
  CheckCircle2,
  XCircle,
  Loader2,
  Code2,
} from "lucide-react";
import { PUBLIC_APP_URL } from "@/lib/config/app-url";

interface SyntheticTestRow {
  id: string;
  name: string;
  yamlSpec: string;
  intervalMinutes: number;
  lastStatus: "pass" | "fail" | "pending";
  p95LatencyMs: number;
  lastRunAt: string | null;
}

interface RegionMetric {
  region: string;
  label: string;
  totalRuns: number;
  passRate: number | null;
  p95LatencyMs: number;
}

const DEFAULT_YAML = `name: Production E2E Smoke Test
baseUrl: ${PUBLIC_APP_URL}
steps:
  - goto: /
    expectStatus: 200
    expectText: DevPulse
    maxLatencyMs: 3000
  - fetch: /api/v1/sla?projectId=prj_ritual_core
    method: GET
    expectStatus: 200
    expectJsonKey: report`;

export function SyntheticsPanel({
  projectId,
  isDemo = false,
}: {
  projectId: string;
  isDemo?: boolean;
}) {
  const [tests, setTests] = useState<SyntheticTestRow[]>([]);
  const [regionP95, setRegionP95] = useState<RegionMetric[]>([]);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [showBuilder, setShowBuilder] = useState(false);
  const [yamlSpec, setYamlSpec] = useState(DEFAULT_YAML);
  const [intervalMinutes, setIntervalMinutes] = useState(15);
  const [msg, setMsg] = useState<string | null>(null);

  const loadSynthetics = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/v1/synthetics?projectId=${encodeURIComponent(projectId)}`);
      const d = await res.json();
      if (res.ok) {
        setTests(d.tests || []);
        setRegionP95(d.regionP95 || []);
      }
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    loadSynthetics();
  }, [loadSynthetics]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isDemo) return;
    setBusyId("create");
    setMsg(null);
    try {
      const res = await fetch("/api/v1/synthetics", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId,
          action: "create_test",
          yamlSpec,
          intervalMinutes,
        }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Failed to save synthetic test");
      setShowBuilder(false);
      setMsg(`Synthetic E2E test saved & ran once per region label (single Worker origin).`);
      await loadSynthetics();
    } catch (err: any) {
      setMsg(err.message);
    } finally {
      setBusyId(null);
    }
  };

  const handleRunNow = async (testId: string) => {
    if (isDemo) return;
    setBusyId(testId);
    setMsg(null);
    try {
      const res = await fetch("/api/v1/synthetics", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, action: "run_now", testId }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Run failed");
      setMsg(
        `Completed 5-region edge sweep: ${d.result?.status?.toUpperCase()} (P95 ${d.result?.p95LatencyMs}ms)`
      );
      await loadSynthetics();
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
          <h2 className="text-sm font-bold text-white flex items-center gap-2">
            <Globe2 className="w-4 h-4 text-cyan-400" />
            <span>Synthetic E2E Monitoring (No-Code YAML &bull; 5 Edge Regions)</span>
          </h2>
          <p className="text-xs text-zinc-400 mt-0.5">
            Define multi-step Playwright-style YAML flows (<code className="text-zinc-300">goto</code>,{" "}
            <code className="text-zinc-300">fetch</code>, <code className="text-zinc-300">submitForm</code>) and track P95 latency per global region.
          </p>
        </div>

        {!isDemo && (
          <button
            type="button"
            onClick={() => setShowBuilder((s) => !s)}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-cyan-600/20 hover:bg-cyan-600/35 border border-cyan-500/40 text-cyan-200 text-xs font-semibold"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>{showBuilder ? "Close Editor" : "New YAML E2E Test"}</span>
          </button>
        )}
      </div>

      {msg && (
        <div className="p-2.5 rounded-xl bg-zinc-950 border border-zinc-800 text-xs text-cyan-200">
          {msg}
        </div>
      )}

      {/* Per-label P95 grid. Runs execute from one Worker origin; labels are sent as X-DevPulse-Region. */}
      <p className="text-[10px] text-zinc-500 mb-2">
        Region labels are sent to the target as X-DevPulse-Region. All probes run from one Worker origin, so these are not measured per-region latencies.
      </p>
      {regionP95.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-2.5">
          {regionP95.map((r) => (
            <div
              key={r.region}
              className="p-3 rounded-xl bg-zinc-950 border border-zinc-800 text-xs space-y-1"
            >
              <div className="flex items-center justify-between">
                <span className="font-mono font-bold uppercase text-cyan-300">{r.region}</span>
                <span className="text-[10px] font-mono text-emerald-400">{r.passRate === null ? "—" : `${r.passRate}%`}</span>
              </div>
              <div className="text-[11px] text-zinc-400 truncate">{r.label}</div>
              <div className="font-mono text-sm font-bold text-white">
                {r.totalRuns > 0 ? `${r.p95LatencyMs}ms P95` : "—"}
              </div>
            </div>
          ))}
        </div>
      )}

      {showBuilder && (
        <form
          onSubmit={handleCreate}
          className="p-4 rounded-xl bg-zinc-950 border border-zinc-800 space-y-3"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-white flex items-center gap-1.5">
              <Code2 className="w-3.5 h-3.5 text-cyan-400" />
              <span>Synthetic E2E YAML Definition</span>
            </span>
            <select
              value={intervalMinutes}
              onChange={(e) => setIntervalMinutes(Number(e.target.value))}
              className="px-2.5 py-1 rounded-lg bg-zinc-900 border border-zinc-800 text-xs text-white"
            >
              <option value={5}>Every 5 min</option>
              <option value={15}>Every 15 min</option>
              <option value={60}>Hourly</option>
            </select>
          </div>
          <textarea
            rows={9}
            value={yamlSpec}
            onChange={(e) => setYamlSpec(e.target.value)}
            className="w-full px-3 py-2 rounded-xl bg-zinc-900 border border-zinc-800 font-mono text-xs text-cyan-200"
          />
          <button
            type="submit"
            disabled={busyId === "create"}
            className="px-4 py-2 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-semibold flex items-center gap-1.5"
          >
            {busyId === "create" ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Play className="w-3.5 h-3.5" />
            )}
            <span>Save &amp; Execute Across 5 Edge Locations</span>
          </button>
        </form>
      )}

      {/* Tests List */}
      <div className="space-y-2">
        {loading && tests.length === 0 ? (
          <div className="text-xs text-zinc-500 py-4">Loading synthetic monitors...</div>
        ) : tests.length === 0 ? (
          <div className="p-4 rounded-xl bg-zinc-950 border border-zinc-800 text-xs text-zinc-400">
            No synthetic YAML tests configured yet. Create a test above to verify multi-step user journeys from US, EU, APAC, AU, and SA edge nodes.
          </div>
        ) : (
          tests.map((t) => (
            <div
              key={t.id}
              className="p-3.5 rounded-xl bg-zinc-950 border border-zinc-800 flex flex-wrap items-center justify-between gap-3 text-xs"
            >
              <div className="space-y-0.5">
                <div className="flex items-center gap-2">
                  {t.lastStatus === "pass" ? (
                    <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                  ) : t.lastStatus === "fail" ? (
                    <XCircle className="w-4 h-4 text-red-400" />
                  ) : (
                    <Loader2 className="w-4 h-4 text-zinc-500" />
                  )}
                  <span className="font-bold text-white">{t.name}</span>
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-zinc-900 border border-zinc-800 text-zinc-300">
                    Every {t.intervalMinutes}m • P95 {t.p95LatencyMs}ms
                  </span>
                </div>
                {t.lastRunAt && (
                  <div className="text-[10px] text-zinc-500 font-mono pl-6">
                    Last run: {t.lastRunAt.slice(0, 16).replace("T", " ")} UTC
                  </div>
                )}
              </div>

              {!isDemo && (
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    disabled={busyId === t.id}
                    onClick={() => handleRunNow(t.id)}
                    className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-zinc-900 hover:bg-zinc-800 border border-zinc-700 text-zinc-200 text-[11px] font-semibold"
                  >
                    {busyId === t.id ? (
                      <Loader2 className="w-3 h-3 animate-spin" />
                    ) : (
                      <Play className="w-3 h-3 text-emerald-400" />
                    )}
                    <span>Run 5 Regions</span>
                  </button>
                  <button
                    type="button"
                    onClick={async () => {
                      await fetch("/api/v1/synthetics", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                          projectId,
                          action: "delete_test",
                          testId: t.id,
                        }),
                      });
                      loadSynthetics();
                    }}
                    className="p-1.5 text-zinc-500 hover:text-red-400"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
