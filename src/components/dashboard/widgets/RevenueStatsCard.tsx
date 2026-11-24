"use client";

import React, { useState } from "react";
import {
  DollarSign,
  TrendingUp,
  CreditCard,
  Users,
  Repeat,
  ExternalLink,
  Settings,
  CheckCircle2,
  Lock,
} from "lucide-react";
import type { RevenueStats } from "@/lib/integrations/revenue";
import { formatNumber, formatDate, formatCurrency } from "@/lib/utils/format";

interface RevenueStatsCardProps {
  stats: RevenueStats | null;
  projectId: string;
}

export function RevenueStatsCard({ stats, projectId }: RevenueStatsCardProps) {
  const [isConfigOpen, setIsConfigOpen] = useState(false);
  const [stripeKey, setStripeKey] = useState("");
  const [dodoKey, setDodoKey] = useState("");
  const [dodoEnv, setDodoEnv] = useState<"live" | "test">("live");
  const [isSaving, setIsSaving] = useState(false);
  const [savedSuccess, setSavedSuccess] = useState(false);

  const data = stats;
  const history = data?.history || [];
  const maxAmount = Math.max(...history.map((h) => h.amount), 1);

  // SVG dimensions
  const width = 320;
  const height = 65;
  const points = history
    .map((point, index) => {
      const x = (index / Math.max(history.length - 1, 1)) * width;
      const y = height - (point.amount / maxAmount) * (height - 12);
      return `${x},${y}`;
    })
    .join(" ");

  const handleSaveConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    try {
      const res = await fetch("/api/v1/projects/revenue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId,
          stripeApiKey: stripeKey,
          dodoPaymentsApiKey: dodoKey,
          dodoPaymentsEnvironment: dodoEnv,
        }),
      });
      if (res.ok) {
        setSavedSuccess(true);
        setTimeout(() => {
          setSavedSuccess(false);
          setIsConfigOpen(false);
          window.location.reload();
        }, 1200);
      }
    } catch {
      // ignore
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="flex flex-col h-full justify-between p-5 rounded-2xl bg-zinc-900/90 border border-zinc-800/80 shadow-lg shadow-black/40 hover:border-zinc-700 transition">
      <div>
        {/* Header */}
        <div className="flex items-center justify-between mb-3.5">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-emerald-950/80 border border-emerald-800/60 flex items-center justify-center text-emerald-400">
              <DollarSign className="w-4 h-4" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-semibold text-white text-base leading-tight">
                  Developer Revenue
                </h3>
                {data?.provider === "dodo" ? (
                  <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-purple-500/10 text-purple-400 border border-purple-500/20">
                    Dodo Payments (Live)
                  </span>
                ) : data?.isDemo ? (
                  <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                    Live Demo
                  </span>
                ) : null}
              </div>
              <p className="text-xs text-zinc-400">MRR, Net Volume & Subscriptions</p>
            </div>
          </div>
          <button
            onClick={() => setIsConfigOpen(true)}
            className="flex items-center gap-1 text-[11px] px-2.5 py-1 rounded-xl bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-zinc-300 hover:text-white transition"
            title="Configure Payment Keys"
          >
            <Settings className="w-3.5 h-3.5" />
            <span>Manage</span>
          </button>
        </div>

        {!data ? (
          /* Empty / Unconnected State */
          <div className="py-8 px-4 text-center rounded-xl bg-zinc-950/60 border border-zinc-800/60 flex flex-col items-center justify-center space-y-2 mb-3">
            <CreditCard className="w-8 h-8 text-emerald-400/80 mb-1" />
            <h4 className="text-sm font-semibold text-white">No Payment Provider Connected</h4>
            <p className="text-xs text-zinc-400 max-w-sm">
              Track your project&apos;s real MRR, 30-day volume, and subscribers by connecting a read-only Stripe or Dodo Payments key.
            </p>
            <button
              onClick={() => setIsConfigOpen(true)}
              className="mt-2 inline-flex items-center gap-1.5 px-4 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-xs font-semibold text-white transition shadow-sm"
            >
              <DollarSign className="w-3.5 h-3.5" />
              <span>Connect Payments</span>
            </button>
          </div>
        ) : (
          <>
            {/* 4 Metric Counters */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-3.5">
              <div className="p-2.5 rounded-xl bg-zinc-950/60 border border-zinc-800/60">
                <span className="text-[10px] text-zinc-400 block mb-0.5">Monthly (MRR)</span>
                <div className="flex items-center gap-1">
                  <span className="text-base font-bold text-emerald-400 font-mono">
                    {formatCurrency(data.mrr || 0, data.currency)}
                  </span>
                </div>
              </div>

              <div className="p-2.5 rounded-xl bg-zinc-950/60 border border-zinc-800/60">
                <span className="text-[10px] text-zinc-400 block mb-0.5">30-Day Volume</span>
                <div className="flex items-center gap-1">
                  <span className="text-sm font-bold text-white font-mono">
                    {formatCurrency(data.netVolume30Days || 0, data.currency)}
                  </span>
                </div>
              </div>

              <div className="p-2.5 rounded-xl bg-zinc-950/60 border border-zinc-800/60">
                <span className="text-[10px] text-zinc-400 block mb-0.5">Active Subs</span>
                <div className="flex items-center gap-1 text-zinc-200">
                  <Repeat className="w-3 h-3 text-emerald-400" />
                  <span className="text-sm font-bold font-mono">
                    {formatNumber(data.activeSubscriptions || 0)}
                  </span>
                </div>
              </div>

              <div className="p-2.5 rounded-xl bg-zinc-950/60 border border-zinc-800/60">
                <span className="text-[10px] text-zinc-400 block mb-0.5">Customers</span>
                <div className="flex items-center gap-1 text-zinc-200">
                  <Users className="w-3 h-3 text-cyan-400" />
                  <span className="text-sm font-bold font-mono">
                    {formatNumber(data.payingCustomers || 0)}
                  </span>
                </div>
              </div>
            </div>

            {/* 30-Day Velocity Chart */}
            <div className="mt-2 mb-3">
              <div className="flex items-center justify-between text-[11px] text-zinc-400 mb-1.5">
                <span className="flex items-center gap-1 text-zinc-300">
                  <TrendingUp className="w-3.5 h-3.5 text-emerald-400" /> 30-Day Inflow Velocity
                </span>
                <span className="font-mono">Peak: {formatCurrency(maxAmount, data.currency)}</span>
              </div>

              <div className="w-full h-16 rounded-xl bg-zinc-950/70 border border-zinc-800/70 p-2 overflow-hidden relative">
                <svg
                  viewBox={`0 0 ${width} ${height}`}
                  className="w-full h-full overflow-visible"
                  preserveAspectRatio="none"
                >
                  <defs>
                    <linearGradient id="revenueGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#10b981" stopOpacity="0.4" />
                      <stop offset="100%" stopColor="#10b981" stopOpacity="0.0" />
                    </linearGradient>
                  </defs>

                  {points && (
                    <>
                      <polygon
                        points={`0,${height} ${points} ${width},${height}`}
                        fill="url(#revenueGradient)"
                      />
                      <polyline
                        fill="none"
                        stroke="#10b981"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        points={points}
                      />
                    </>
                  )}
                </svg>
              </div>
            </div>

            {/* Recent Transactions */}
            {data.recentTransactions && data.recentTransactions.length > 0 && (
              <div className="space-y-1.5 pt-2 border-t border-zinc-800/60">
                <div className="flex items-center justify-between text-[10px] uppercase font-semibold text-zinc-400 px-1">
                  <span>Recent Payments</span>
                  <span>Status / Platform</span>
                </div>
                {data.recentTransactions.slice(0, 4).map((tx) => (
                  <div
                    key={tx.id}
                    className="flex items-center justify-between p-2 rounded-xl bg-zinc-950/50 border border-zinc-800/60 text-xs"
                  >
                    <div className="flex items-center gap-2 truncate pr-2">
                      <span
                        className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                          tx.status === "succeeded" ? "bg-emerald-400" : "bg-amber-400"
                        }`}
                      ></span>
                      <span className="text-zinc-200 truncate font-medium">{tx.customer}</span>
                      <span className="text-[10px] text-zinc-500 font-mono hidden sm:inline">
                        {tx.date}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="font-mono font-bold text-emerald-400">
                        +{formatCurrency(tx.amount, tx.currency)}
                      </span>
                      <span
                        className={`text-[9px] font-semibold uppercase px-1.5 py-0.5 rounded ${
                          tx.provider === "dodo"
                            ? "bg-purple-900/60 text-purple-300 border border-purple-700/60"
                            : "bg-blue-900/60 text-blue-300 border border-blue-700/60"
                        }`}
                      >
                        {tx.provider === "dodo" ? "Dodo" : "Stripe"}
                      </span>
                      <span
                        className={`text-[9px] font-semibold px-1.5 py-0.5 rounded ${
                          tx.status === "succeeded"
                            ? "bg-emerald-950 text-emerald-400 border border-emerald-800"
                            : "bg-amber-950 text-amber-400 border border-amber-800"
                        }`}
                      >
                        {tx.status}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>

      {/* Footer Info */}
      <div className="mt-3 pt-2 flex items-center justify-between text-[11px] text-zinc-500 border-t border-zinc-800/40">
        <span className="flex items-center gap-1.5">
          <CreditCard className="w-3.5 h-3.5 text-zinc-400" />
          <span>Stripe &bull; Dodo Payments &bull; Sponsors</span>
        </span>
        <span className="text-[10px] text-zinc-400 font-mono">Auto-Sync</span>
      </div>

      {/* Connect Keys Modal */}
      {isConfigOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-150">
          <div className="w-full max-w-md bg-zinc-900 border border-zinc-700 rounded-2xl shadow-2xl p-6 text-left relative">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-emerald-950 border border-emerald-800 flex items-center justify-center text-emerald-400">
                  <DollarSign className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="font-bold text-white text-base">Connect Developer Payments</h3>
                  <p className="text-xs text-zinc-400">Track real MRR and transaction volume</p>
                </div>
              </div>
              <button
                onClick={() => setIsConfigOpen(false)}
                className="text-zinc-400 hover:text-white p-1 rounded-lg hover:bg-zinc-800"
              >
                &times;
              </button>
            </div>

            <form onSubmit={handleSaveConfig} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-zinc-200 mb-1">
                  Stripe Restricted Key (Read-Only)
                </label>
                <div className="relative">
                  <input
                    type="password"
                    placeholder="rk_live_... or rk_test_..."
                    value={stripeKey}
                    onChange={(e) => setStripeKey(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl bg-zinc-950 border border-zinc-800 text-xs text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-emerald-500"
                  />
                  <Lock className="w-3.5 h-3.5 text-zinc-500 absolute right-3 top-2.5" />
                </div>
                <span className="text-[10px] text-zinc-500 mt-0.5 block">
                  Tip: Create a read-only key restricted to Charges & Subscriptions.
                </span>
              </div>

              <div>
                <label className="block text-xs font-semibold text-zinc-200 mb-1">
                  Dodo Payments API Key
                </label>
                <div className="relative">
                  <input
                    type="password"
                    placeholder="dp_live_... or dp_test_..."
                    value={dodoKey}
                    onChange={(e) => setDodoKey(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl bg-zinc-950 border border-zinc-800 text-xs text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-emerald-500"
                  />
                  <Lock className="w-3.5 h-3.5 text-zinc-500 absolute right-3 top-2.5" />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-zinc-200 mb-1">
                  Dodo Environment
                </label>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <button
                    type="button"
                    onClick={() => setDodoEnv("live")}
                    className={`py-1.5 rounded-xl border text-center font-medium transition ${
                      dodoEnv === "live"
                        ? "bg-emerald-950/80 border-emerald-500 text-emerald-300"
                        : "bg-zinc-950 border-zinc-800 text-zinc-400"
                    }`}
                  >
                    Live Mode
                  </button>
                  <button
                    type="button"
                    onClick={() => setDodoEnv("test")}
                    className={`py-1.5 rounded-xl border text-center font-medium transition ${
                      dodoEnv === "test"
                        ? "bg-purple-950/80 border-purple-500 text-purple-300"
                        : "bg-zinc-950 border-zinc-800 text-zinc-400"
                    }`}
                  >
                    Test Sandbox
                  </button>
                </div>
              </div>

              <div className="pt-2 flex items-center justify-end gap-2 border-t border-zinc-800">
                <button
                  type="button"
                  onClick={() => setIsConfigOpen(false)}
                  className="px-3.5 py-1.5 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSaving}
                  className="px-4 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold transition disabled:opacity-50 flex items-center gap-1.5"
                >
                  {savedSuccess ? (
                    <>
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      <span>Saved!</span>
                    </>
                  ) : (
                    <span>{isSaving ? "Saving..." : "Save Keys"}</span>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
