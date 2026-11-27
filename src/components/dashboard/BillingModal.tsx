"use client";

import { PORTAL_DOMAIN } from "@/lib/config/app-url";
import React, { useState, useEffect } from "react";
import {
  CreditCard,
  X,
  Check,
  Sparkles,
  ExternalLink,
  AlertCircle,
  Loader2,
  Receipt,
  Plus,
  HardDrive,
  Globe,
  FolderGit2,
  RefreshCw,
} from "lucide-react";
import { ModalShell } from "./ModalShell";

interface BillingModalProps {
  isOpen: boolean;
  onClose: () => void;
  storageTier: string;
  isDemo?: boolean;
}

interface BillingProfile {
  tier: "free" | "pro" | "team";
  subscriptionStatus: string;
  currentPeriodEnd: string | null;
  hasDodoCustomer: boolean;
  hasStripeCustomer: boolean;
  entitlements: {
    maxProjects: number | null;
    maxCustomDomains: number;
    extraCustomDomains: number;
    storageLimitBytes: number;
    extraStorageGb: number;
    historyDays: number;
    allowCustomCss: boolean;
    allowByos: boolean;
  };
  usage: {
    projectCount: number;
    customDomainCount: number;
    storageUsedBytes: number;
  };
  invoices: Array<{
    id: string;
    provider: string;
    eventType: string;
    paymentId: string | null;
    itemKey: string | null;
    amountCents: number;
    currency: string;
    status: string;
    invoiceUrl: string | null;
    createdAt: string;
  }>;
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  if (bytes >= 1024 * 1024) return `${Math.round(bytes / (1024 * 1024))} MB`;
  return `${Math.round(bytes / 1024)} KB`;
}

export function BillingModal({
  isOpen,
  onClose,
  storageTier,
  isDemo = false,
}: BillingModalProps) {
  const [profile, setProfile] = useState<BillingProfile | null>(null);
  const [loading, setLoading] = useState(false);
  const [checkoutItem, setCheckoutItem] = useState<string | null>(null);
  const [portalLoading, setPortalLoading] = useState(false);
  const [syncingCustomer, setSyncingCustomer] = useState(false);
  const [syncBanner, setSyncBanner] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen || isDemo) return;
    setLoading(true);
    setErrorMsg(null);
    fetch("/api/v1/billing")
      .then((r) => r.json())
      .then((d) => {
        if (d.error) throw new Error(d.error);
        setProfile(d);
      })
      .catch((e) => setErrorMsg(e.message || "Failed to load billing details"))
      .finally(() => setLoading(false));
  }, [isOpen, isDemo]);

  if (!isOpen) return null;

  const activeTier = profile?.tier || (storageTier === "pro" ? "pro" : storageTier === "team" || storageTier === "enterprise" ? "team" : "free");

  const startCheckout = async (itemKey: "pro" | "team" | "extra_domain" | "extra_storage") => {
    if (isDemo) {
      setErrorMsg("Sign in with GitHub first to upgrade a live workspace via Dodo Payments.");
      return;
    }
    setCheckoutItem(itemKey);
    setErrorMsg(null);
    try {
      const res = await fetch("/api/v1/billing/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itemKey, quantity: 1 }),
      });
      const data = await res.json();
      if (!res.ok || !data.checkoutUrl) {
        throw new Error(data.error || "Unable to create Dodo Payments checkout session");
      }
      window.location.href = data.checkoutUrl;
    } catch (e: any) {
      setErrorMsg(e.message || "Checkout initialization failed");
      setCheckoutItem(null);
    }
  };

  const syncCustomersNow = async () => {
    if (isDemo) return;
    setSyncingCustomer(true);
    setErrorMsg(null);
    setSyncBanner(null);
    try {
      const res = await fetch("/api/v1/billing/sync", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Customer sync failed");
      const r = data.syncReport;
      setSyncBanner(
        `Synced Dodo (${r.dodo?.customerId || "none"}) & Stripe (${r.stripe?.customerId || "none"}) — Active tier: ${r.updatedTier.toUpperCase()}`
      );
      const profRes = await fetch("/api/v1/billing");
      const profData = await profRes.json();
      if (profRes.ok && !profData.error) setProfile(profData);
    } catch (e: any) {
      setErrorMsg(e.message || "Customer sync failed");
    } finally {
      setSyncingCustomer(false);
    }
  };

  const openCustomerPortal = async () => {
    if (isDemo) return;
    setPortalLoading(true);
    setErrorMsg(null);
    try {
      const res = await fetch("/api/v1/billing/portal", { method: "POST" });
      const data = await res.json();
      if (!res.ok || !data.portalUrl) {
        throw new Error(data.error || "Unable to open Customer Portal");
      }
      window.open(data.portalUrl, "_blank", "noopener,noreferrer");
    } catch (e: any) {
      setErrorMsg(e.message || "Customer Portal unavailable");
    } finally {
      setPortalLoading(false);
    }
  };

  const plans = [
    {
      id: "free" as const,
      name: "Free",
      price: "$0",
      period: "/mo",
      badge: "OSS Starter",
      features: [
        "5 GitHub Repositories / Workspaces",
        `1 Free *.${PORTAL_DOMAIN} subdomain`,
        "100 MB Cloudflare R2 storage",
        "7-day analytics & telemetry history",
        "Preset dashboard themes",
      ],
    },
    {
      id: "pro" as const,
      name: "Developer Pro",
      price: "$14",
      period: "/mo",
      badge: "Most Popular",
      highlight: true,
      features: [
        "25 Projects + 1-Click GitHub Import",
        "1 Custom Domain with auto SSL",
        "5 GB Cloudflare R2 storage (90d lifecycle)",
        "90-day analytics & historical metrics",
        "Discord & Telegram crash alerts",
        "Scoped Custom CSS & White-labeling",
      ],
    },
    {
      id: "team" as const,
      name: "Team / Studio",
      price: "$49",
      period: "/mo",
      badge: "Scale + BYOS",
      features: [
        "Unlimited Projects",
        "5 Custom Domains with auto SSL",
        "50 GB R2 storage + BYOS (own R2 / S3)",
        "365-day analytics & telemetry history",
        "PagerDuty, Slack, Discord & Telegram routing",
        "Full white-label portal control",
      ],
    },
  ];

  return (
    <ModalShell isOpen={isOpen} onClose={onClose} maxWidthClass="max-w-4xl">
        {/* Header */}
        <div className="flex items-center justify-between mb-4 pb-3 border-b border-zinc-800">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-emerald-950 border border-emerald-700/60 flex items-center justify-center text-emerald-400">
              <CreditCard className="w-4 h-4" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-bold text-white text-base">
                  Plans, Quotas & Billing
                </h3>
                <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
                  {activeTier} plan
                </span>
              </div>
              <p className="text-xs text-zinc-400">
                Powered by Dodo Payments • Instant webhook provisioning & automated invoices
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {!isDemo && (
              <button
                type="button"
                onClick={syncCustomersNow}
                disabled={syncingCustomer}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-xs text-emerald-300 font-medium transition disabled:opacity-50"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${syncingCustomer ? "animate-spin" : ""}`} />
                <span>{syncingCustomer ? "Syncing..." : "Sync Stripe / Dodo"}</span>
              </button>
            )}
            {(profile?.hasDodoCustomer || profile?.hasStripeCustomer) && (
              <button
                type="button"
                onClick={openCustomerPortal}
                disabled={portalLoading}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-xs text-zinc-200 font-medium transition disabled:opacity-50"
              >
                {portalLoading ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <ExternalLink className="w-3.5 h-3.5" />
                )}
                <span>Billing Portal</span>
              </button>
            )}
            <button
              onClick={onClose}
              className="text-zinc-400 hover:text-white p-1.5 rounded-lg hover:bg-zinc-800 transition"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {errorMsg && (
          <div className="p-3 rounded-xl bg-red-950/60 border border-red-800/70 text-xs mb-4 text-red-200 flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
            <span>{errorMsg}</span>
          </div>
        )}

        {syncBanner && (
          <div className="p-3 rounded-xl bg-emerald-950/60 border border-emerald-700/70 text-xs mb-4 text-emerald-200 flex items-center gap-2">
            <Check className="w-4 h-4 text-emerald-400 shrink-0" />
            <span>{syncBanner}</span>
          </div>
        )}

        <div className="space-y-6 flex-1 overflow-y-auto pr-1">
          {/* Live Quota Overview */}
          {loading ? (
            <div className="p-4 rounded-xl bg-zinc-950 border border-zinc-800 flex items-center gap-2 text-xs text-zinc-400">
              <Loader2 className="w-4 h-4 animate-spin text-emerald-400" />
              <span>Syncing workspace usage & Dodo Payments subscription...</span>
            </div>
          ) : profile ? (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="p-3.5 rounded-xl bg-zinc-950 border border-zinc-800">
                <div className="flex items-center justify-between text-xs text-zinc-400 mb-1">
                  <span className="flex items-center gap-1.5">
                    <FolderGit2 className="w-3.5 h-3.5 text-indigo-400" />
                    Projects
                  </span>
                  <span className="font-mono text-zinc-200 font-semibold">
                    {profile.usage.projectCount} /{" "}
                    {profile.entitlements.maxProjects === null
                      ? "∞"
                      : profile.entitlements.maxProjects}
                  </span>
                </div>
                <div className="w-full h-1.5 rounded-full bg-zinc-800 overflow-hidden">
                  <div
                    className="h-full bg-indigo-500 transition-all"
                    style={{
                      width: `${
                        profile.entitlements.maxProjects
                          ? Math.min(
                              100,
                              (profile.usage.projectCount /
                                profile.entitlements.maxProjects) *
                                100
                            )
                          : 15
                      }%`,
                    }}
                  />
                </div>
              </div>

              <div className="p-3.5 rounded-xl bg-zinc-950 border border-zinc-800">
                <div className="flex items-center justify-between text-xs text-zinc-400 mb-1">
                  <span className="flex items-center gap-1.5">
                    <Globe className="w-3.5 h-3.5 text-cyan-400" />
                    Custom Domains
                  </span>
                  <span className="font-mono text-zinc-200 font-semibold">
                    {profile.usage.customDomainCount} /{" "}
                    {profile.entitlements.maxCustomDomains}
                  </span>
                </div>
                <div className="w-full h-1.5 rounded-full bg-zinc-800 overflow-hidden">
                  <div
                    className="h-full bg-cyan-500 transition-all"
                    style={{
                      width: `${
                        profile.entitlements.maxCustomDomains > 0
                          ? Math.min(
                              100,
                              (profile.usage.customDomainCount /
                                profile.entitlements.maxCustomDomains) *
                                100
                            )
                          : 0
                      }%`,
                    }}
                  />
                </div>
              </div>

              <div className="p-3.5 rounded-xl bg-zinc-950 border border-zinc-800">
                <div className="flex items-center justify-between text-xs text-zinc-400 mb-1">
                  <span className="flex items-center gap-1.5">
                    <HardDrive className="w-3.5 h-3.5 text-purple-400" />
                    R2 Storage ({profile.entitlements.historyDays}d history)
                  </span>
                  <span className="font-mono text-zinc-200 font-semibold">
                    {formatBytes(profile.usage.storageUsedBytes)} /{" "}
                    {formatBytes(profile.entitlements.storageLimitBytes)}
                  </span>
                </div>
                <div className="w-full h-1.5 rounded-full bg-zinc-800 overflow-hidden">
                  <div
                    className="h-full bg-purple-500 transition-all"
                    style={{
                      width: `${Math.min(
                        100,
                        (profile.usage.storageUsedBytes /
                          Math.max(1, profile.entitlements.storageLimitBytes)) *
                          100
                      )}%`,
                    }}
                  />
                </div>
              </div>
            </div>
          ) : null}

          {/* Subscription Tiers */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {plans.map((p) => {
              const isCurrent = activeTier === p.id;
              return (
                <div
                  key={p.id}
                  className={`p-4 rounded-2xl border flex flex-col justify-between transition ${
                    p.highlight
                      ? "bg-indigo-950/20 border-indigo-500/60 shadow-lg shadow-indigo-950/30"
                      : "bg-zinc-950 border-zinc-800"
                  }`}
                >
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-sm font-bold text-white">{p.name}</span>
                      <span
                        className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${
                          p.highlight
                            ? "bg-indigo-500/20 text-indigo-300 border border-indigo-500/30"
                            : "bg-zinc-800 text-zinc-400"
                        }`}
                      >
                        {p.badge}
                      </span>
                    </div>

                    <div className="flex items-baseline gap-1 mb-4">
                      <span className="text-2xl font-extrabold text-white">{p.price}</span>
                      <span className="text-xs text-zinc-400">{p.period}</span>
                    </div>

                    <ul className="space-y-2 mb-5">
                      {p.features.map((f) => (
                        <li
                          key={f}
                          className="flex items-start gap-2 text-xs text-zinc-300 leading-snug"
                        >
                          <Check className="w-3.5 h-3.5 text-emerald-400 shrink-0 mt-0.5" />
                          <span>{f}</span>
                        </li>
                      ))}
                    </ul>
                  </div>

                  {p.id === "free" ? (
                    <div className="w-full py-2 px-3 rounded-xl bg-zinc-900 border border-zinc-800 text-center text-xs font-medium text-zinc-400">
                      {isCurrent ? "Current Plan" : "Default Base Tier"}
                    </div>
                  ) : (
                    <button
                      type="button"
                      disabled={isCurrent || checkoutItem !== null}
                      onClick={() => startCheckout(p.id)}
                      className={`w-full py-2.5 px-3 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition ${
                        isCurrent
                          ? "bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 cursor-default"
                          : p.highlight
                          ? "bg-indigo-600 hover:bg-indigo-500 text-white shadow-lg shadow-indigo-600/25"
                          : "bg-zinc-800 hover:bg-zinc-700 text-white"
                      } disabled:opacity-60`}
                    >
                      {checkoutItem === p.id ? (
                        <>
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          <span>Redirecting to Dodo...</span>
                        </>
                      ) : isCurrent ? (
                        <>
                          <Check className="w-3.5 h-3.5" />
                          <span>Active Plan</span>
                        </>
                      ) : (
                        <>
                          <Sparkles className="w-3.5 h-3.5" />
                          <span>Upgrade via Dodo Payments</span>
                        </>
                      )}
                    </button>
                  )}
                </div>
              );
            })}
          </div>

          {/* Add-on Monetization */}
          <div>
            <h4 className="text-xs font-bold uppercase tracking-wider text-zinc-400 mb-2.5">
              Modular Add-Ons (Stackable Anytime)
            </h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="p-4 rounded-xl bg-zinc-950 border border-zinc-800 flex items-center justify-between gap-3">
                <div>
                  <div className="text-xs font-bold text-white flex items-center gap-1.5">
                    <Globe className="w-3.5 h-3.5 text-cyan-400" />
                    Extra Custom Domain
                  </div>
                  <p className="text-[11px] text-zinc-400 mt-0.5">
                    +$5/mo per domain • Instant Cloudflare SaaS SSL
                  </p>
                </div>
                <button
                  type="button"
                  disabled={checkoutItem !== null}
                  onClick={() => startCheckout("extra_domain")}
                  className="shrink-0 flex items-center gap-1 px-3 py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-xs font-semibold text-white transition disabled:opacity-50"
                >
                  {checkoutItem === "extra_domain" ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Plus className="w-3.5 h-3.5 text-cyan-400" />
                  )}
                  <span>+$5/mo</span>
                </button>
              </div>

              <div className="p-4 rounded-xl bg-zinc-950 border border-zinc-800 flex items-center justify-between gap-3">
                <div>
                  <div className="text-xs font-bold text-white flex items-center gap-1.5">
                    <HardDrive className="w-3.5 h-3.5 text-purple-400" />
                    Extra R2 Storage (+25 GB)
                  </div>
                  <p className="text-[11px] text-zinc-400 mt-0.5">
                    +$3/mo per 25 GB • Crash dumps & logs archive
                  </p>
                </div>
                <button
                  type="button"
                  disabled={checkoutItem !== null}
                  onClick={() => startCheckout("extra_storage")}
                  className="shrink-0 flex items-center gap-1 px-3 py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-xs font-semibold text-white transition disabled:opacity-50"
                >
                  {checkoutItem === "extra_storage" ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Plus className="w-3.5 h-3.5 text-purple-400" />
                  )}
                  <span>+$3/mo</span>
                </button>
              </div>
            </div>
          </div>

          {/* Invoice & Receipt History */}
          {profile && (
            <div>
              <h4 className="text-xs font-bold uppercase tracking-wider text-zinc-400 mb-2.5 flex items-center gap-1.5">
                <Receipt className="w-3.5 h-3.5 text-emerald-400" />
                Invoices & Billing Ledger
              </h4>
              {profile.invoices.length === 0 ? (
                <div className="p-4 rounded-xl bg-zinc-950 border border-zinc-800 text-xs text-zinc-500">
                  No paid invoices yet. Completed Dodo Payments checkouts and renewals appear here automatically.
                </div>
              ) : (
                <div className="rounded-xl bg-zinc-950 border border-zinc-800 overflow-hidden">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-zinc-900/70 text-zinc-400 border-b border-zinc-800">
                      <tr>
                        <th className="py-2 px-3 font-medium">Event / Item</th>
                        <th className="py-2 px-3 font-medium">Amount</th>
                        <th className="py-2 px-3 font-medium">Status</th>
                        <th className="py-2 px-3 font-medium">Date</th>
                        <th className="py-2 px-3 font-medium text-right">Receipt</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-800/70 text-zinc-300">
                      {profile.invoices.map((inv) => (
                        <tr key={inv.id}>
                          <td className="py-2 px-3 font-mono text-[11px]">
                            {inv.itemKey || inv.eventType}
                          </td>
                          <td className="py-2 px-3 font-semibold">
                            ${(inv.amountCents / 100).toFixed(2)} {inv.currency}
                          </td>
                          <td className="py-2 px-3">
                            <span className="px-2 py-0.5 rounded-full text-[10px] bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
                              {inv.status}
                            </span>
                          </td>
                          <td className="py-2 px-3 text-zinc-500">
                            {new Date(inv.createdAt).toLocaleDateString()}
                          </td>
                          <td className="py-2 px-3 text-right">
                            {inv.invoiceUrl ? (
                              <a
                                href={inv.invoiceUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="text-indigo-400 hover:underline inline-flex items-center gap-1"
                              >
                                View <ExternalLink className="w-3 h-3" />
                              </a>
                            ) : (
                              <span className="text-zinc-600">—</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>
    </ModalShell>
  );
}
