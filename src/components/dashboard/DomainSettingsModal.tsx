"use client";

import React, { useState, useEffect } from "react";
import {
  Globe,
  X,
  Check,
  ShieldCheck,
  ExternalLink,
  Copy,
  Sparkles,
  Lock,
  RefreshCw,
  AlertTriangle,
  Loader2,
  Trash2,
} from "lucide-react";

interface DomainSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  storageTier: string;
  isDemo?: boolean;
}

export function DomainSettingsModal({
  isOpen,
  onClose,
  storageTier,
  isDemo = false,
}: DomainSettingsModalProps) {
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [copiedCname, setCopiedCname] = useState(false);
  const [statusMsg, setStatusMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null);

  const [subdomain, setSubdomain] = useState("ritualdev-lab");
  const [customDomain, setCustomDomain] = useState("");
  const [customDomainVerified, setCustomDomainVerified] = useState(false);
  const [sslStatus, setSslStatus] = useState("pending");
  const [isPaidTier, setIsPaidTier] = useState(["pro", "team", "enterprise", "byos"].includes((storageTier || "free").toLowerCase()));
  const [cnameTarget, setCnameTarget] = useState("cname.devpulse.ritualdev.in");

  const [brandTitle, setBrandTitle] = useState("");
  const [brandDescription, setBrandDescription] = useState("");
  const [brandFaviconUrl, setBrandFaviconUrl] = useState("");
  const [brandOgImageUrl, setBrandOgImageUrl] = useState("");
  const [hidePoweredBy, setHidePoweredBy] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setStatusMsg(null);
    if (isDemo) {
      setSubdomain("ritualdev-lab");
      return;
    }

    setLoading(true);
    fetch("/api/v1/domains")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!data) return;
        setSubdomain(data.subdomain || "");
        setCustomDomain(data.customDomain || "");
        setCustomDomainVerified(Boolean(data.customDomainVerified));
        setSslStatus(data.customDomainSslStatus || "pending");
        setIsPaidTier(Boolean(data.isPaidTier));
        setCnameTarget(data.cnameTarget || "cname.devpulse.ritualdev.in");
        setBrandTitle(data.branding?.brandTitle || "");
        setBrandDescription(data.branding?.brandDescription || "");
        setBrandFaviconUrl(data.branding?.brandFaviconUrl || "");
        setBrandOgImageUrl(data.branding?.brandOgImageUrl || "");
        setHidePoweredBy(Boolean(data.branding?.hidePoweredBy));
      })
      .catch(() => null)
      .finally(() => setLoading(false));
  }, [isOpen, isDemo]);

  if (!isOpen) return null;

  const handleSave = async () => {
    if (isDemo) {
      setStatusMsg({
        type: "err",
        text: "Sign in with GitHub to claim your *.devpulse.ritualdev.in subdomain or bind a custom domain.",
      });
      return;
    }

    setSaving(true);
    setStatusMsg(null);
    try {
      const res = await fetch("/api/v1/domains", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subdomain,
          customDomain: isPaidTier ? customDomain : undefined,
          brandTitle,
          brandDescription,
          brandFaviconUrl,
          brandOgImageUrl,
          hidePoweredBy: isPaidTier ? hidePoweredBy : false,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        throw new Error(json.error || "Failed to save portal domain settings");
      }

      setSubdomain(json.subdomain || subdomain);
      setCustomDomain(json.customDomain || "");
      setCustomDomainVerified(Boolean(json.customDomainVerified));
      setSslStatus(json.customDomainSslStatus || "pending");

      setStatusMsg({
        type: "ok",
        text: json.provisionNote
          ? `Saved! (${json.provisionNote})`
          : "Portal subdomain, custom domain, and SEO settings saved!",
      });
    } catch (err: any) {
      setStatusMsg({ type: "err", text: err?.message || "Failed to save domain settings" });
    } finally {
      setSaving(false);
    }
  };

  const handleVerifyDns = async () => {
    setVerifying(true);
    setStatusMsg(null);
    try {
      const res = await fetch("/api/v1/domains/verify", { method: "POST" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Verification failed");
      setCustomDomainVerified(Boolean(json.verified));
      setSslStatus(json.sslStatus || "pending_validation");
      setStatusMsg({
        type: json.verified ? "ok" : "err",
        text: json.message,
      });
    } catch (err: any) {
      setStatusMsg({ type: "err", text: err?.message || "DNS verification failed" });
    } finally {
      setVerifying(false);
    }
  };

  const handleDisconnectCustomDomain = async () => {
    setSaving(true);
    try {
      const res = await fetch("/api/v1/domains", { method: "DELETE" });
      if (res.ok) {
        setCustomDomain("");
        setCustomDomainVerified(false);
        setSslStatus("pending");
        setStatusMsg({ type: "ok", text: "Custom domain disconnected." });
      }
    } finally {
      setSaving(false);
    }
  };

  const copyCname = () => {
    navigator.clipboard?.writeText(cnameTarget);
    setCopiedCname(true);
    setTimeout(() => setCopiedCname(false), 2000);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-150">
      <div className="w-full max-w-2xl bg-zinc-900 border border-zinc-700 rounded-2xl shadow-2xl p-6 text-left relative max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-cyan-950 border border-cyan-800 flex items-center justify-center text-cyan-400">
              <Globe className="w-4 h-4" />
            </div>
            <div>
              <h3 className="font-bold text-white text-base">
                Public Portal, Subdomains &amp; Custom Domains
              </h3>
              <p className="text-xs text-zinc-400">
                Branded developer portal routing with Cloudflare for SaaS automated SSL
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-zinc-400 hover:text-white p-1 rounded-lg hover:bg-zinc-800 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {loading ? (
          <div className="py-12 flex flex-col items-center justify-center gap-2 text-zinc-400 text-xs">
            <Loader2 className="w-5 h-5 animate-spin text-cyan-400" />
            <span>Loading domain &amp; SSL configuration...</span>
          </div>
        ) : (
          <div className="space-y-5 flex-1 overflow-y-auto pr-1 text-xs">
            {statusMsg && (
              <div
                className={`p-3 rounded-xl border flex items-center gap-2 ${
                  statusMsg.type === "ok"
                    ? "bg-emerald-950/40 border-emerald-800/60 text-emerald-300"
                    : "bg-red-950/40 border-red-800/60 text-red-300"
                }`}
              >
                {statusMsg.type === "ok" ? (
                  <Check className="w-4 h-4 shrink-0 text-emerald-400" />
                ) : (
                  <AlertTriangle className="w-4 h-4 shrink-0 text-red-400" />
                )}
                <span>{statusMsg.text}</span>
              </div>
            )}

            {/* 1. Free *.devpulse.ritualdev.in Subdomain */}
            <div className="p-4 rounded-xl bg-zinc-950/80 border border-zinc-800 space-y-3">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-white text-xs">
                  Free Subdomain Portal
                </span>
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 font-semibold">
                  Included Free
                </span>
              </div>

              <div className="flex items-center gap-2">
                <div className="flex-1 flex items-center rounded-xl bg-zinc-900 border border-zinc-800 overflow-hidden focus-within:border-cyan-500">
                  <input
                    type="text"
                    value={subdomain}
                    onChange={(e) => setSubdomain(e.target.value)}
                    placeholder="alex"
                    className="flex-1 px-3 py-2 bg-transparent font-mono text-xs text-white focus:outline-none"
                  />
                  <span className="px-3 py-2 bg-zinc-950 text-zinc-400 font-mono text-[11px] border-l border-zinc-800">
                    .devpulse.ritualdev.in
                  </span>
                </div>
                <a
                  href={`/portal/${encodeURIComponent(subdomain || "ritualdev-lab")}`}
                  target="_blank"
                  rel="noreferrer"
                  className="px-3 py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-200 flex items-center gap-1.5 transition shrink-0"
                  title="Preview public portal"
                >
                  <span>Preview Portal</span>
                  <ExternalLink className="w-3.5 h-3.5 text-cyan-400" />
                </a>
              </div>
            </div>

            {/* 2. Cloudflare for SaaS Custom Domain */}
            <div className="p-4 rounded-xl bg-zinc-950/80 border border-zinc-800 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-white text-xs">
                    Custom Domain (Cloudflare for SaaS SSL)
                  </span>
                  {customDomain && (
                    <span
                      className={`text-[10px] px-2 py-0.5 rounded-full font-semibold border ${
                        customDomainVerified
                          ? "bg-emerald-500/15 text-emerald-300 border-emerald-500/30"
                          : "bg-amber-500/15 text-amber-300 border-amber-500/30"
                      }`}
                    >
                      {customDomainVerified ? "Active SSL" : `SSL: ${sslStatus}`}
                    </span>
                  )}
                </div>
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-purple-500/15 text-purple-300 border border-purple-500/30 font-semibold">
                  Pro / Enterprise
                </span>
              </div>

              {!isPaidTier && (
                <div className="p-2.5 rounded-xl bg-purple-950/30 border border-purple-800/40 text-purple-200 flex items-center gap-2 text-[11px]">
                  <Lock className="w-3.5 h-3.5 text-purple-400 shrink-0" />
                  <span>
                    Upgrade to <strong>Pro</strong> or <strong>Enterprise</strong> in R2 Storage settings to connect a custom domain with automated Cloudflare SSL.
                  </span>
                </div>
              )}

              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={customDomain}
                  onChange={(e) => setCustomDomain(e.target.value)}
                  disabled={!isPaidTier}
                  placeholder="stats.mytool.dev"
                  className="flex-1 px-3 py-2 rounded-xl bg-zinc-900 border border-zinc-800 font-mono text-xs text-white placeholder-zinc-600 focus:outline-none focus:border-cyan-500 disabled:opacity-50"
                />
                {customDomain && isPaidTier && (
                  <>
                    <button
                      type="button"
                      onClick={handleVerifyDns}
                      disabled={verifying}
                      className="px-3 py-2 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white font-semibold flex items-center gap-1.5 transition disabled:opacity-50"
                    >
                      <RefreshCw className={`w-3.5 h-3.5 ${verifying ? "animate-spin" : ""}`} />
                      <span>Verify DNS &amp; SSL</span>
                    </button>
                    <button
                      type="button"
                      onClick={handleDisconnectCustomDomain}
                      title="Disconnect custom domain"
                      className="p-2 rounded-xl bg-zinc-800 hover:bg-red-950/60 text-zinc-400 hover:text-red-400 transition"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </>
                )}
              </div>

              <div className="p-3 rounded-xl bg-zinc-900 border border-zinc-800/80 space-y-1.5 text-[11px]">
                <span className="text-zinc-400 block">
                  Add this CNAME record at your DNS provider for zero-config SSL:
                </span>
                <div className="flex items-center justify-between gap-2 font-mono text-zinc-200 bg-zinc-950 px-2.5 py-1.5 rounded-lg border border-zinc-800">
                  <span className="truncate">
                    CNAME &nbsp; {customDomain || "stats.mytool.dev"} &rarr; {cnameTarget}
                  </span>
                  <button
                    type="button"
                    onClick={copyCname}
                    className="text-cyan-400 hover:text-cyan-300 flex items-center gap-1 shrink-0"
                  >
                    <Copy className="w-3 h-3" />
                    <span>{copiedCname ? "Copied" : "Copy"}</span>
                  </button>
                </div>
              </div>
            </div>

            {/* 3. White-Labeling & SEO Social Cards */}
            <div className="p-4 rounded-xl bg-zinc-950/80 border border-zinc-800 space-y-3">
              <div className="flex items-center gap-2 font-semibold text-white text-xs">
                <Sparkles className="w-3.5 h-3.5 text-indigo-400" />
                <span>White-Labeling &amp; OpenGraph SEO</span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                <div>
                  <label className="block text-[11px] text-zinc-400 mb-1">Custom Portal Title</label>
                  <input
                    type="text"
                    value={brandTitle}
                    onChange={(e) => setBrandTitle(e.target.value)}
                    placeholder="MyTool Telemetry & Status"
                    className="w-full px-3 py-2 rounded-lg bg-zinc-900 border border-zinc-800 text-xs text-white focus:outline-none focus:border-indigo-500"
                  />
                </div>
                <div>
                  <label className="block text-[11px] text-zinc-400 mb-1">Custom Favicon URL</label>
                  <input
                    type="url"
                    value={brandFaviconUrl}
                    onChange={(e) => setBrandFaviconUrl(e.target.value)}
                    placeholder="https://mytool.dev/favicon.png"
                    className="w-full px-3 py-2 rounded-lg bg-zinc-900 border border-zinc-800 font-mono text-[11px] text-white focus:outline-none focus:border-indigo-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                <div>
                  <label className="block text-[11px] text-zinc-400 mb-1">SEO &amp; OpenGraph Description</label>
                  <input
                    type="text"
                    value={brandDescription}
                    onChange={(e) => setBrandDescription(e.target.value)}
                    placeholder="Real-time npm, PyPI, and uptime telemetry."
                    className="w-full px-3 py-2 rounded-lg bg-zinc-900 border border-zinc-800 text-xs text-white focus:outline-none focus:border-indigo-500"
                  />
                </div>
                <div>
                  <label className="block text-[11px] text-zinc-400 mb-1">Custom OpenGraph Image URL (optional)</label>
                  <input
                    type="url"
                    value={brandOgImageUrl}
                    onChange={(e) => setBrandOgImageUrl(e.target.value)}
                    placeholder="Auto-generated via /api/og if blank"
                    className="w-full px-3 py-2 rounded-lg bg-zinc-900 border border-zinc-800 font-mono text-[11px] text-white focus:outline-none focus:border-indigo-500"
                  />
                </div>
              </div>

              <label className="flex items-center justify-between p-2.5 rounded-xl bg-zinc-900 border border-zinc-800 cursor-pointer">
                <div className="flex items-center gap-2">
                  <ShieldCheck className="w-4 h-4 text-purple-400" />
                  <div>
                    <div className="text-xs font-medium text-zinc-200">
                      Hide &quot;Powered by DevPulse&quot; Footer
                    </div>
                    <div className="text-[10px] text-zinc-500">
                      Full white-labeling on Pro &amp; Enterprise plans
                    </div>
                  </div>
                </div>
                <input
                  type="checkbox"
                  checked={hidePoweredBy}
                  disabled={!isPaidTier}
                  onChange={(e) => setHidePoweredBy(e.target.checked)}
                  className="w-4 h-4 accent-purple-500 disabled:opacity-40"
                />
              </label>
            </div>
          </div>
        )}

        {/* Footer */}
        <div className="mt-5 pt-3 border-t border-zinc-800 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs font-medium transition"
          >
            Close
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving || isDemo}
            className="px-4 py-2 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-semibold shadow-lg shadow-cyan-600/20 transition disabled:opacity-50 flex items-center gap-1.5"
          >
            {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            <span>{saving ? "Provisioning..." : "Save Domain & Branding"}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
