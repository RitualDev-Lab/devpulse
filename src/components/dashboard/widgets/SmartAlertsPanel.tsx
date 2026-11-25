"use client";

import React, { useState, useEffect, useCallback } from "react";
import {
  BellRing,
  Sparkles,
  Plus,
  Trash2,
  Check,
  ShieldAlert,
  Loader2,
  Activity,
} from "lucide-react";

interface AlertRuleRow {
  id: string;
  name: string;
  ruleType: "crash_rate" | "error_spike_anomaly" | "uptime_down" | "latency_p95";
  thresholdPercent: number;
  windowMinutes: number;
  anomalyZScoreBp: number;
  escalationPolicyId: string | null;
  channelsJson: string;
  isEnabled: boolean;
  lastTriggeredAt: string | null;
}

interface EscalationPolicyRow {
  id: string;
  name: string;
  step1Target: string;
  step1ChannelsJson: string;
  ackTimeoutMinutes: number;
  step2Target: string;
  step2ChannelsJson: string;
}

interface AlertIncidentRow {
  id: string;
  title: string;
  severity: string;
  triggerValue: string;
  anomalyScore: string | null;
  status: "triggered" | "acknowledged" | "escalated" | "resolved";
  currentStep: number;
  escalateAt: string | null;
  acknowledgedBy: string | null;
  createdAt: string;
}

interface AnomalySnapshot {
  currentValue: number;
  baselineMean: number;
  stdDev: number;
  ewma: number;
  zScore: number;
  multiplier: number;
  isAnomaly: boolean;
  reason: string;
}

const ALL_CHANNELS = ["pagerduty", "opsgenie", "slack", "discord", "teams", "email"] as const;

export function SmartAlertsPanel({
  projectId,
  isDemo = false,
}: {
  projectId: string;
  isDemo?: boolean;
}) {
  const [rules, setRules] = useState<AlertRuleRow[]>([]);
  const [policies, setPolicies] = useState<EscalationPolicyRow[]>([]);
  const [incidents, setIncidents] = useState<AlertIncidentRow[]>([]);
  const [anomaly, setAnomaly] = useState<AnomalySnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  // Rule form
  const [ruleName, setRuleName] = useState("Crash Rate > 5% (5m)");
  const [ruleType, setRuleType] = useState<AlertRuleRow["ruleType"]>("crash_rate");
  const [thresholdPercent, setThresholdPercent] = useState(5);
  const [windowMinutes, setWindowMinutes] = useState(5);
  const [zScoreThreshold, setZScoreThreshold] = useState(2.5);
  const [policyId, setPolicyId] = useState("");
  const [ruleChannels, setRuleChannels] = useState<string[]>(["slack", "pagerduty", "email"]);

  // Escalation policy form
  const [showPolicyForm, setShowPolicyForm] = useState(false);
  const [polName, setPolName] = useState("On-Call Dev -> 15m -> Eng Lead");
  const [step1Target, setStep1Target] = useState("oncall-dev@acme.com");
  const [ackTimeout, setAckTimeout] = useState(15);
  const [step2Target, setStep2Target] = useState("eng-lead@acme.com");

  const loadSmartAlerts = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/v1/alerts/smart?projectId=${encodeURIComponent(projectId)}`);
      const d = await res.json();
      if (res.ok) {
        setRules(d.rules || []);
        setPolicies(d.policies || []);
        setIncidents(d.incidents || []);
        setAnomaly(d.anomalySnapshot || null);
      }
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    loadSmartAlerts();
  }, [loadSmartAlerts]);

  const toggleChannel = (ch: string) => {
    setRuleChannels((prev) =>
      prev.includes(ch) ? prev.filter((c) => c !== ch) : [...prev, ch]
    );
  };

  const handleCreateRule = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isDemo) {
      setMsg("Sign in to persist live Smart Alert Rules & On-Call Escalation policies.");
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/v1/alerts/smart", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId,
          action: "create_rule",
          name: ruleName,
          ruleType,
          thresholdPercent,
          windowMinutes,
          anomalyZScoreBp: Math.round(zScoreThreshold * 100),
          escalationPolicyId: policyId || undefined,
          channels: ruleChannels,
        }),
      });
      if (!res.ok) throw new Error((await res.json()).error || "Failed to create rule");
      setMsg("Smart alert rule saved.");
      await loadSmartAlerts();
    } catch (err: any) {
      setMsg(err.message);
    } finally {
      setBusy(false);
    }
  };

  const handleCreatePolicy = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isDemo) return;
    setBusy(true);
    try {
      const res = await fetch("/api/v1/alerts/smart", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId,
          action: "create_policy",
          name: polName,
          step1Target,
          step1Channels: ["slack", "discord", "email"],
          ackTimeoutMinutes: ackTimeout,
          step2Target,
          step2Channels: ["pagerduty", "opsgenie", "teams", "email"],
        }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Failed to create policy");
      if (d.policyId) setPolicyId(d.policyId);
      setShowPolicyForm(false);
      setMsg("2-step On-Call Escalation Policy created.");
      await loadSmartAlerts();
    } catch (err: any) {
      setMsg(err.message);
    } finally {
      setBusy(false);
    }
  };

  const handleIncidentAction = async (
    incidentId: string,
    action: "ack_incident" | "resolve_incident"
  ) => {
    if (isDemo) return;
    setBusy(true);
    try {
      await fetch("/api/v1/alerts/smart", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, action, incidentId }),
      });
      await loadSmartAlerts();
    } finally {
      setBusy(false);
    }
  };

  const handleRunScan = async () => {
    if (isDemo) {
      setMsg("Demo mode: Anomaly scan preview only.");
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/v1/alerts/smart", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, action: "evaluate_now" }),
      });
      const d = await res.json();
      if (d.anomalySnapshot) setAnomaly(d.anomalySnapshot);
      setMsg(
        `Scan complete: ${d.triggered || 0} rule(s) triggered, ${d.escalated || 0} incident(s) escalated.`
      );
      await loadSmartAlerts();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="p-5 rounded-2xl bg-zinc-900/90 border border-zinc-800 space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-bold text-white flex items-center gap-2">
            <BellRing className="w-4 h-4 text-red-400" />
            <span>Smart Alerting, ML Anomaly Detection &amp; On-Call Routing</span>
          </h2>
          <p className="text-xs text-zinc-400 mt-0.5">
            Route crash-rate thresholds &amp; Z-score/EWMA spike anomalies across PagerDuty, OpsGenie, Slack, Discord, Microsoft Teams, and Email with timed escalations.
          </p>
        </div>

        <button
          type="button"
          disabled={busy || loading}
          onClick={handleRunScan}
          className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-purple-600/20 hover:bg-purple-600/35 border border-purple-500/40 text-purple-200 text-xs font-semibold transition"
        >
          {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
          <span>Run Anomaly &amp; Rule Scan</span>
        </button>
      </div>

      {msg && (
        <div className="p-2.5 rounded-xl bg-zinc-950 border border-zinc-800 text-xs text-indigo-200">
          {msg}
        </div>
      )}

      {/* Live Anomaly Baseline */}
      {anomaly && (
        <div
          className={`p-3.5 rounded-xl border flex flex-wrap items-center justify-between gap-3 text-xs ${
            anomaly.isAnomaly
              ? "bg-red-950/40 border-red-700/60 text-red-200"
              : "bg-zinc-950 border-zinc-800 text-zinc-300"
          }`}
        >
          <div className="flex items-center gap-2">
            <Activity className={`w-4 h-4 ${anomaly.isAnomaly ? "text-red-400" : "text-emerald-400"}`} />
            <div>
              <div className="font-bold text-white">
                Z-Score &amp; EWMA Anomaly Baseline: {anomaly.isAnomaly ? "SPIKE DETECTED" : "Healthy"}
              </div>
              <div className="text-[11px] text-zinc-400">{anomaly.reason}</div>
            </div>
          </div>
          <div className="flex items-center gap-3 font-mono text-[11px]">
            <span>Now: <strong className="text-white">{anomaly.currentValue}/hr</strong></span>
            <span>Mean: <strong className="text-white">{anomaly.baselineMean}</strong></span>
            <span>EWMA: <strong className="text-white">{anomaly.ewma}</strong></span>
            <span>Z: <strong className={anomaly.isAnomaly ? "text-red-300" : "text-emerald-300"}>{anomaly.zScore}σ</strong></span>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Rule Builder */}
        <form
          onSubmit={handleCreateRule}
          className="p-4 rounded-xl bg-zinc-950 border border-zinc-800 space-y-3"
        >
          <div className="text-xs font-bold text-white">Create Smart Alert Rule</div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <input
              type="text"
              value={ruleName}
              onChange={(e) => setRuleName(e.target.value)}
              placeholder="Rule Name"
              className="px-3 py-1.5 rounded-lg bg-zinc-900 border border-zinc-800 text-xs text-white"
            />
            <select
              value={ruleType}
              onChange={(e) => setRuleType(e.target.value as any)}
              className="px-3 py-1.5 rounded-lg bg-zinc-900 border border-zinc-800 text-xs text-white"
            >
              <option value="crash_rate">Crash Rate &gt; Threshold %</option>
              <option value="error_spike_anomaly">ML Spike Anomaly (Z-Score + EWMA)</option>
              <option value="uptime_down">Uptime Endpoint Down</option>
              <option value="latency_p95">P95 Latency &gt; Threshold (ms)</option>
            </select>
          </div>

          <div className="grid grid-cols-3 gap-2">
            {ruleType === "error_spike_anomaly" ? (
              <div>
                <label className="block text-[10px] text-zinc-500 mb-0.5">Z-Score (σ)</label>
                <input
                  type="number"
                  step="0.1"
                  min="1.5"
                  max="6"
                  value={zScoreThreshold}
                  onChange={(e) => setZScoreThreshold(Number(e.target.value))}
                  className="w-full px-2.5 py-1.5 rounded-lg bg-zinc-900 border border-zinc-800 text-xs text-white font-mono"
                />
              </div>
            ) : (
              <div>
                <label className="block text-[10px] text-zinc-500 mb-0.5">
                  {ruleType === "latency_p95" ? "Max P95 (ms)" : "Threshold (%)"}
                </label>
                <input
                  type="number"
                  min="1"
                  value={thresholdPercent}
                  onChange={(e) => setThresholdPercent(Number(e.target.value))}
                  className="w-full px-2.5 py-1.5 rounded-lg bg-zinc-900 border border-zinc-800 text-xs text-white font-mono"
                />
              </div>
            )}
            <div>
              <label className="block text-[10px] text-zinc-500 mb-0.5">Window (min)</label>
              <input
                type="number"
                min="1"
                value={windowMinutes}
                onChange={(e) => setWindowMinutes(Number(e.target.value))}
                className="w-full px-2.5 py-1.5 rounded-lg bg-zinc-900 border border-zinc-800 text-xs text-white font-mono"
              />
            </div>
            <div>
              <label className="block text-[10px] text-zinc-500 mb-0.5">Escalation Policy</label>
              <select
                value={policyId}
                onChange={(e) => setPolicyId(e.target.value)}
                className="w-full px-2 py-1.5 rounded-lg bg-zinc-900 border border-zinc-800 text-xs text-white"
              >
                <option value="">Direct Channels</option>
                {policies.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="flex flex-wrap gap-1.5">
            {ALL_CHANNELS.map((ch) => {
              const active = ruleChannels.includes(ch);
              return (
                <button
                  key={ch}
                  type="button"
                  onClick={() => toggleChannel(ch)}
                  className={`px-2 py-1 rounded-md text-[10px] font-semibold border transition ${
                    active
                      ? "bg-indigo-600/25 border-indigo-500 text-indigo-200"
                      : "bg-zinc-900 border-zinc-800 text-zinc-500"
                  }`}
                >
                  {ch}
                </button>
              );
            })}
          </div>

          <button
            type="submit"
            disabled={busy}
            className="w-full py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold flex items-center justify-center gap-1.5"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Add Alert Rule</span>
          </button>
        </form>

        {/* Escalation Policies */}
        <div className="p-4 rounded-xl bg-zinc-950 border border-zinc-800 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-white">On-Call Escalation Policies</span>
            {!isDemo && (
              <button
                type="button"
                onClick={() => setShowPolicyForm((s) => !s)}
                className="text-[11px] text-indigo-400 hover:underline"
              >
                {showPolicyForm ? "Cancel" : "+ New Policy"}
              </button>
            )}
          </div>

          {showPolicyForm && (
            <form onSubmit={handleCreatePolicy} className="space-y-2 p-3 rounded-lg bg-zinc-900 border border-zinc-800">
              <input
                type="text"
                value={polName}
                onChange={(e) => setPolName(e.target.value)}
                placeholder="Policy name"
                className="w-full px-2.5 py-1.5 rounded bg-zinc-950 border border-zinc-800 text-xs text-white"
              />
              <div className="grid grid-cols-3 gap-2">
                <input
                  type="text"
                  value={step1Target}
                  onChange={(e) => setStep1Target(e.target.value)}
                  placeholder="Step 1: On-Call Dev"
                  className="px-2.5 py-1.5 rounded bg-zinc-950 border border-zinc-800 text-xs text-white"
                />
                <input
                  type="number"
                  min="1"
                  value={ackTimeout}
                  onChange={(e) => setAckTimeout(Number(e.target.value))}
                  title="Ack timeout minutes"
                  className="px-2.5 py-1.5 rounded bg-zinc-950 border border-zinc-800 text-xs text-white font-mono"
                />
                <input
                  type="text"
                  value={step2Target}
                  onChange={(e) => setStep2Target(e.target.value)}
                  placeholder="Step 2: Eng Lead"
                  className="px-2.5 py-1.5 rounded bg-zinc-950 border border-zinc-800 text-xs text-white"
                />
              </div>
              <button
                type="submit"
                disabled={busy}
                className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold"
              >
                Save Escalation Policy
              </button>
            </form>
          )}

          <div className="space-y-2 max-h-44 overflow-y-auto">
            {policies.length === 0 ? (
              <div className="text-xs text-zinc-500 py-2">
                No escalation policies yet. Create one to auto-escalate unacknowledged alerts after 15 minutes.
              </div>
            ) : (
              policies.map((p) => (
                <div
                  key={p.id}
                  className="p-2.5 rounded-lg bg-zinc-900 border border-zinc-800 flex items-center justify-between gap-2 text-xs"
                >
                  <div>
                    <div className="font-semibold text-white">{p.name}</div>
                    <div className="text-[11px] text-zinc-400">
                      Step 1: {p.step1Target} &rarr; {p.ackTimeoutMinutes}m no ack &rarr; Step 2:{" "}
                      {p.step2Target}
                    </div>
                  </div>
                  {!isDemo && (
                    <button
                      type="button"
                      onClick={async () => {
                        await fetch("/api/v1/alerts/smart", {
                          method: "POST",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({
                            projectId,
                            action: "delete_policy",
                            policyId: p.id,
                          }),
                        });
                        loadSmartAlerts();
                      }}
                      className="text-zinc-500 hover:text-red-400 p-1"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* Configured Rules + Active Escalation Incidents */}
      {rules.length > 0 && (
        <div className="space-y-2">
          <div className="text-xs font-bold text-white">Active Rules ({rules.length})</div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {rules.map((r) => (
              <div
                key={r.id}
                className="p-3 rounded-xl bg-zinc-950 border border-zinc-800 flex items-center justify-between gap-2 text-xs"
              >
                <div>
                  <div className="font-semibold text-white">{r.name}</div>
                  <div className="text-[11px] text-zinc-400 font-mono">
                    {r.ruleType} •{" "}
                    {r.ruleType === "error_spike_anomaly"
                      ? `Z >= ${(r.anomalyZScoreBp / 100).toFixed(1)}σ`
                      : `Threshold ${r.thresholdPercent} / ${r.windowMinutes}m`}
                  </div>
                </div>
                {!isDemo && (
                  <button
                    type="button"
                    onClick={async () => {
                      await fetch("/api/v1/alerts/smart", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ projectId, action: "delete_rule", ruleId: r.id }),
                      });
                      loadSmartAlerts();
                    }}
                    className="text-zinc-500 hover:text-red-400 p-1"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {incidents.length > 0 && (
        <div className="space-y-2">
          <div className="text-xs font-bold text-white flex items-center gap-1.5">
            <ShieldAlert className="w-3.5 h-3.5 text-amber-400" />
            <span>On-Call Alert Incidents ({incidents.length})</span>
          </div>
          <div className="space-y-2">
            {incidents.slice(0, 6).map((inc) => (
              <div
                key={inc.id}
                className="p-3 rounded-xl bg-zinc-950 border border-zinc-800 flex flex-wrap items-center justify-between gap-2 text-xs"
              >
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-white">{inc.title}</span>
                    <span
                      className={`text-[10px] uppercase font-bold px-2 py-0.5 rounded-full ${
                        inc.status === "resolved"
                          ? "bg-emerald-500/15 text-emerald-300"
                          : inc.status === "acknowledged"
                          ? "bg-cyan-500/15 text-cyan-300"
                          : inc.status === "escalated"
                          ? "bg-red-500/20 text-red-300"
                          : "bg-amber-500/20 text-amber-300"
                      }`}
                    >
                      {inc.status} (Step {inc.currentStep})
                    </span>
                  </div>
                  <div className="text-[11px] text-zinc-400 mt-0.5 font-mono">
                    {inc.triggerValue}
                    {inc.anomalyScore ? ` • ${inc.anomalyScore}` : ""}
                    {inc.acknowledgedBy ? ` • Acked by @${inc.acknowledgedBy}` : ""}
                  </div>
                </div>
                {!isDemo && inc.status !== "resolved" && (
                  <div className="flex items-center gap-2">
                    {inc.status !== "acknowledged" && (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => handleIncidentAction(inc.id, "ack_incident")}
                        className="px-2.5 py-1 rounded-lg bg-cyan-600/20 hover:bg-cyan-600/35 border border-cyan-500/40 text-cyan-200 text-[11px] font-semibold flex items-center gap-1"
                      >
                        <Check className="w-3 h-3" />
                        <span>Acknowledge</span>
                      </button>
                    )}
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => handleIncidentAction(inc.id, "resolve_incident")}
                      className="px-2.5 py-1 rounded-lg bg-emerald-600/20 hover:bg-emerald-600/35 border border-emerald-500/40 text-emerald-200 text-[11px] font-semibold"
                    >
                      Resolve
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
