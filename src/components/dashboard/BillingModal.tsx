"use client";

import React, { useState } from "react";
import { CreditCard, X, Check, Sparkles, Plus, Loader2 } from "lucide-react";
import {
  PLAN_DEFINITIONS,
  EXTRA_DOMAIN_ADDON_PRICE_MONTHLY,
  normalizeTier,
} from "@/lib/billing/plans";

interface BillingModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentTier: string;
  extraCustomDomains?: number;
}

export function BillingModal({
  isOpen,
  onClose,
  currentTier,
  extraCustomDomains = 0,
}: BillingModalProps) {
  const [loadingSku, setLoadingSku] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  if (!isOpen) return null;

  const activeTier = normalizeTier(currentTier);

  const startCheckout = async (sku: "pro" | "team" | "extra_domain") => {
    setLoadingSku(sku);
    setErrorMsg(null);
    try {
      const res = await fetch("/api/v1/billing/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sku }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.checkoutUrl) {
        throw new Error(json.error || "Failed to initialize Dodo checkout.");
      }
      window.location.assign(json.checkoutUrl);
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : "Unable to open checkout");
      setLoadingSku(null);
    }
  };

  const plans = [PLAN_DEFINITIONS.free, PLAN_DEFINITIONS.pro, PLAN_DEFINITIONS.team];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-150">
      <div className="w-full max-w-3xl bg-zinc-900 border border-zinc-700 rounded-2xl shadow-2xl p-6 text-left relative max-h-[92vh] flex flex-col">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-emerald-950 border border-emerald-800 flex items-center justify-center text-emerald-400">
              <CreditCard className="w-4 h-4" />
            </div>
            <div>
              <h3 className="font-bold text-white text-base">DevPulse Plans &amp; Storage Upgrades</h3>
              <p className="text-xs text-zinc-400">
                Powered by Dodo Payments &bull; Current Plan:{" "}
                <span className="text-white font-semibold uppercase">{activeTier}</span>
                {extraCustomDomains > 0 ? ` (+${extraCustomDomains} extra domains)` : ""}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-zinc-400 hover:text-white p-1 rounded-lg hover:bg-zinc-800"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {errorMsg && (
          <div className="mb-4 p-3 rounded-xl bg-amber-950/40 border border-amber-500/30 text-amber-200 text-xs">
            {errorMsg}
          </div>
        )}

        <div className="overflow-y-auto space-y-4 pr-1 flex-1">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {plans.map((plan) => {
              const isCurrent = activeTier === plan.tier;
              const isPro = plan.tier === "pro";

              return (
                <div
                  key={plan.tier}
                  className={`p-4 rounded-2xl border flex flex-col justify-between space-y-4 ${
                    isPro
                      ? "bg-indigo-950/25 border-indigo-500/60 shadow-lg shadow-indigo-500/10"
                      : "bg-zinc-950/70 border-zinc-800"
                  }`}
                >
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold uppercase tracking-wider text-zinc-300">
                        {plan.label}
                      </span>
                      {isPro && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-indigo-500/20 text-indigo-300 text-[10px] font-semibold">
                          <Sparkles className="w-3 h-3" /> Popular
                        </span>
                      )}
                    </div>

                    <div className="flex items-baseline gap-1">
                      <span className="text-3xl font-extrabold text-white">${plan.priceMonthly}</span>
                      <span className="text-xs text-zinc-500">/month</span>
                    </div>

                    <ul className="space-y-2 text-xs text-zinc-300">
                      {plan.features.map((feat) => (
                        <li key={feat} className="flex items-start gap-2">
                          <Check className="w-3.5 h-3.5 text-emerald-400 shrink-0 mt-0.5" />
                          <span>{feat}</span>
                        </li>
                      ))}
                    </ul>
                  </div>

                  {plan.tier === "free" ? (
                    <div className="w-full py-2 rounded-xl bg-zinc-900 border border-zinc-800 text-center text-xs font-medium text-zinc-400">
                      {isCurrent ? "Active Base Tier" : "Included Free"}
                    </div>
                  ) : (
                    <button
                      type="button"
                      disabled={isCurrent || loadingSku !== null}
                      onClick={() => startCheckout(plan.tier as "pro" | "team")}
                      className={`w-full py-2.5 rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 transition ${
                        isCurrent
                          ? "bg-emerald-950/40 border border-emerald-500/40 text-emerald-300"
                          : isPro
                            ? "bg-indigo-600 hover:bg-indigo-500 text-white shadow-lg shadow-indigo-600/20"
                            : "bg-zinc-800 hover:bg-zinc-700 text-white"
                      }`}
                    >
                      {loadingSku === plan.tier && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                      <span>
                        {isCurrent ? "Current Plan" : `Upgrade to ${plan.label}`}
                      </span>
                    </button>
                  )}
                </div>
              );
            })}
          </div>

          {/* Extra Custom Domain Add-on */}
          <div className="p-4 rounded-2xl bg-zinc-950 border border-zinc-800 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
            <div>
              <h4 className="text-xs font-bold text-white flex items-center gap-1.5">
                <Plus className="w-3.5 h-3.5 text-cyan-400" />
                <span>Extra Custom Domain Slot (+${EXTRA_DOMAIN_ADDON_PRICE_MONTHLY}/mo)</span>
              </h4>
              <p className="text-[11px] text-zinc-400 mt-0.5">
                Add additional white-label custom hostnames (stats.product2.dev) with automatic Cloudflare SSL.
              </p>
            </div>
            <button
              type="button"
              disabled={loadingSku !== null}
              onClick={() => startCheckout("extra_domain")}
              className="px-4 py-2 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-xs font-semibold text-white shrink-0 flex items-center gap-1.5 transition"
            >
              {loadingSku === "extra_domain" && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              <span>Add Domain Slot (+${EXTRA_DOMAIN_ADDON_PRICE_MONTHLY}/mo)</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
