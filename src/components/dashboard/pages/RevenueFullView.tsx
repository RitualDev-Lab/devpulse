"use client";

import React, { useState } from "react";
import {
  CreditCard,
  Plus,
  Trash2,
  Loader2,
  ExternalLink,
  CheckCircle2,
  DollarSign,
  TrendingUp,
} from "lucide-react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import type { LoadedWorkspaceReady } from "@/lib/dashboard/load-workspace";
import { WorkspaceShell } from "../WorkspaceShell";
import { RevenueStatsCard } from "../widgets/RevenueStatsCard";
import { BillingModal } from "../BillingModal";

const PAYMENT_PROVIDERS = [
  { id: "lemonsqueezy", label: "Lemon Squeezy" },
  { id: "polar", label: "Polar.sh" },
  { id: "paddle", label: "Paddle" },
  { id: "gumroad", label: "Gumroad" },
  { id: "stripe", label: "Stripe (Extra Account)" },
  { id: "dodo", label: "Dodo Payments (Extra)" },
  { id: "razorpay", label: "Razorpay" },
  { id: "custom", label: "Custom Payment Webhook / JSON" },
];

export function RevenueFullView({ workspace }: { workspace: LoadedWorkspaceReady }) {
  const { initialData, projects, customDomain, storageTier, isDemo } = workspace;
  const project = initialData.project;
  const connectors = (initialData.connectors || []).filter((c) => c.category === "payment");

  const [isBillingOpen, setIsBillingOpen] = useState(false);
  const [provider, setProvider] = useState("lemonsqueezy");
  const [label, setLabel] = useState("");
  const [targetUrl, setTargetUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<{ ok: boolean; msg: string } | null>(null);

  const handleAddConnector = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isDemo) {
      setFeedback({ ok: false, msg: "Sign in with GitHub to attach live payment connectors." });
      return;
    }
    setSaving(true);
    setFeedback(null);
    try {
      const res = await fetch("/api/v1/projects/connectors", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "add_connector",
          projectId: project.id,
          category: "payment",
          provider,
          label: label.trim() || PAYMENT_PROVIDERS.find((p) => p.id === provider)?.label || provider,
          targetUrl: targetUrl.trim() || undefined,
          apiKey: apiKey.trim() || undefined,
        }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Failed to add payment connector");
      setFeedback({ ok: true, msg: "Payment connector encrypted & added! Refreshing..." });
      setLabel("");
      setTargetUrl("");
      setApiKey("");
      setTimeout(() => window.location.reload(), 600);
    } catch (err: any) {
      setFeedback({ ok: false, msg: err.message || "Failed to add payment provider" });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (connectorId: string) => {
    if (isDemo) return;
    await fetch("/api/v1/projects/connectors", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "delete_connector", projectId: project.id, connectorId }),
    });
    window.location.reload();
  };

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
              <DollarSign className="w-6 h-6 text-emerald-400" />
              <span>Revenue, Flexible Payments &amp; DevPulse Plan</span>
            </h1>
            <p className="text-xs text-zinc-400 mt-0.5">
              Connect any payment provider (Stripe, Dodo, Lemon Squeezy, Polar.sh, Paddle, Gumroad, Razorpay) or manage your DevPulse subscription.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setIsBillingOpen(true)}
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold shadow-lg shadow-emerald-600/20"
          >
            <CreditCard className="w-4 h-4" />
            <span>Manage DevPulse Plan ({storageTier.toUpperCase()}) &amp; Sync</span>
          </button>
        </div>

        {/* Built-in + Combined Multi-Provider MRR Chart & Breakdown */}
        {initialData.revenueStats && (
          <div className="p-5 rounded-2xl bg-zinc-900/90 border border-zinc-800 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="text-sm font-bold text-white flex items-center gap-2">
                  <TrendingUp className="w-4 h-4 text-emerald-400" />
                  <span>Combined Multi-Provider MRR &amp; Revenue Trend</span>
                </h2>
                <p className="text-xs text-zinc-400">
                  Unified daily revenue across all active payment connectors ({initialData.revenueStats.providerBreakdown?.length || 1} source(s))
                </p>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {(initialData.revenueStats.providerBreakdown || []).map((b, idx) => (
                  <span
                    key={`${b.provider}-${idx}`}
                    className="text-[11px] font-mono px-2.5 py-1 rounded-full bg-emerald-500/15 border border-emerald-500/30 text-emerald-200"
                  >
                    {b.label}: ${b.mrr.toLocaleString()} MRR
                  </span>
                ))}
              </div>
            </div>
            <div className="h-48">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={initialData.revenueStats.history || []}>
                  <XAxis dataKey="date" tick={{ fill: "#71717a", fontSize: 10 }} />
                  <YAxis tick={{ fill: "#71717a", fontSize: 10 }} width={40} />
                  <Tooltip
                    contentStyle={{ backgroundColor: "#09090b", borderColor: "#27272a", borderRadius: "8px", fontSize: "12px" }}
                  />
                  <Area type="monotone" dataKey="amount" name="Revenue" stroke="#10b981" fill="#10b98125" strokeWidth={2} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}

        {/* Built-in Stripe / Dodo / GitHub Sponsors Overview */}
        <RevenueStatsCard stats={initialData.revenueStats || null} projectId={project.id} />

        {/* Add ANY Payment Provider Form */}
        <form
          onSubmit={handleAddConnector}
          className="p-5 rounded-2xl bg-zinc-900/90 border border-zinc-800 space-y-4"
        >
          <div>
            <h2 className="text-sm font-bold text-white flex items-center gap-2">
              <Plus className="w-4 h-4 text-emerald-400" />
              <span>Add Any Payment Provider (Encrypted AES-256-GCM)</span>
            </h2>
            <p className="text-xs text-zinc-400 mt-0.5">
              Attach as many stores or gateways as you use — Lemon Squeezy, Polar, Paddle, Gumroad, Razorpay, or a custom JSON feed.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <select
              value={provider}
              onChange={(e) => setProvider(e.target.value)}
              className="px-3 py-2 rounded-xl bg-zinc-950 border border-zinc-800 text-xs text-white"
            >
              {PAYMENT_PROVIDERS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
            <input
              type="text"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="Store / Label (e.g. SaaS Pro Store)"
              className="px-3 py-2 rounded-xl bg-zinc-950 border border-zinc-800 text-xs text-white placeholder-zinc-600"
            />
            <input
              type="url"
              value={targetUrl}
              onChange={(e) => setTargetUrl(e.target.value)}
              placeholder="Store / Checkout URL (optional)"
              className="px-3 py-2 rounded-xl bg-zinc-950 border border-zinc-800 text-xs font-mono text-white placeholder-zinc-600"
            />
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="Read-only API Key / Token"
              className="px-3 py-2 rounded-xl bg-zinc-950 border border-zinc-800 text-xs font-mono text-white placeholder-zinc-600"
            />
          </div>

          {feedback && (
            <div
              className={`p-3 rounded-xl text-xs border ${
                feedback.ok
                  ? "bg-emerald-950/60 border-emerald-700/60 text-emerald-200"
                  : "bg-red-950/60 border-red-700/60 text-red-200"
              }`}
            >
              {feedback.msg}
            </div>
          )}

          <div className="flex justify-end">
            <button
              type="submit"
              disabled={saving}
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold disabled:opacity-50"
            >
              {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
              <span>Save Payment Connector</span>
            </button>
          </div>
        </form>

        {/* Connected Flexible Payment Providers List */}
        {connectors.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {connectors.map((c) => {
              let meta: any = null;
              try {
                meta = c.metadataJson ? JSON.parse(c.metadataJson) : null;
              } catch {
                meta = null;
              }
              return (
                <div
                  key={c.id}
                  className="p-4 rounded-2xl bg-zinc-900/90 border border-zinc-800 flex flex-col justify-between gap-3"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
                        {c.provider}
                      </span>
                      <h3 className="text-sm font-bold text-white mt-1.5">{c.label}</h3>
                      {c.targetUrl && (
                        <a
                          href={c.targetUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 text-[11px] font-mono text-indigo-400 hover:text-indigo-300 mt-0.5"
                        >
                          <span className="truncate max-w-[200px]">{c.targetUrl}</span>
                          <ExternalLink className="w-3 h-3" />
                        </a>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => handleDelete(c.id)}
                      className="p-1.5 rounded-lg bg-zinc-950 hover:bg-red-950/60 text-zinc-500 hover:text-red-300 border border-zinc-800"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  {meta ? (
                    <div className="p-2.5 rounded-xl bg-zinc-950 border border-zinc-800 flex items-center justify-between text-xs">
                      <span className="text-zinc-400">
                        Sales: <strong className="text-white">{meta.totalSales ?? 0}</strong>
                      </span>
                      <span className="font-mono font-bold text-emerald-300">
                        {((meta.totalRevenueCents || 0) / 100).toLocaleString()} {meta.currency || "USD"}
                      </span>
                    </div>
                  ) : (
                    <div className="text-[11px] text-zinc-500 flex items-center gap-1">
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
                      <span>{c.hasCredentials ? "API Key Encrypted at Rest" : "Linked Payment Store"}</span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      <BillingModal
        isOpen={isBillingOpen}
        onClose={() => setIsBillingOpen(false)}
        storageTier={storageTier}
        isDemo={isDemo}
      />
    </WorkspaceShell>
  );
}
