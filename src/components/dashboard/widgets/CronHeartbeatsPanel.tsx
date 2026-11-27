"use client";

import React, { useEffect, useState, useCallback } from "react";
import { Clock, Copy, Check, Plus, Trash2, Play, Loader2, ShieldAlert } from "lucide-react";

interface CronHeartbeatItem {
  id: string;
  name: string;
  monitorKey: string;
  pingUrl: string;
  intervalMinutes: number;
  graceMinutes: number;
  maxDurationSeconds: number | null;
  state: "pending" | "up" | "running" | "late" | "failed";
  lastPingAt: string | null;
  lastDurationMs: number | null;
  nextDueAt: string | null;
}

const DEMO_HEARTBEATS: CronHeartbeatItem[] = [
  {
    id: "demo_hb_1",
    name: "Nightly Turso Replica Snapshot",
    monitorKey: "hb_demo_turso_snapshot",
    pingUrl: "https://devpulse.ritualdev.in/api/v1/ping/hb_demo_turso_snapshot",
    intervalMinutes: 1440,
    graceMinutes: 15,
    maxDurationSeconds: 180,
    state: "up",
    lastPingAt: "2026-11-26T22:00:00Z",
    lastDurationMs: 418,
    nextDueAt: "2026-11-27T22:00:00Z",
  },
  {
    id: "demo_hb_2",
    name: "23-Registry Hourly Metrics Sync",
    monitorKey: "hb_demo_registry_sync",
    pingUrl: "https://devpulse.ritualdev.in/api/v1/ping/hb_demo_registry_sync",
    intervalMinutes: 60,
    graceMinutes: 5,
    maxDurationSeconds: 90,
    state: "up",
    lastPingAt: "2026-11-26T23:00:00Z",
    lastDurationMs: 294,
    nextDueAt: "2026-11-27T00:00:00Z",
  },
];

export function CronHeartbeatsPanel({
  projectId,
  isDemo = false,
}: {
  projectId: string;
  isDemo?: boolean;
}) {
  const [items, setItems] = useState<CronHeartbeatItem[]>(isDemo ? DEMO_HEARTBEATS : []);
  const [loading, setLoading] = useState(!isDemo);
  const [name, setName] = useState("");
  const [intervalMinutes, setIntervalMinutes] = useState("60");
  const [graceMinutes, setGraceMinutes] = useState("5");
  const [maxDurationSeconds, setMaxDurationSeconds] = useState("300");
  const [saving, setSaving] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [pingingId, setPingingId] = useState<string | null>(null);
  const [pingNotice, setPingNotice] = useState<string | null>(null);

  const loadHeartbeats = useCallback(async () => {
    if (isDemo) {
      setItems((prev) => (prev.length > 0 ? prev : DEMO_HEARTBEATS));
      setLoading(false);
      return;
    }
    try {
      const res = await fetch(`/api/v1/monitors/heartbeats?projectId=${encodeURIComponent(projectId)}`);
      if (res.ok) {
        const json = await res.json();
        setItems(Array.isArray(json.heartbeats) ? json.heartbeats : []);
      }
    } finally {
      setLoading(false);
    }
  }, [projectId, isDemo]);

  useEffect(() => {
    void loadHeartbeats();
  }, [loadHeartbeats]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isDemo || !name.trim()) return;
    setSaving(true);
    try {
      const res = await fetch("/api/v1/monitors/heartbeats", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId,
          action: "create",
          name: name.trim(),
          intervalMinutes: Number(intervalMinutes || 60),
          graceMinutes: Number(graceMinutes || 5),
          maxDurationSeconds: maxDurationSeconds ? Number(maxDurationSeconds) : null,
        }),
      });
      if (res.ok) {
        setName("");
        await loadHeartbeats();
      }
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (isDemo) return;
    await fetch("/api/v1/monitors/heartbeats", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId, action: "delete", id }),
    });
    await loadHeartbeats();
  };

  const handleTestPing = async (item: CronHeartbeatItem) => {
    setPingingId(item.id);
    setPingNotice(null);
    if (isDemo) {
      setItems((prev) =>
        prev.map((row) =>
          row.id === item.id
            ? { ...row, state: "up", lastPingAt: new Date().toISOString(), lastDurationMs: 285 }
            : row
        )
      );
      setPingNotice(`Demo test ping received for "${item.name}" (285ms -> UP).`);
      setPingingId(null);
      return;
    }
    try {
      await fetch(`/api/v1/ping/${encodeURIComponent(item.monitorKey)}?state=finish`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ state: "finish", durationMs: 420 }),
      });
      setPingNotice(`Sent finish heartbeat ping for "${item.name}".`);
      await loadHeartbeats();
    } finally {
      setPingingId(null);
    }
  };

  return (
    <div className="p-5 rounded-2xl bg-zinc-900/90 border border-zinc-800 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-bold text-white flex items-center gap-2">
            <Clock className="w-4 h-4 text-amber-400" />
            <span>Cron &amp; Worker Heartbeats (&quot;Dead Man&apos;s Switch&quot;)</span>
          </h2>
          <p className="text-xs text-zinc-400 mt-0.5">
            Ping <code className="text-cyan-300">/api/v1/ping/&#123;monitorKey&#125;</code> (<code className="text-zinc-300">start | finish | fail</code>) from OCI cron jobs, systemd timers, or Kubernetes CronJobs. Alerts on missed runs or max runtime overrun.
          </p>
        </div>
      </div>

      {!isDemo && (
        <form onSubmit={handleCreate} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2.5">
          <input
            type="text"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Job Name (e.g. Nightly DB Backup)"
            className="lg:col-span-2 px-3 py-2 rounded-xl bg-zinc-950 border border-zinc-800 text-xs text-white"
          />
          <input
            type="number"
            min={1}
            value={intervalMinutes}
            onChange={(e) => setIntervalMinutes(e.target.value)}
            placeholder="Every (mins)"
            title="Expected interval (minutes)"
            className="px-3 py-2 rounded-xl bg-zinc-950 border border-zinc-800 text-xs text-white font-mono"
          />
          <input
            type="number"
            min={1}
            value={graceMinutes}
            onChange={(e) => setGraceMinutes(e.target.value)}
            placeholder="Grace (mins)"
            title="Grace window (minutes)"
            className="px-3 py-2 rounded-xl bg-zinc-950 border border-zinc-800 text-xs text-white font-mono"
          />
          <div className="flex gap-2">
            <input
              type="number"
              min={1}
              value={maxDurationSeconds}
              onChange={(e) => setMaxDurationSeconds(e.target.value)}
              placeholder="Max sec"
              title="Max duration seconds"
              className="w-24 px-2.5 py-2 rounded-xl bg-zinc-950 border border-zinc-800 text-xs text-white font-mono"
            />
            <button
              type="submit"
              disabled={saving}
              className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold disabled:opacity-50"
            >
              {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
              <span>Add</span>
            </button>
          </div>
        </form>
      )}

      {loading ? (
        <div className="text-xs text-zinc-500 py-4">Loading cron heartbeats...</div>
      ) : items.length === 0 ? (
        <div className="p-4 rounded-xl bg-zinc-950/60 border border-zinc-800/80 text-xs text-zinc-400 flex items-center gap-2">
          <ShieldAlert className="w-4 h-4 text-zinc-500 shrink-0" />
          <span>No cron heartbeats configured yet. Add one above to monitor OCI crons, systemd timers, or background queues.</span>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {pingNotice && (
            <div className="md:col-span-2 px-3 py-2 rounded-xl bg-emerald-950/40 border border-emerald-500/30 text-xs text-emerald-200">
              {pingNotice}
            </div>
          )}
          {items.map((hb) => {
            const badgeColor =
              hb.state === "up"
                ? "bg-emerald-500/15 text-emerald-300 border-emerald-500/30"
                : hb.state === "running"
                  ? "bg-cyan-500/15 text-cyan-300 border-cyan-500/30"
                  : hb.state === "failed" || hb.state === "late"
                    ? "bg-red-500/15 text-red-300 border-red-500/30"
                    : "bg-zinc-800 text-zinc-300 border-zinc-700";

            return (
              <div key={hb.id} className="p-3.5 rounded-xl bg-zinc-950/80 border border-zinc-800 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-xs font-bold text-white truncate">{hb.name}</div>
                    <div className="text-[11px] text-zinc-400 font-mono">
                      every {hb.intervalMinutes}m (+{hb.graceMinutes}m grace)
                      {hb.maxDurationSeconds ? ` • max ${hb.maxDurationSeconds}s` : ""}
                      {hb.lastDurationMs !== null ? ` • last ${hb.lastDurationMs}ms` : ""}
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded-full border ${badgeColor}`}>
                      {hb.state}
                    </span>
                    <button
                      type="button"
                      onClick={() => handleTestPing(hb)}
                      disabled={pingingId === hb.id}
                      title="Send test heartbeat ping"
                      className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-500/30 text-emerald-300 text-[10px] font-semibold"
                    >
                      {pingingId === hb.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Play className="w-3 h-3" />}
                      <span>Test Ping</span>
                    </button>
                    {!isDemo && (
                      <button
                        type="button"
                        onClick={() => handleDelete(hb.id)}
                        title="Delete heartbeat"
                        className="p-1.5 rounded-lg bg-zinc-900 hover:bg-red-950/50 border border-zinc-800 text-zinc-400 hover:text-red-300"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    )}
                  </div>
                </div>
                <div className="flex items-center justify-between gap-2 p-2 rounded-lg bg-zinc-900/90 border border-zinc-800/80 text-[11px] font-mono text-cyan-300">
                  <span className="truncate">curl -fsS {hb.pingUrl}?state=finish</span>
                  <button
                    type="button"
                    onClick={() => {
                      navigator.clipboard.writeText(`curl -fsS ${hb.pingUrl}?state=finish`);
                      setCopiedId(hb.id);
                      setTimeout(() => setCopiedId(null), 1500);
                    }}
                    className="text-zinc-300 hover:text-white shrink-0"
                  >
                    {copiedId === hb.id ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
