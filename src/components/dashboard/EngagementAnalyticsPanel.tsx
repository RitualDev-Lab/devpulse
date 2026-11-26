"use client";

import React, { useEffect, useState } from "react";
import { Activity, Funnel, RotateCcw } from "lucide-react";

interface EngagementReport {
  totalSessions: number;
  sessionsByDay: Array<{ date: string; sessions: number; events: number }>;
  retention7d: { cohortUsers: number; retainedUsers: number; ratePercent: number | null; note: string };
  funnel: Array<{ event: string; users: number; conversionFromPrevious: number | null; conversionFromStart: number | null }>;
}

export function EngagementAnalyticsPanel({ projectId }: { projectId: string }) {
  const [days, setDays] = useState(30);
  const [funnelInput, setFunnelInput] = useState("signup_started,signup_completed,purchase");
  const [report, setReport] = useState<EngagementReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ projectId, days: String(days), funnel: funnelInput });
      const response = await fetch(`/api/v1/analytics?${params}`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not load analytics");
      setReport(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load analytics");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    const params = new URLSearchParams({ projectId, days: "30", funnel: "signup_started,signup_completed,purchase" });
    void fetch(`/api/v1/analytics?${params}`)
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Could not load analytics");
        if (!cancelled) setReport(data);
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : "Could not load analytics");
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [projectId]);

  const maxSessions = Math.max(1, ...(report?.sessionsByDay || []).map((day) => day.sessions));

  return (
    <section className="p-5 rounded-2xl bg-zinc-900/90 border border-zinc-800 space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-bold text-white flex items-center gap-2"><Activity className="w-4 h-4 text-cyan-400" /> Sessions, funnels &amp; retention</h2>
          <p className="text-xs text-zinc-400 mt-1">Sessions require SDK <code>trackEvent</code> calls with a session identifier; funnel events are sequenced within a session.</p>
        </div>
        <button type="button" onClick={() => void load()} disabled={loading} className="text-xs px-3 py-1.5 rounded-lg bg-zinc-800 text-zinc-200 flex items-center gap-1.5 disabled:opacity-50"><RotateCcw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} /> Refresh</button>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-[140px_1fr_auto] gap-2">
        <select value={days} onChange={(event) => setDays(Number(event.target.value))} className="px-3 py-2 rounded-lg bg-zinc-950 border border-zinc-800 text-xs text-white">
          {[7, 14, 30, 60, 90].map((n) => <option key={n} value={n}>{n} days</option>)}
        </select>
        <input value={funnelInput} onChange={(event) => setFunnelInput(event.target.value)} maxLength={360} aria-label="Comma-separated funnel event names" placeholder="signup_started,signup_completed,purchase" className="min-w-0 px-3 py-2 rounded-lg bg-zinc-950 border border-zinc-800 text-xs font-mono text-white" />
        <button type="button" onClick={() => void load()} disabled={loading} className="px-3 py-2 rounded-lg bg-cyan-700 hover:bg-cyan-600 text-xs text-white font-semibold">Run report</button>
      </div>
      {error && <div role="alert" className="text-xs text-red-300">{error}</div>}
      {report && <>
        <div className="grid grid-cols-2 gap-3">
          <div className="p-3 rounded-xl bg-zinc-950 border border-zinc-800"><div className="text-[10px] uppercase tracking-wide text-zinc-400">7-day retained visitors</div><div className="text-xl font-bold text-white mt-1">{report.retention7d.ratePercent == null ? "No mature cohort" : `${report.retention7d.ratePercent}%`}</div><div className="text-[10px] text-zinc-500">{report.retention7d.retainedUsers.toLocaleString()} / {report.retention7d.cohortUsers.toLocaleString()} visitors</div></div>
          <div className="p-3 rounded-xl bg-zinc-950 border border-zinc-800"><div className="text-[10px] uppercase tracking-wide text-zinc-400">Tracked sessions</div><div className="text-xl font-bold text-white mt-1">{report.totalSessions.toLocaleString()}</div><div className="text-[10px] text-zinc-500">Unique session ids across the {days}-day period</div></div>
        </div>
        <div className="space-y-1.5">
          <h3 className="text-[11px] font-semibold uppercase text-zinc-400">Sessions per day</h3>
          {report.sessionsByDay.length === 0 ? <p className="text-xs text-zinc-500">No session-tagged events in this period yet.</p> : report.sessionsByDay.slice(-14).map((day) => <div key={day.date} className="grid grid-cols-[78px_1fr_52px] items-center gap-2 text-[11px]"><span className="font-mono text-zinc-500">{day.date.slice(5)}</span><div className="h-2 rounded bg-zinc-800 overflow-hidden"><div className="h-full bg-cyan-500 rounded" style={{ width: `${Math.max(2, day.sessions / maxSessions * 100)}%` }} /></div><span className="text-right text-zinc-300 tabular-nums">{day.sessions}</span></div>)}
        </div>
        <div className="space-y-2">
          <h3 className="text-[11px] font-semibold uppercase text-zinc-400 flex items-center gap-1.5"><Funnel className="w-3.5 h-3.5" /> Funnel conversion (unique sessions)</h3>
          {report.funnel.length === 0 ? <p className="text-xs text-zinc-500">Enter 2–5 comma-separated event names and run the report.</p> : <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-2">{report.funnel.map((step, index) => <div key={`${index}-${step.event}`} className="p-3 rounded-xl bg-zinc-950 border border-zinc-800"><div className="text-xs font-mono text-white truncate">{index + 1}. {step.event}</div><div className="text-lg font-bold text-cyan-300 mt-1">{step.users.toLocaleString()} <span className="text-[10px] font-normal text-zinc-400">sessions</span></div><div className="text-[10px] text-zinc-500">{step.conversionFromStart == null ? "Starting step" : `${step.conversionFromStart}% of start`} {step.conversionFromPrevious == null ? "" : ` • ${step.conversionFromPrevious}% from prior`}</div></div>)}</div>}
        </div>
        <p className="text-[10px] text-zinc-500">{report.retention7d.note}</p>
      </>}
    </section>
  );
}
