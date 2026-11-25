"use client";

import React, { useState, useEffect, useCallback } from "react";
import {
  FileCheck2,
  FileDown,
  AlertTriangle,
  Plus,
  CheckCircle2,
  ExternalLink,
  Loader2,
  Clock,
} from "lucide-react";

interface SlaMonitorRow {
  monitorId: string;
  name: string;
  url: string;
  slaTargetPercent: string;
  slaTargetBp: number;
  actualUptimePercent: string;
  actualUptimeBp: number;
  compliant: boolean;
  p95LatencyMs: number;
  downtimeMinutes: number;
  errorBudgetRemainingMinutes: number;
}

interface IncidentItem {
  id: string;
  monitorId: string | null;
  title: string;
  severity: "minor" | "major" | "critical";
  status: "investigating" | "identified" | "monitoring" | "resolved";
  rcaText: string | null;
  impactSummary: string | null;
  startedAt: string;
  resolvedAt: string | null;
  durationMinutes: number;
  isPublic: boolean;
}

interface SlaCompliancePanelProps {
  projectId: string;
  projectSlug: string;
  subdomain?: string;
  isDemo?: boolean;
}

export function SlaCompliancePanel({
  projectId,
  projectSlug,
  subdomain,
  isDemo = false,
}: SlaCompliancePanelProps) {
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [report, setReport] = useState<{
    overallUptimePercent: string;
    overallTargetPercent: string;
    overallCompliant: boolean;
    totalDowntimeMinutes: number;
    monitors: SlaMonitorRow[];
  } | null>(null);
  const [incidents, setIncidents] = useState<IncidentItem[]>([]);

  // New incident form
  const [showForm, setShowForm] = useState(false);
  const [incTitle, setIncTitle] = useState("");
  const [incSeverity, setIncSeverity] = useState<"minor" | "major" | "critical">("major");
  const [incMonitorId, setIncMonitorId] = useState("");
  const [incImpact, setIncImpact] = useState("");
  const [incRca, setIncRca] = useState("");

  // Inline RCA edit state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editStatus, setEditStatus] = useState<IncidentItem["status"]>("resolved");
  const [editRca, setEditRca] = useState("");

  const loadSla = useCallback(async () => {
    setLoading(true);
    setErrorMsg(null);
    try {
      const res = await fetch(
        `/api/v1/sla?projectId=${encodeURIComponent(projectId)}&month=${encodeURIComponent(month)}`
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load SLA report");
      setReport(data.report || null);
      setIncidents(data.allIncidents || []);
    } catch (e: any) {
      setErrorMsg(e.message || "Failed to load SLA data");
    } finally {
      setLoading(false);
    }
  }, [month, projectId]);

  useEffect(() => {
    loadSla();
  }, [loadSla]);

  const handleUpdateTarget = async (monitorId: string, slaTargetBp: number) => {
    if (isDemo) return;
    setBusy(true);
    try {
      await fetch("/api/v1/sla", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, action: "update_sla_target", monitorId, slaTargetBp }),
      });
      await loadSla();
    } finally {
      setBusy(false);
    }
  };

  const handleCreateIncident = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isDemo || !incTitle.trim()) return;
    setBusy(true);
    setErrorMsg(null);
    try {
      const res = await fetch("/api/v1/sla", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId,
          action: "create_incident",
          title: incTitle.trim(),
          severity: incSeverity,
          monitorId: incMonitorId || undefined,
          impactSummary: incImpact.trim() || undefined,
          rcaText: incRca.trim() || undefined,
        }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Failed to create incident");
      setIncTitle("");
      setIncImpact("");
      setIncRca("");
      setShowForm(false);
      await loadSla();
    } catch (err: any) {
      setErrorMsg(err.message);
    } finally {
      setBusy(false);
    }
  };

  const handleSaveRca = async (incidentId: string) => {
    if (isDemo) return;
    setBusy(true);
    try {
      await fetch("/api/v1/sla", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId,
          action: "update_incident",
          incidentId,
          status: editStatus,
          rcaText: editRca,
        }),
      });
      setEditingId(null);
      await loadSla();
    } finally {
      setBusy(false);
    }
  };

  const statusPageHref = subdomain
    ? `/portal/${encodeURIComponent(subdomain)}/status?project=${encodeURIComponent(projectSlug)}`
    : `/portal/ritualdev/status?project=${encodeURIComponent(projectSlug)}`;

  return (
    <div className="p-5 rounded-2xl bg-zinc-900/90 border border-zinc-800 space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-bold text-white flex items-center gap-2">
            <FileCheck2 className="w-4 h-4 text-emerald-400" />
            <span>SLA Compliance Dashboard &amp; Incident RCA Timeline</span>
          </h2>
          <p className="text-xs text-zinc-400 mt-0.5">
            Track 99.9% / 99.95% monthly uptime SLAs, remaining error budget, Root Cause Analysis (RCA), and public 90-day history.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <input
            type="month"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            className="px-2.5 py-1.5 rounded-xl bg-zinc-950 border border-zinc-800 text-xs text-white font-mono"
          />
          <a
            href={`/api/v1/sla?projectId=${encodeURIComponent(projectId)}&month=${encodeURIComponent(month)}&format=report`}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-indigo-600/20 hover:bg-indigo-600/35 border border-indigo-500/40 text-indigo-200 text-xs font-semibold transition"
          >
            <FileDown className="w-3.5 h-3.5" />
            <span>Monthly SLA PDF</span>
          </a>
          <a
            href={statusPageHref}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-emerald-600/20 hover:bg-emerald-600/35 border border-emerald-500/40 text-emerald-200 text-xs font-semibold transition"
          >
            <span>90-Day Public History</span>
            <ExternalLink className="w-3 h-3" />
          </a>
        </div>
      </div>

      {errorMsg && (
        <div className="p-3 rounded-xl bg-red-950/50 border border-red-800/60 text-xs text-red-200">
          {errorMsg}
        </div>
      )}

      {loading && !report ? (
        <div className="p-4 text-xs text-zinc-400 flex items-center gap-2">
          <Loader2 className="w-4 h-4 animate-spin text-emerald-400" />
          <span>Calculating SLA compliance...</span>
        </div>
      ) : (
        report && (
          <>
            {/* Executive SLA KPIs */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="p-3 rounded-xl bg-zinc-950 border border-zinc-800">
                <div className="text-[11px] text-zinc-500">Monthly Availability</div>
                <div className="text-lg font-extrabold text-white font-mono">
                  {report.overallUptimePercent}%
                </div>
              </div>
              <div className="p-3 rounded-xl bg-zinc-950 border border-zinc-800">
                <div className="text-[11px] text-zinc-500">Strictest SLA Target</div>
                <div className="text-lg font-extrabold text-cyan-300 font-mono">
                  {report.overallTargetPercent}%
                </div>
              </div>
              <div className="p-3 rounded-xl bg-zinc-950 border border-zinc-800">
                <div className="text-[11px] text-zinc-500">Recorded Downtime</div>
                <div className="text-lg font-extrabold text-white font-mono">
                  {report.totalDowntimeMinutes} min
                </div>
              </div>
              <div className="p-3 rounded-xl bg-zinc-950 border border-zinc-800">
                <div className="text-[11px] text-zinc-500">SLA Status</div>
                <div className="mt-1">
                  {report.overallCompliant ? (
                    <span className="inline-flex items-center gap-1 text-xs font-bold px-2.5 py-0.5 rounded-full bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      COMPLIANT
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-xs font-bold px-2.5 py-0.5 rounded-full bg-red-500/15 text-red-300 border border-red-500/30">
                      <AlertTriangle className="w-3.5 h-3.5" />
                      BREACHED
                    </span>
                  )}
                </div>
              </div>
            </div>

            {/* Per-monitor SLA Table */}
            {report.monitors.length > 0 && (
              <div className="overflow-x-auto rounded-xl border border-zinc-800">
                <table className="w-full text-left text-xs">
                  <thead className="bg-zinc-950 text-zinc-400 border-b border-zinc-800">
                    <tr>
                      <th className="py-2.5 px-3">Endpoint</th>
                      <th className="py-2.5 px-3">SLA Target</th>
                      <th className="py-2.5 px-3">Actual</th>
                      <th className="py-2.5 px-3">Error Budget Left</th>
                      <th className="py-2.5 px-3">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-800/60 bg-zinc-950/40">
                    {report.monitors.map((m) => (
                      <tr key={m.monitorId}>
                        <td className="py-2.5 px-3 font-semibold text-white">{m.name}</td>
                        <td className="py-2.5 px-3">
                          <select
                            disabled={busy || isDemo}
                            value={m.slaTargetBp}
                            onChange={(e) =>
                              handleUpdateTarget(m.monitorId, Number(e.target.value))
                            }
                            className="px-2 py-1 rounded bg-zinc-900 border border-zinc-800 text-xs font-mono text-zinc-200"
                          >
                            <option value={9900}>99.00%</option>
                            <option value={9990}>99.90%</option>
                            <option value={9995}>99.95%</option>
                            <option value={9999}>99.99%</option>
                          </select>
                        </td>
                        <td className="py-2.5 px-3 font-mono font-bold text-white">
                          {m.actualUptimePercent}%
                        </td>
                        <td
                          className={`py-2.5 px-3 font-mono ${
                            m.errorBudgetRemainingMinutes >= 0
                              ? "text-emerald-300"
                              : "text-red-300"
                          }`}
                        >
                          {m.errorBudgetRemainingMinutes} min
                        </td>
                        <td className="py-2.5 px-3">
                          <span
                            className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                              m.compliant
                                ? "bg-emerald-500/15 text-emerald-300"
                                : "bg-red-500/15 text-red-300"
                            }`}
                          >
                            {m.compliant ? "PASS" : "BREACH"}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )
      )}

      {/* Incident Timeline + RCA */}
      <div className="space-y-3 pt-2 border-t border-zinc-800/80">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-bold text-white flex items-center gap-1.5">
            <Clock className="w-3.5 h-3.5 text-amber-400" />
            <span>Incident Timeline &amp; Root Cause Analysis ({incidents.length})</span>
          </h3>
          {!isDemo && (
            <button
              type="button"
              onClick={() => setShowForm((s) => !s)}
              className="flex items-center gap-1 px-3 py-1.5 rounded-xl bg-amber-600/20 hover:bg-amber-600/35 border border-amber-500/40 text-amber-200 text-xs font-semibold"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Log Incident / RCA</span>
            </button>
          )}
        </div>

        {showForm && (
          <form
            onSubmit={handleCreateIncident}
            className="p-4 rounded-xl bg-zinc-950 border border-zinc-800 space-y-3"
          >
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              <input
                type="text"
                required
                value={incTitle}
                onChange={(e) => setIncTitle(e.target.value)}
                placeholder="Incident title (e.g. EU Edge API 502 Spike)"
                className="sm:col-span-2 px-3 py-2 rounded-lg bg-zinc-900 border border-zinc-800 text-xs text-white"
              />
              <select
                value={incSeverity}
                onChange={(e) => setIncSeverity(e.target.value as any)}
                className="px-3 py-2 rounded-lg bg-zinc-900 border border-zinc-800 text-xs text-white"
              >
                <option value="minor">Minor</option>
                <option value="major">Major</option>
                <option value="critical">Critical</option>
              </select>
            </div>
            {report && report.monitors.length > 0 && (
              <select
                value={incMonitorId}
                onChange={(e) => setIncMonitorId(e.target.value)}
                className="w-full px-3 py-2 rounded-lg bg-zinc-900 border border-zinc-800 text-xs text-white"
              >
                <option value="">All / Project-wide Incident</option>
                {report.monitors.map((m) => (
                  <option key={m.monitorId} value={m.monitorId}>
                    {m.name}
                  </option>
                ))}
              </select>
            )}
            <input
              type="text"
              value={incImpact}
              onChange={(e) => setIncImpact(e.target.value)}
              placeholder="Customer impact summary (optional)"
              className="w-full px-3 py-2 rounded-lg bg-zinc-900 border border-zinc-800 text-xs text-white"
            />
            <textarea
              rows={3}
              value={incRca}
              onChange={(e) => setIncRca(e.target.value)}
              placeholder="Root Cause Analysis (RCA) — visible on monthly SLA PDF & public 90-day status timeline"
              className="w-full px-3 py-2 rounded-lg bg-zinc-900 border border-zinc-800 text-xs text-white"
            />
            <div className="flex gap-2">
              <button
                type="submit"
                disabled={busy}
                className="px-4 py-2 rounded-xl bg-amber-600 hover:bg-amber-500 text-white text-xs font-semibold"
              >
                Publish Incident
              </button>
              <button
                type="button"
                onClick={() => setShowForm(false)}
                className="px-3 py-2 rounded-xl bg-zinc-800 text-zinc-300 text-xs"
              >
                Cancel
              </button>
            </div>
          </form>
        )}

        <div className="space-y-2.5">
          {incidents.length === 0 ? (
            <div className="p-4 rounded-xl bg-zinc-950 border border-zinc-800 text-xs text-zinc-500">
              No downtime incidents logged for this project.
            </div>
          ) : (
            incidents.slice(0, 8).map((inc) => (
              <div
                key={inc.id}
                className="p-3.5 rounded-xl bg-zinc-950 border border-zinc-800 space-y-2"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-white">{inc.title}</span>
                    <span className="text-[10px] uppercase px-2 py-0.5 rounded-full bg-zinc-800 text-zinc-300">
                      {inc.severity} • {inc.status}
                    </span>
                    {inc.durationMinutes > 0 && (
                      <span className="text-[10px] font-mono text-zinc-400">
                        {inc.durationMinutes}m
                      </span>
                    )}
                  </div>
                  {!isDemo && (
                    <button
                      type="button"
                      onClick={() => {
                        setEditingId(editingId === inc.id ? null : inc.id);
                        setEditStatus(inc.status);
                        setEditRca(inc.rcaText || "");
                      }}
                      className="text-[11px] text-indigo-400 hover:underline"
                    >
                      {editingId === inc.id ? "Close" : "Update Status / RCA"}
                    </button>
                  )}
                </div>

                {inc.rcaText && editingId !== inc.id && (
                  <div className="text-xs text-zinc-300 bg-zinc-900/70 p-2.5 rounded-lg border-l-2 border-indigo-500">
                    <strong className="text-indigo-300">RCA:</strong> {inc.rcaText}
                  </div>
                )}

                {editingId === inc.id && (
                  <div className="space-y-2 pt-1">
                    <select
                      value={editStatus}
                      onChange={(e) => setEditStatus(e.target.value as any)}
                      className="px-2.5 py-1.5 rounded-lg bg-zinc-900 border border-zinc-800 text-xs text-white"
                    >
                      <option value="investigating">Investigating</option>
                      <option value="identified">Identified</option>
                      <option value="monitoring">Monitoring</option>
                      <option value="resolved">Resolved</option>
                    </select>
                    <textarea
                      rows={3}
                      value={editRca}
                      onChange={(e) => setEditRca(e.target.value)}
                      placeholder="Write Root Cause Analysis (RCA)..."
                      className="w-full px-3 py-2 rounded-lg bg-zinc-900 border border-zinc-800 text-xs text-white"
                    />
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => handleSaveRca(inc.id)}
                      className="px-3.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold"
                    >
                      Save Incident Update
                    </button>
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
