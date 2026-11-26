"use client";

import React, { useEffect, useState, useCallback } from "react";
import { CalendarClock, Plus, Trash2, ShieldOff, BellOff } from "lucide-react";
import type { MaintenanceWindowRecord } from "@/lib/monitors/maintenance";

const DEMO_WINDOWS: MaintenanceWindowRecord[] = [
  {
    id: "demo_mw_1",
    title: "Turso Primary Region Storage Migration",
    reason: "Zero-downtime replication cutover; suppressing transient heartbeat alerts for 15 minutes.",
    startsAt: "2026-12-01T02:00:00.000Z",
    endsAt: "2026-12-01T02:15:00.000Z",
    suppressAlerts: true,
    isActiveNow: false,
    isUpcoming: true,
  },
];

export function MaintenanceWindowsPanel({
  projectId,
  isDemo = false,
}: {
  projectId: string;
  isDemo?: boolean;
}) {
  const [windows, setWindows] = useState<MaintenanceWindowRecord[]>(isDemo ? DEMO_WINDOWS : []);
  const [showForm, setShowForm] = useState(false);
  const [title, setTitle] = useState("");
  const [reason, setReason] = useState("");
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");
  const [suppressAlerts, setSuppressAlerts] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (isDemo) {
      setWindows(DEMO_WINDOWS);
      return;
    }
    const res = await fetch(`/api/v1/monitors/maintenance?projectId=${encodeURIComponent(projectId)}`);
    const data = await res.json().catch(() => ({}));
    if (res.ok) setWindows(data.windows || []);
  }, [projectId, isDemo]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isDemo || !title.trim() || !startsAt || !endsAt) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/v1/monitors/maintenance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "create",
          projectId,
          title,
          reason,
          startsAt,
          endsAt,
          suppressAlerts,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to schedule maintenance");
      setTitle("");
      setReason("");
      setShowForm(false);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save maintenance window");
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (isDemo) return;
    await fetch("/api/v1/monitors/maintenance", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "delete", projectId, id }),
    });
    await load();
  };

  return (
    <section className="p-5 rounded-2xl bg-zinc-900/90 border border-zinc-800 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-bold text-white flex items-center gap-2">
            <CalendarClock className="w-4 h-4 text-amber-400" />
            <span>Scheduled Maintenance Windows</span>
          </h2>
          <p className="text-xs text-zinc-400 mt-0.5">
            Automatically suppress Cron Heartbeat &amp; Uptime alert noise during deploys and publish notices to public status portals.
          </p>
        </div>
        {!isDemo && (
          <button
            type="button"
            onClick={() => setShowForm((v) => !v)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-amber-500/15 hover:bg-amber-500/25 border border-amber-500/30 text-amber-300 text-xs font-semibold"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Schedule Window</span>
          </button>
        )}
      </div>

      {error && (
        <div className="p-2.5 rounded-lg bg-red-950/50 border border-red-500/40 text-xs text-red-300">
          {error}
        </div>
      )}

      {showForm && (
        <form onSubmit={handleCreate} className="p-4 rounded-xl bg-zinc-950 border border-zinc-800 space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <input
              type="text"
              required
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Maintenance title (e.g., Database Failover Test)"
              className="px-3 py-2 rounded-lg bg-zinc-900 border border-zinc-800 text-xs text-white"
            />
            <input
              type="text"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Public portal note (optional)"
              className="px-3 py-2 rounded-lg bg-zinc-900 border border-zinc-800 text-xs text-white"
            />
            <label className="text-[11px] text-zinc-400 space-y-1">
              <span>Starts At (UTC / Local)</span>
              <input
                type="datetime-local"
                required
                value={startsAt}
                onChange={(e) => setStartsAt(e.target.value)}
                className="w-full px-3 py-1.5 rounded-lg bg-zinc-900 border border-zinc-800 text-xs text-white"
              />
            </label>
            <label className="text-[11px] text-zinc-400 space-y-1">
              <span>Ends At</span>
              <input
                type="datetime-local"
                required
                value={endsAt}
                onChange={(e) => setEndsAt(e.target.value)}
                className="w-full px-3 py-1.5 rounded-lg bg-zinc-900 border border-zinc-800 text-xs text-white"
              />
            </label>
          </div>
          <label className="inline-flex items-center gap-2 text-xs text-zinc-300">
            <input
              type="checkbox"
              checked={suppressAlerts}
              onChange={(e) => setSuppressAlerts(e.target.checked)}
              className="rounded border-zinc-700"
            />
            <span>Suppress webhook &amp; email alerts while window is active</span>
          </label>
          <div className="flex items-center gap-2">
            <button
              type="submit"
              disabled={busy}
              className="px-4 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-500 text-white text-xs font-semibold"
            >
              Save Window
            </button>
            <button
              type="button"
              onClick={() => setShowForm(false)}
              className="px-3 py-1.5 rounded-lg bg-zinc-800 text-zinc-300 text-xs"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {windows.length === 0 ? (
        <div className="p-4 rounded-xl bg-zinc-950 border border-zinc-800 text-xs text-zinc-500">
          No scheduled maintenance windows configured.
        </div>
      ) : (
        <div className="space-y-2">
          {windows.map((w) => (
            <div
              key={w.id}
              className="p-3.5 rounded-xl bg-zinc-950 border border-zinc-800 flex flex-wrap items-center justify-between gap-3"
            >
              <div className="space-y-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs font-bold text-white">{w.title}</span>
                  <span
                    className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded-full border ${
                      w.isActiveNow
                        ? "bg-amber-500/20 text-amber-300 border-amber-500/40"
                        : w.isUpcoming
                        ? "bg-cyan-500/15 text-cyan-300 border-cyan-500/30"
                        : "bg-zinc-800 text-zinc-400 border-zinc-700"
                    }`}
                  >
                    {w.isActiveNow ? "Active Now" : w.isUpcoming ? "Scheduled" : "Completed"}
                  </span>
                  {w.suppressAlerts && (
                    <span className="inline-flex items-center gap-1 text-[10px] text-zinc-400">
                      <BellOff className="w-3 h-3" /> Alerts Silenced
                    </span>
                  )}
                </div>
                {w.reason && <p className="text-xs text-zinc-400">{w.reason}</p>}
                <div className="text-[11px] font-mono text-zinc-500" suppressHydrationWarning>
                  {new Date(w.startsAt).toISOString().slice(0, 16).replace("T", " ")} UTC &rarr;{" "}
                  {new Date(w.endsAt).toISOString().slice(0, 16).replace("T", " ")} UTC
                </div>
              </div>
              {!isDemo && (
                <button
                  type="button"
                  onClick={() => void handleDelete(w.id)}
                  className="p-1.5 rounded-lg bg-zinc-900 hover:bg-red-950/60 border border-zinc-800 text-zinc-400 hover:text-red-300"
                  title="Remove maintenance window"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
