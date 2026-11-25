"use client";

import React, { useState, useEffect } from "react";
import {
  Globe,
  HardDrive,
  X,
  CheckCircle2,
  Clock,
  Trash2,
  RefreshCw,
  ExternalLink,
  Server,
  Shield,
  ArrowUpRight,
} from "lucide-react";
import { formatBytes } from "@/lib/billing/plans";

interface CustomDomainItem {
  id: string;
  hostname: string;
  sslStatus: string;
  verified: boolean;
  verificationRecordName?: string | null;
  verificationRecordValue?: string | null;
}

interface StorageSummary {
  tier: string;
  planLabel: string;
  provider: string;
  bucketName: string;
  endpoint: string | null;
  hasByosCredentials: boolean;
  usedBytes: number;
  limitBytes: number;
  retentionDays: number;
  allowByos: boolean;
}

interface DomainsStorageModalProps {
  isOpen: boolean;
  onClose: () => void;
  projectId: string;
  initialSubdomain?: string | null;
  onOpenBilling: () => void;
}

export function DomainsStorageModal({
  isOpen,
  onClose,
  projectId,
  initialSubdomain,
  onOpenBilling,
}: DomainsStorageModalProps) {
  const [activeTab, setActiveTab] = useState<"domains" | "storage">("domains");
  const [subdomain, setSubdomain] = useState(initialSubdomain || "");
  const [domains, setDomains] = useState<CustomDomainItem[]>([]);
  const [maxCustomDomains, setMaxCustomDomains] = useState(0);
  const [newHostname, setNewHostname] = useState("");
  const [storage, setStorage] = useState<StorageSummary | null>(null);

  const [byosProvider, setByosProvider] = useState<"devpulse_r2" | "byos_r2" | "byos_s3">("devpulse_r2");
  const [byosBucket, setByosBucket] = useState("");
  const [byosEndpoint, setByosEndpoint] = useState("");
  const [byosAccessKey, setByosAccessKey] = useState("");
  const [byosSecretKey, setByosSecretKey] = useState("");

  const [busy, setBusy] = useState(false);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const loadData = async () => {
    try {
      const [domRes, stgRes] = await Promise.all([
        fetch("/api/v1/domains"),
        fetch("/api/v1/storage"),
      ]);
      if (domRes.ok) {
        const dJson = await domRes.json();
        if (dJson.subdomain) setSubdomain(dJson.subdomain);
        setDomains(dJson.domains || []);
        setMaxCustomDomains(dJson.maxCustomDomains ?? 0);
      }
      if (stgRes.ok) {
        const sJson = await stgRes.json();
        if (sJson.storage) {
          setStorage(sJson.storage);
          if (sJson.storage.provider === "byos_r2" || sJson.storage.provider === "byos_s3") {
            setByosProvider(sJson.storage.provider);
          } else {
            setByosProvider("devpulse_r2");
          }
          setByosBucket(sJson.storage.bucketName || "");
          setByosEndpoint(sJson.storage.endpoint || "");
        }
      }
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    if (!isOpen) return;
    const frame = requestAnimationFrame(() => {
      setStatusMsg(null);
      setErrorMsg(null);
      void loadData();
    });
    return () => cancelAnimationFrame(frame);
  }, [isOpen]);

  if (!isOpen) return null;

  const handleClaimSubdomain = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErrorMsg(null);
    setStatusMsg(null);
    try {
      const res = await fetch("/api/v1/domains", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "claim_subdomain", subdomain }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to update subdomain");
      setStatusMsg(`Claimed https://${json.subdomain}.devpulse.ritualdev.in`);
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : "Failed to update subdomain");
    } finally {
      setBusy(false);
    }
  };

  const handleAddCustomDomain = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErrorMsg(null);
    setStatusMsg(null);
    try {
      const res = await fetch("/api/v1/domains", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "add_custom_domain",
          hostname: newHostname,
          projectId,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to add custom domain");
      setNewHostname("");
      setStatusMsg(`Added ${json.domain.hostname}. Point your CNAME record to cname.devpulse.ritualdev.in.`);
      await loadData();
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : "Verification check failed");
    } finally {
      setBusy(false);
    }
  };

  const handleVerifyDomain = async (domainId: string) => {
    setBusy(true);
    setErrorMsg(null);
    setStatusMsg(null);
    try {
      const res = await fetch("/api/v1/domains", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "verify_custom_domain", domainId }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Verification check failed");
      setStatusMsg(
        json.verified
          ? "SSL active & CNAME verified!"
          : `DNS propagation pending (SSL status: ${json.sslStatus}).`
      );
      await loadData();
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : "Verification check failed");
    } finally {
      setBusy(false);
    }
  };

  const handleDeleteDomain = async (domainId: string) => {
    setBusy(true);
    try {
      await fetch(`/api/v1/domains?id=${encodeURIComponent(domainId)}`, { method: "DELETE" });
      await loadData();
    } finally {
      setBusy(false);
    }
  };

  const handleSaveStorage = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErrorMsg(null);
    setStatusMsg(null);
    try {
      const res = await fetch("/api/v1/storage", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: byosProvider,
          bucketName: byosBucket,
          endpoint: byosEndpoint,
          accessKey: byosAccessKey,
          secretKey: byosSecretKey,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to save storage settings");
      setStorage(json.storage);
      setByosAccessKey("");
      setByosSecretKey("");
      setStatusMsg("R2 / S3 storage configuration updated.");
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : "Failed to update storage config");
    } finally {
      setBusy(false);
    }
  };

  const usedPct = storage
    ? Math.min(100, Math.round((storage.usedBytes / Math.max(storage.limitBytes, 1)) * 100))
    : 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-150">
      <div className="w-full max-w-2xl bg-zinc-900 border border-zinc-700 rounded-2xl shadow-2xl p-6 text-left relative max-h-[92vh] flex flex-col">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-cyan-950 border border-cyan-800 flex items-center justify-center text-cyan-400">
              <Globe className="w-4 h-4" />
            </div>
            <div>
              <h3 className="font-bold text-white text-base">Domains, Redirection &amp; R2 Storage</h3>
              <p className="text-xs text-zinc-400">
                1 free subdomain included &bull; Custom CNAME + R2 log quotas
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

        {/* Tabs */}
        <div className="flex gap-2 mb-4 border-b border-zinc-800 pb-3">
          <button
            type="button"
            onClick={() => setActiveTab("domains")}
            className={`px-3 py-1.5 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition ${
              activeTab === "domains"
                ? "bg-indigo-600 text-white"
                : "bg-zinc-950 text-zinc-400 hover:text-white border border-zinc-800"
            }`}
          >
            <Globe className="w-3.5 h-3.5" />
            <span>Subdomain &amp; Custom Domains</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("storage")}
            className={`px-3 py-1.5 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition ${
              activeTab === "storage"
                ? "bg-indigo-600 text-white"
                : "bg-zinc-950 text-zinc-400 hover:text-white border border-zinc-800"
            }`}
          >
            <HardDrive className="w-3.5 h-3.5" />
            <span>Cloudflare R2 &amp; BYOS Quotas</span>
          </button>
        </div>

        {statusMsg && (
          <div className="mb-3 p-3 rounded-xl bg-emerald-950/40 border border-emerald-500/30 text-emerald-300 text-xs">
            {statusMsg}
          </div>
        )}
        {errorMsg && (
          <div className="mb-3 p-3 rounded-xl bg-red-950/40 border border-red-500/30 text-red-300 text-xs flex items-center justify-between gap-2">
            <span>{errorMsg}</span>
            <button
              type="button"
              onClick={() => {
                onClose();
                onOpenBilling();
              }}
              className="shrink-0 px-2.5 py-1 rounded-lg bg-indigo-600 text-white font-semibold"
            >
              Upgrade Plan
            </button>
          </div>
        )}

        <div className="overflow-y-auto space-y-5 pr-1 flex-1">
          {activeTab === "domains" ? (
            <>
              {/* 1 Free Subdomain */}
              <form onSubmit={handleClaimSubdomain} className="p-4 rounded-xl bg-zinc-950 border border-zinc-800 space-y-2.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-white">Your Free DevPulse Subdomain</span>
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                    Included Free
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="flex-1 flex items-center rounded-xl bg-zinc-900 border border-zinc-800 px-3 py-2">
                    <input
                      type="text"
                      value={subdomain}
                      onChange={(e) => setSubdomain(e.target.value.toLowerCase())}
                      placeholder="username"
                      className="bg-transparent text-xs text-white font-mono focus:outline-none w-full"
                    />
                    <span className="text-xs text-zinc-500 font-mono shrink-0">
                      .devpulse.ritualdev.in
                    </span>
                  </div>
                  <button
                    type="submit"
                    disabled={busy}
                    className="px-3.5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-xs font-semibold text-white shrink-0 transition"
                  >
                    Save Subdomain
                  </button>
                </div>
                {subdomain && (
                  <a
                    href={`https://${subdomain}.devpulse.ritualdev.in`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-[11px] text-cyan-400 hover:text-cyan-300 font-mono"
                  >
                    <span>https://{subdomain}.devpulse.ritualdev.in</span>
                    <ExternalLink className="w-3 h-3" />
                  </a>
                )}
              </form>

              {/* Paid Custom Domain Redirection */}
              <div className="p-4 rounded-xl bg-zinc-950 border border-zinc-800 space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <h4 className="text-xs font-semibold text-white">Custom Domain Redirection (Cloudflare for SaaS)</h4>
                    <p className="text-[11px] text-zinc-400">
                      Slots used: {domains.length} / {maxCustomDomains} ({maxCustomDomains === 0 ? "Upgrade to Pro ($14/mo) for 1 domain" : "Extra domains +$5/mo"})
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      onClose();
                      onOpenBilling();
                    }}
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-zinc-900 hover:bg-zinc-800 border border-zinc-700 text-[11px] text-indigo-300"
                  >
                    <span>+ Add Slot</span>
                    <ArrowUpRight className="w-3 h-3" />
                  </button>
                </div>

                <form onSubmit={handleAddCustomDomain} className="flex gap-2">
                  <input
                    type="text"
                    value={newHostname}
                    onChange={(e) => setNewHostname(e.target.value)}
                    placeholder="stats.yourdomain.dev"
                    className="flex-1 px-3 py-2 rounded-xl bg-zinc-900 border border-zinc-800 text-xs font-mono text-white placeholder-zinc-600 focus:outline-none focus:border-indigo-500"
                  />
                  <button
                    type="submit"
                    disabled={busy || !newHostname.trim()}
                    className="px-3.5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-xs font-semibold text-white shrink-0 disabled:opacity-50"
                  >
                    Connect Domain
                  </button>
                </form>

                <div className="p-2.5 rounded-lg bg-zinc-900/70 border border-zinc-800 text-[11px] text-zinc-400 font-mono">
                  DNS Setup: Add CNAME record pointing your custom host &rarr; <span className="text-cyan-300">cname.devpulse.ritualdev.in</span>
                </div>

                {domains.length > 0 && (
                  <div className="space-y-2">
                    {domains.map((dom) => (
                      <div
                        key={dom.id}
                        className="p-3 rounded-xl bg-zinc-900 border border-zinc-800 flex items-center justify-between gap-2 text-xs"
                      >
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-white truncate">{dom.hostname}</span>
                            {dom.verified ? (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400 text-[10px]">
                                <CheckCircle2 className="w-3 h-3" />
                                Active SSL
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-300 text-[10px]">
                                <Clock className="w-3 h-3" />
                                {dom.sslStatus}
                              </span>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                          {!dom.verified && (
                            <button
                              type="button"
                              onClick={() => handleVerifyDomain(dom.id)}
                              disabled={busy}
                              className="px-2.5 py-1 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-[11px] text-zinc-200 flex items-center gap-1"
                            >
                              <RefreshCw className="w-3 h-3" />
                              Verify CNAME
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => handleDeleteDomain(dom.id)}
                            disabled={busy}
                            className="p-1.5 rounded-lg bg-zinc-800 hover:bg-red-950/60 text-zinc-400 hover:text-red-400"
                            title="Remove domain"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className="space-y-4">
              {/* R2 Usage Bar */}
              <div className="p-4 rounded-xl bg-zinc-950 border border-zinc-800 space-y-2.5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Server className="w-4 h-4 text-purple-400" />
                    <span className="text-xs font-semibold text-white">
                      Cloudflare R2 Crash Log &amp; Attachment Quota
                    </span>
                  </div>
                  <span className="text-[11px] font-mono text-zinc-300">
                    {storage ? `${formatBytes(storage.usedBytes)} / ${formatBytes(storage.limitBytes)}` : "Loading..."}
                  </span>
                </div>
                <div className="w-full h-2.5 rounded-full bg-zinc-900 overflow-hidden border border-zinc-800">
                  <div
                    className={`h-full transition-all ${usedPct >= 85 ? "bg-amber-500" : "bg-indigo-500"}`}
                    style={{ width: `${Math.max(usedPct, 2)}%` }}
                  />
                </div>
                <div className="flex items-center justify-between text-[11px] text-zinc-400">
                  <span>Plan: <strong className="text-zinc-200">{storage?.planLabel || "Free"}</strong> ({storage?.retentionDays ?? 7}-day retention)</span>
                  {usedPct >= 80 && (
                    <button
                      type="button"
                      onClick={() => {
                        onClose();
                        onOpenBilling();
                      }}
                      className="text-amber-400 hover:underline font-medium"
                    >
                      Upgrade to 5 GB ($14/mo) &rarr;
                    </button>
                  )}
                </div>
              </div>

              {/* BYOS R2/S3 Config */}
              <form onSubmit={handleSaveStorage} className="p-4 rounded-xl bg-zinc-950 border border-zinc-800 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Shield className="w-4 h-4 text-emerald-400" />
                    <span className="text-xs font-semibold text-white">Storage Backend</span>
                  </div>
                  {storage && !storage.allowByos && (
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-300 border border-amber-500/20">
                      BYOS requires Pro/Team
                    </span>
                  )}
                </div>

                <div className="grid grid-cols-3 gap-2 text-xs">
                  {[
                    { id: "devpulse_r2", label: "DevPulse R2" },
                    { id: "byos_r2", label: "Own R2 Bucket" },
                    { id: "byos_s3", label: "Own S3 Bucket" },
                  ].map((opt) => (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => setByosProvider(opt.id as "devpulse_r2" | "byos_r2" | "byos_s3")}
                      className={`p-2 rounded-xl border text-center font-medium transition ${
                        byosProvider === opt.id
                          ? "bg-indigo-600/20 border-indigo-500 text-white"
                          : "bg-zinc-900 border-zinc-800 text-zinc-400"
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>

                {byosProvider !== "devpulse_r2" && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 text-xs pt-1">
                    <input
                      type="text"
                      value={byosBucket}
                      onChange={(e) => setByosBucket(e.target.value)}
                      placeholder="Bucket Name"
                      className="px-3 py-2 rounded-xl bg-zinc-900 border border-zinc-800 text-white font-mono"
                    />
                    <input
                      type="url"
                      value={byosEndpoint}
                      onChange={(e) => setByosEndpoint(e.target.value)}
                      placeholder="https://<account>.r2.cloudflarestorage.com"
                      className="px-3 py-2 rounded-xl bg-zinc-900 border border-zinc-800 text-white font-mono"
                    />
                    <input
                      type="text"
                      value={byosAccessKey}
                      onChange={(e) => setByosAccessKey(e.target.value)}
                      placeholder="Access Key ID"
                      className="px-3 py-2 rounded-xl bg-zinc-900 border border-zinc-800 text-white font-mono"
                    />
                    <input
                      type="password"
                      value={byosSecretKey}
                      onChange={(e) => setByosSecretKey(e.target.value)}
                      placeholder="Secret Access Key"
                      className="px-3 py-2 rounded-xl bg-zinc-900 border border-zinc-800 text-white font-mono"
                    />
                  </div>
                )}

                <div className="flex justify-end">
                  <button
                    type="submit"
                    disabled={busy}
                    className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-xs font-semibold text-white transition"
                  >
                    Save Storage Config
                  </button>
                </div>
              </form>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
