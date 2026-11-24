"use client";

import React, { useState } from "react";
import {
  X,
  Search,
  CheckCircle2,
  Package,
  Layers,
  Terminal,
  ArrowRight,
  Loader2,
  Sparkles,
  GitBranch,
} from "lucide-react";
import { useRouter } from "next/navigation";

interface ImportRepositoryModalProps {
  isOpen: boolean;
  onClose: () => void;
  onImportSuccess?: (project: any) => void;
  suggestedRepo?: string;
}

export function ImportRepositoryModal({
  isOpen,
  onClose,
  onImportSuccess,
  suggestedRepo = "",
}: ImportRepositoryModalProps) {
  const router = useRouter();
  const [repoInput, setRepoInput] = useState(suggestedRepo);
  const [isScanning, setIsScanning] = useState(false);
  const [scanStep, setScanStep] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [scanResult, setScanResult] = useState<{
    project: any;
    summary: string[];
  } | null>(null);

  if (!isOpen) return null;

  const handleScanAndImport = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const clean = repoInput.trim().replace(/^https?:\/\/github\.com\//, "");
    if (!clean || !clean.includes("/")) {
      setError("Please enter a valid repository in 'owner/repo' format (e.g. 'ritualdev-lab/devpulse').");
      return;
    }

    setError(null);
    setIsScanning(true);
    setScanStep("Querying GitHub API & repository tree...");

    try {
      setScanStep("Inspecting root files (package.json, Cargo.toml, pyproject.toml, go.mod, mcp.json)...");

      const res = await fetch("/api/v1/projects/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repo: clean }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Failed to scan repository.");
      }

      setScanStep("Project mission control generated successfully!");
      setScanResult({
        project: data.project,
        summary: data.summary || [],
      });

      setTimeout(() => {
        if (onImportSuccess) {
          onImportSuccess(data.project);
        }
        setIsScanning(false);
        onClose();
        router.push(`/dashboard?project=${data.project.slug}`);
        router.refresh();
      }, 1200);
    } catch (err: any) {
      setError(err.message || "An unexpected error occurred while scanning.");
      setIsScanning(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-in fade-in duration-200">
      <div className="relative w-full max-w-lg rounded-2xl bg-zinc-900 border border-zinc-800 shadow-2xl p-6 overflow-hidden">
        {/* Glow ambient background */}
        <div className="absolute top-0 right-0 w-64 h-64 bg-indigo-500/10 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute bottom-0 left-0 w-64 h-64 bg-cyan-500/10 rounded-full blur-3xl pointer-events-none" />

        {/* Modal Header */}
        <div className="flex items-center justify-between pb-4 border-b border-zinc-800/80 mb-5 relative z-10">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-400">
              <Sparkles className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-base font-semibold text-white">Import Repository</h3>
              <p className="text-xs text-zinc-400">
                1-Click GitHub Scanner auto-links npm, PyPI, Rust, Go & MCP
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800 transition"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleScanAndImport} className="space-y-4 relative z-10">
          <div>
            <label className="block text-xs font-medium text-zinc-300 mb-1.5">
              GitHub Repository (owner/repo)
            </label>
            <div className="relative">
              <GitBranch className="w-4 h-4 text-zinc-500 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={repoInput}
                onChange={(e) => {
                  setRepoInput(e.target.value);
                  setError(null);
                }}
                placeholder="e.g. ritualdev-lab/devpulse"
                disabled={isScanning}
                className="w-full pl-9 pr-3 py-2 rounded-xl bg-zinc-950 border border-zinc-800 text-sm text-white placeholder-zinc-500 focus:outline-none focus:border-indigo-500 transition font-mono"
              />
            </div>
            <p className="text-[11px] text-zinc-500 mt-1">
              DevPulse scans root configuration files and configures your entire dashboard automatically.
            </p>
          </div>

          {/* Quick Suggestions */}
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[11px] text-zinc-400">Examples:</span>
            <button
              type="button"
              onClick={() => setRepoInput("ritualdev-lab/devpulse")}
              className="text-[11px] px-2 py-0.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 transition font-mono"
            >
              ritualdev-lab/devpulse
            </button>
            <button
              type="button"
              onClick={() => setRepoInput("expressjs/express")}
              className="text-[11px] px-2 py-0.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 transition font-mono"
            >
              expressjs/express
            </button>
            <button
              type="button"
              onClick={() => setRepoInput("psf/requests")}
              className="text-[11px] px-2 py-0.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 transition font-mono"
            >
              psf/requests
            </button>
          </div>

          {/* Error Message */}
          {error && (
            <div className="p-3 rounded-xl bg-red-950/40 border border-red-500/30 text-red-300 text-xs">
              {error}
            </div>
          )}

          {/* Progress / Step Feedback */}
          {isScanning && (
            <div className="p-3.5 rounded-xl bg-indigo-950/40 border border-indigo-500/30 space-y-2">
              <div className="flex items-center gap-2 text-indigo-300 text-xs font-medium">
                <Loader2 className="w-3.5 h-3.5 animate-spin text-indigo-400" />
                <span>{scanStep}</span>
              </div>
              <div className="w-full bg-zinc-800 rounded-full h-1 overflow-hidden">
                <div className="bg-indigo-500 h-1 rounded-full animate-pulse w-3/4" />
              </div>
            </div>
          )}

          {/* Scan Results Summary Preview */}
          {scanResult && (
            <div className="p-3.5 rounded-xl bg-emerald-950/40 border border-emerald-500/30 text-emerald-200 text-xs space-y-1.5 animate-in fade-in">
              <div className="flex items-center gap-1.5 font-semibold text-emerald-400">
                <CheckCircle2 className="w-4 h-4" />
                <span>Scan Complete! Auto-Configured:</span>
              </div>
              <ul className="space-y-0.5 pl-4 list-disc text-emerald-300/90 text-[11px]">
                {scanResult.summary.map((item, idx) => (
                  <li key={idx}>{item}</li>
                ))}
              </ul>
            </div>
          )}

          {/* Actions */}
          <div className="flex items-center justify-end gap-2.5 pt-2">
            <button
              type="button"
              onClick={onClose}
              disabled={isScanning}
              className="px-3.5 py-1.5 rounded-xl text-xs text-zinc-400 hover:text-white transition"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isScanning}
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-xs font-semibold text-white shadow-lg shadow-indigo-600/20 transition"
            >
              {isScanning ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>Scanning...</span>
                </>
              ) : (
                <>
                  <span>Scan & Import</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
