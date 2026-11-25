"use client";

import React, { useState } from "react";
import { createPortal } from "react-dom";
import {
  X,
  KeyRound,
  ExternalLink,
  CheckCircle2,
  Loader2,
  ShieldCheck,
  Lock,
  BookOpen,
} from "lucide-react";

interface GitHubPatModalProps {
  isOpen: boolean;
  onClose: () => void;
  projectId?: string;
  hasExistingToken?: boolean;
  onSaved?: () => void;
}

export function GitHubPatModal({
  isOpen,
  onClose,
  projectId,
  hasExistingToken = false,
  onSaved,
}: GitHubPatModalProps) {
  const [token, setToken] = useState("");
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<{ ok: boolean; msg: string } | null>(null);
  const [tab, setTab] = useState<"classic" | "fine">("classic");

  if (!isOpen || typeof document === "undefined") return null;

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleaned = token.trim();
    if (!cleaned || !projectId) return;
    setSaving(true);
    setStatus(null);
    try {
      const res = await fetch("/api/v1/projects/connectors", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "quick_connect",
          projectId,
          githubToken: cleaned,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to save GitHub PAT");
      }
      setStatus({
        ok: true,
        msg: "GitHub PAT encrypted & saved! Reloading traffic & private repo telemetry...",
      });
      setToken("");
      setTimeout(() => {
        if (onSaved) onSaved();
        else window.location.reload();
        onClose();
      }, 750);
    } catch (err: any) {
      setStatus({ ok: false, msg: err?.message || "Failed to save GitHub PAT" });
    } finally {
      setSaving(false);
    }
  };

  return createPortal(
    <div
      onClick={onClose}
      className="fixed inset-0 z-[120] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-150"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-xl rounded-2xl bg-zinc-900 border border-zinc-700 shadow-2xl p-6 max-h-[90vh] flex flex-col text-left"
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-3 pb-4 border-b border-zinc-800">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-amber-500/15 border border-amber-500/30 flex items-center justify-center text-amber-400">
              <KeyRound className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-base font-bold text-white">
                Add GitHub PAT &amp; Setup Guide
              </h3>
              <p className="text-xs text-zinc-400">
                Unlocks Daily Git Clones, Repository Views, Private Repos &amp; Auto-Issues
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800 transition"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="mt-4 space-y-4 overflow-y-auto pr-1 text-xs">
          {/* Save PAT Form */}
          {projectId && (
            <form
              onSubmit={handleSave}
              className="p-4 rounded-xl bg-zinc-950 border border-zinc-800 space-y-3"
            >
              <div className="flex items-center justify-between gap-2">
                <label className="text-xs font-semibold text-white flex items-center gap-1.5">
                  <Lock className="w-3.5 h-3.5 text-emerald-400" />
                  <span>
                    {hasExistingToken ? "Rotate Project GitHub PAT" : "Paste Your GitHub Personal Access Token"}
                  </span>
                </label>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-emerald-500/10 border border-emerald-500/20 text-emerald-300">
                  AES-256-GCM Encrypted
                </span>
              </div>

              <div className="flex flex-col sm:flex-row gap-2">
                <input
                  type="password"
                  required
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                  placeholder="ghp_... or github_pat_..."
                  className="flex-1 px-3 py-2 rounded-xl bg-zinc-900 border border-zinc-800 text-xs font-mono text-white placeholder-zinc-600 focus:outline-none focus:border-amber-500"
                />
                <button
                  type="submit"
                  disabled={saving || !token.trim()}
                  className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-xs font-semibold flex items-center justify-center gap-1.5 transition shrink-0"
                >
                  {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
                  <span>{saving ? "Encrypting..." : "Save GitHub PAT"}</span>
                </button>
              </div>

              {status && (
                <div
                  className={`p-2.5 rounded-lg text-[11px] flex items-center gap-1.5 ${
                    status.ok
                      ? "bg-emerald-950/60 border border-emerald-700/60 text-emerald-200"
                      : "bg-red-950/60 border border-red-700/60 text-red-200"
                  }`}
                >
                  {status.ok && <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />}
                  <span>{status.msg}</span>
                </div>
              )}
            </form>
          )}

          {/* Step-by-Step Guide */}
          <div className="p-4 rounded-xl bg-zinc-950/70 border border-zinc-800 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-bold text-white flex items-center gap-1.5">
                <BookOpen className="w-3.5 h-3.5 text-indigo-400" />
                <span>How to Generate a GitHub PAT (30 seconds)</span>
              </span>
              <div className="flex items-center gap-1 bg-zinc-900 p-0.5 rounded-lg border border-zinc-800">
                <button
                  type="button"
                  onClick={() => setTab("classic")}
                  className={`px-2 py-1 rounded text-[11px] font-medium transition ${
                    tab === "classic" ? "bg-indigo-600 text-white" : "text-zinc-400 hover:text-white"
                  }`}
                >
                  Classic Token (Fastest)
                </button>
                <button
                  type="button"
                  onClick={() => setTab("fine")}
                  className={`px-2 py-1 rounded text-[11px] font-medium transition ${
                    tab === "fine" ? "bg-indigo-600 text-white" : "text-zinc-400 hover:text-white"
                  }`}
                >
                  Fine-Grained
                </button>
              </div>
            </div>

            {tab === "classic" ? (
              <div className="space-y-2.5 text-zinc-300 leading-relaxed">
                <ol className="list-decimal pl-4 space-y-1.5">
                  <li>
                    Click{" "}
                    <a
                      href="https://github.com/settings/tokens/new?scopes=repo,read:org&description=DevPulse+Telemetry"
                      target="_blank"
                      rel="noreferrer"
                      className="text-indigo-300 hover:underline font-semibold inline-flex items-center gap-1"
                    >
                      Open GitHub Classic Token Generator <ExternalLink className="w-3 h-3" />
                    </a>{" "}
                    (pre-selects the exact scopes!).
                  </li>
                  <li>
                    Ensure <code className="text-amber-300 font-mono">repo</code> (required by GitHub for Daily Clones / Traffic API &amp; private repos) and{" "}
                    <code className="text-amber-300 font-mono">read:org</code> are checked.
                  </li>
                  <li>
                    Click <strong>Generate token</strong>, copy the <code className="font-mono text-zinc-200">ghp_...</code> string, and paste it above.
                  </li>
                </ol>
              </div>
            ) : (
              <div className="space-y-2.5 text-zinc-300 leading-relaxed">
                <ol className="list-decimal pl-4 space-y-1.5">
                  <li>
                    Open{" "}
                    <a
                      href="https://github.com/settings/personal-access-tokens/new"
                      target="_blank"
                      rel="noreferrer"
                      className="text-indigo-300 hover:underline font-semibold inline-flex items-center gap-1"
                    >
                      GitHub Fine-Grained Tokens <ExternalLink className="w-3 h-3" />
                    </a>
                    .
                  </li>
                  <li>
                    Select your personal or organization repository access (Public + Private repositories).
                  </li>
                  <li>
                    Under <strong>Repository permissions</strong> set:
                    <ul className="list-disc pl-4 mt-1 text-zinc-400 font-mono text-[11px]">
                      <li>Administration: Read-only (unlocks Traffic Clones &amp; Views)</li>
                      <li>Contents &amp; Metadata: Read-only (scans private manifests)</li>
                      <li>Issues &amp; Pull requests: Read &amp; Write (2-way crash sync)</li>
                    </ul>
                  </li>
                </ol>
              </div>
            )}

            <div className="pt-2 border-t border-zinc-800/80 flex items-center gap-2 text-[11px] text-zinc-400">
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
              <span>
                Your token is encrypted at rest with AES-256-GCM and never sent to public portals or Viewer/Billing roles.
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
