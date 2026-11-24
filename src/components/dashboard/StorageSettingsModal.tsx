"use client";

import React, { useState, useEffect } from "react";
import {
  HardDrive,
  X,
  Check,
  ShieldCheck,
  Clock,
  Cloud,
  KeyRound,
  AlertTriangle,
  Loader2,
} from "lucide-react";

interface StorageSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialTier: string;
  isDemo?: boolean;
}

interface StorageConfigState {
  tier: string;
  provider: "devpulse_r2" | "byos_r2" | "byos_s3";
  isByos: boolean;
  usedBytes: number;
  limitBytes: number;
  retentionDays: number | null;
  prefix: string;
  byos: {
    endpoint: string;
    bucketName: string;
    accessKeyMasked: string;
    secretKeyMasked: string;
    hasCredentials: boolean;
  };
}

function formatSize(bytes: number): string {
  if (!bytes || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let idx = 0;
  let val = bytes;
  while (val >= 1024 && idx < units.length - 1) {
    val /= 1024;
    idx++;
  }
  return `${val >= 10 || idx === 0 ? Math.round(val) : val.toFixed(1)} ${units[idx]}`;
}

export function StorageSettingsModal({
  isOpen,
  onClose,
  initialTier,
  isDemo = false,
}: StorageSettingsModalProps) {
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [statusMsg, setStatusMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null);

  const [tier, setTier] = useState<string>(initialTier || "free");
  const [provider, setProvider] = useState<"devpulse_r2" | "byos_r2" | "byos_s3">("devpulse_r2");
  const [usedBytes, setUsedBytes] = useState(0);
  const [limitBytes, setLimitBytes] = useState(100 * 1024 * 1024);
  const [retentionDays, setRetentionDays] = useState<number | null>(7);

  const [endpoint, setEndpoint] = useState("");
  const [bucketName, setBucketName] = useState("");
  const [accessKeyId, setAccessKeyId] = useState("");
  const [secretAccessKey, setSecretAccessKey] = useState("");

  useEffect(() => {
    if (!isOpen || isDemo) return;
    setLoading(true);
    setStatusMsg(null);
    fetch("/api/v1/storage/config")
      .then((res) => (res.ok ? res.json() : null))
      .then((data: StorageConfigState | null) => {
        if (!data) return;
        setTier(data.tier);
        setProvider(data.provider || "devpulse_r2");
        setUsedBytes(data.usedBytes || 0);
        setLimitBytes(data.limitBytes || 100 * 1024 * 1024);
        setRetentionDays(data.retentionDays);
        setEndpoint(data.byos?.endpoint || "");
        setBucketName(data.byos?.bucketName || "");
        setAccessKeyId(data.byos?.accessKeyMasked || "");
        setSecretAccessKey(data.byos?.secretKeyMasked || "");
      })
      .catch(() => null)
      .finally(() => setLoading(false));
  }, [isOpen, isDemo]);

  if (!isOpen) return null;

  const usagePercent = Math.min(100, Math.round((usedBytes / Math.max(limitBytes, 1)) * 100));

  const handleSave = async (testConnection = false) => {
    if (isDemo) {
      setStatusMsg({ type: "err", text: "Sign in with GitHub to customize R2 storage or BYOS buckets." });
      return;
    }

    if (testConnection) setTesting(true);
    else setSaving(true);
    setStatusMsg(null);

    try {
      const res = await fetch("/api/v1/storage/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          storageTier: tier,
          provider,
          endpoint,
          bucketName,
          accessKeyId,
          secretAccessKey,
          testConnection,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        throw new Error(json.error || "Failed to update storage configuration");
      }

      setUsedBytes(json.usedBytes ?? usedBytes);
      setLimitBytes(json.limitBytes ?? limitBytes);
      setRetentionDays(json.retentionDays ?? null);
      setStatusMsg({
        type: "ok",
        text: json.message || "Cloudflare R2 storage settings saved!",
      });
    } catch (err: any) {
      setStatusMsg({ type: "err", text: err?.message || "Failed to update storage" });
    } finally {
      setSaving(false);
      setTesting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-150">
      <div className="w-full max-w-xl bg-zinc-900 border border-zinc-700 rounded-2xl shadow-2xl p-6 text-left relative max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-purple-950/80 border border-purple-800/60 flex items-center justify-center text-purple-400">
              <HardDrive className="w-4 h-4" />
            </div>
            <div>
              <h3 className="font-bold text-white text-base">Cloudflare R2 & BYOS Storage</h3>
              <p className="text-xs text-zinc-400">
                Heavy crash dumps, 100 KB+ traces & bug screenshot pipeline
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
            <Loader2 className="w-5 h-5 animate-spin text-purple-400" />
            <span>Loading storage quota & R2 configuration...</span>
          </div>
        ) : (
          <div className="space-y-4 flex-1 overflow-y-auto pr-1 text-xs">
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

            {/* Quota Metering Bar */}
            <div className="p-4 rounded-xl bg-zinc-950/80 border border-zinc-800 space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="text-zinc-300 font-semibold">R2 Quota Usage</span>
                <span className="font-mono text-zinc-200">
                  {provider === "devpulse_r2"
                    ? `${formatSize(usedBytes)} / ${formatSize(limitBytes)} (${usagePercent}%)`
                    : `${formatSize(usedBytes)} tracked • Unlimited BYOS`}
                </span>
              </div>
              <div className="w-full h-2 rounded-full bg-zinc-800 overflow-hidden">
                <div
                  className={`h-full transition-all duration-300 ${
                    usagePercent > 90
                      ? "bg-red-500"
                      : usagePercent > 70
                      ? "bg-amber-500"
                      : "bg-gradient-to-r from-indigo-500 to-purple-500"
                  }`}
                  style={{ width: `${provider === "devpulse_r2" ? Math.max(usagePercent, 2) : 100}%` }}
                />
              </div>
              <div className="flex items-center justify-between text-[11px] text-zinc-500">
                <span className="flex items-center gap-1">
                  <Clock className="w-3 h-3 text-purple-400" />
                  R2 Lifecycle Policy:{" "}
                  <strong className="text-zinc-300">
                    {retentionDays ? `Auto-delete after ${retentionDays} days` : "Persistent (No auto-delete)"}
                  </strong>
                </span>
                <span className="font-mono text-zinc-400 uppercase">{tier} tier</span>
              </div>
            </div>

            {/* Tier Cards */}
            <div>
              <label className="block text-zinc-300 font-semibold mb-2">Storage Plan & Lifecycle Tier</label>
              <div className="grid grid-cols-3 gap-2">
                {[
                  { id: "free", title: "Free", quota: "100 MB", retention: "7-day R2 retention" },
                  { id: "pro", title: "Pro", quota: "5 GB", retention: "90-day R2 retention" },
                  { id: "enterprise", title: "Team / Enterprise", quota: "50 GB + BYOS", retention: "Custom + BYOS S3/R2" },
                ].map((plan) => (
                  <button
                    key={plan.id}
                    type="button"
                    onClick={() => {
                      setTier(plan.id);
                      if (plan.id !== "enterprise" && provider !== "devpulse_r2") {
                        setProvider("devpulse_r2");
                      }
                    }}
                    className={`p-3 rounded-xl border text-left transition ${
                      tier === plan.id
                        ? "bg-purple-950/40 border-purple-500/70 text-white"
                        : "bg-zinc-950/60 border-zinc-800 text-zinc-400 hover:border-zinc-700"
                    }`}
                  >
                    <div className="font-bold text-xs text-white">{plan.title}</div>
                    <div className="text-purple-300 font-mono text-[11px] mt-0.5">{plan.quota}</div>
                    <div className="text-[10px] text-zinc-500 mt-1">{plan.retention}</div>
                  </button>
                ))}
              </div>
            </div>

            {/* Storage Provider Selector */}
            <div>
              <label className="block text-zinc-300 font-semibold mb-2">Storage Backend Provider</label>
              <div className="grid grid-cols-3 gap-2">
                {[
                  { id: "devpulse_r2", label: "DevPulse R2", desc: "Zero-config managed" },
                  { id: "byos_r2", label: "BYOS Cloudflare R2", desc: "Your R2 bucket" },
                  { id: "byos_s3", label: "BYOS AWS S3", desc: "Any S3 endpoint" },
                ].map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => setProvider(p.id as any)}
                    className={`p-2.5 rounded-xl border text-left transition ${
                      provider === p.id
                        ? "bg-indigo-950/40 border-indigo-500/70 text-white"
                        : "bg-zinc-950/60 border-zinc-800 text-zinc-400 hover:border-zinc-700"
                    }`}
                  >
                    <div className="font-semibold text-[11px] flex items-center gap-1.5">
                      <Cloud className="w-3 h-3 text-indigo-400" />
                      <span>{p.label}</span>
                    </div>
                    <div className="text-[10px] text-zinc-500 mt-0.5">{p.desc}</div>
                  </button>
                ))}
              </div>
            </div>

            {/* BYOS Credential Inputs */}
            {provider !== "devpulse_r2" && (
              <div className="p-4 rounded-xl bg-zinc-950 border border-zinc-800 space-y-3">
                <div className="flex items-center gap-1.5 text-indigo-300 font-semibold">
                  <KeyRound className="w-3.5 h-3.5" />
                  <span>Bring Your Own Storage (BYOS) S3/R2 Credentials</span>
                </div>

                <div className="grid grid-cols-2 gap-2.5">
                  <div>
                    <label className="block text-[11px] text-zinc-400 mb-1">S3 / R2 Endpoint URL</label>
                    <input
                      type="url"
                      value={endpoint}
                      onChange={(e) => setEndpoint(e.target.value)}
                      placeholder="https://<acct>.r2.cloudflarestorage.com"
                      className="w-full px-3 py-2 rounded-lg bg-zinc-900 border border-zinc-800 font-mono text-[11px] text-zinc-200 focus:outline-none focus:border-indigo-500"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] text-zinc-400 mb-1">Bucket Name</label>
                    <input
                      type="text"
                      value={bucketName}
                      onChange={(e) => setBucketName(e.target.value)}
                      placeholder="my-crash-dumps"
                      className="w-full px-3 py-2 rounded-lg bg-zinc-900 border border-zinc-800 font-mono text-[11px] text-zinc-200 focus:outline-none focus:border-indigo-500"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2.5">
                  <div>
                    <label className="block text-[11px] text-zinc-400 mb-1">Access Key ID</label>
                    <input
                      type="text"
                      value={accessKeyId}
                      onChange={(e) => setAccessKeyId(e.target.value)}
                      placeholder="AKIA... or R2 Access Key"
                      className="w-full px-3 py-2 rounded-lg bg-zinc-900 border border-zinc-800 font-mono text-[11px] text-zinc-200 focus:outline-none focus:border-indigo-500"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] text-zinc-400 mb-1">Secret Access Key</label>
                    <input
                      type="password"
                      value={secretAccessKey}
                      onChange={(e) => setSecretAccessKey(e.target.value)}
                      placeholder="Secret key"
                      className="w-full px-3 py-2 rounded-lg bg-zinc-900 border border-zinc-800 font-mono text-[11px] text-zinc-200 focus:outline-none focus:border-indigo-500"
                    />
                  </div>
                </div>
              </div>
            )}

            <div className="flex items-center gap-2 text-[11px] text-zinc-400 px-1">
              <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0" />
              <span>
                Heavy 100 KB+ stack traces & screenshots bypass Turso row limits and upload via SigV4 presigned URLs.
              </span>
            </div>
          </div>
        )}

        {/* Footer */}
        <div className="mt-5 pt-3 border-t border-zinc-800 flex items-center justify-between gap-2">
          {provider !== "devpulse_r2" ? (
            <button
              type="button"
              onClick={() => handleSave(true)}
              disabled={testing || saving || isDemo}
              className="px-3.5 py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs font-medium transition disabled:opacity-40"
            >
              {testing ? "Verifying Bucket..." : "Test & Connect BYOS"}
            </button>
          ) : (
            <span className="text-[11px] text-zinc-500">Cloudflare R2 Lifecycle Active</span>
          )}

          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-3.5 py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs font-medium transition"
            >
              Close
            </button>
            <button
              type="button"
              onClick={() => handleSave(false)}
              disabled={saving || testing || isDemo}
              className="px-4 py-2 rounded-xl bg-purple-600 hover:bg-purple-500 text-white text-xs font-semibold shadow-lg shadow-purple-600/20 transition disabled:opacity-50"
            >
              {saving ? "Saving..." : "Save Storage Config"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
