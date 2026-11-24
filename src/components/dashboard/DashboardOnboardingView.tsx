"use client";

import React, { useState } from "react";
import {
  Sparkles,
  GitBranch,
  ArrowRight,
  Loader2,
  CheckCircle2,
  ShieldCheck,
  Terminal,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { AuthButton } from "@/components/auth/AuthButton";

interface DashboardOnboardingViewProps {
  user: {
    githubUsername: string;
    name?: string | null;
    avatarUrl?: string | null;
  };
}

export function DashboardOnboardingView({ user }: DashboardOnboardingViewProps) {
  const router = useRouter();
  const [repoInput, setRepoInput] = useState(`${user.githubUsername}/`);
  const [isScanning, setIsScanning] = useState(false);
  const [scanStep, setScanStep] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<string[] | null>(null);

  const handleImport = async (e: React.FormEvent) => {
    e.preventDefault();
    const clean = repoInput.trim().replace(/^https?:\/\/github\.com\//, "");
    if (!clean || !clean.includes("/")) {
      setError("Please provide a repository in 'owner/repo' format (e.g. ritualdev-lab/devpulse).");
      return;
    }

    setError(null);
    setIsScanning(true);
    setScanStep("Inspecting GitHub repository tree...");

    try {
      const res = await fetch("/api/v1/projects/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repo: clean }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to scan and import repository.");
      }

      setScanStep("Configuring live telemetry and package metrics...");
      setSummary(data.summary || []);

      setTimeout(() => {
        router.push(`/dashboard?project=${data.project.slug}`);
        router.refresh();
      }, 1200);
    } catch (err: any) {
      setError(err.message || "An error occurred while importing repository.");
      setIsScanning(false);
    }
  };

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 flex flex-col justify-between selection:bg-indigo-500/30 selection:text-white">
      {/* Top Header */}
      <header className="w-full border-b border-zinc-800/80 bg-zinc-950/70 backdrop-blur-xl">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="font-extrabold text-white text-base tracking-tight">DevPulse</span>
            <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
              Workspace Setup
            </span>
          </div>
          <AuthButton />
        </div>
      </header>

      {/* Main Form */}
      <main className="max-w-xl mx-auto w-full px-4 py-16 text-center space-y-6 relative">
        <div className="space-y-3">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-zinc-900 border border-zinc-800 text-xs text-zinc-300">
            <Sparkles className="w-3.5 h-3.5 text-indigo-400" />
            <span>Welcome, @{user.githubUsername}!</span>
          </div>

          <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight text-white">
            Import Your First Repository
          </h1>
          <p className="text-sm text-zinc-400 max-w-md mx-auto leading-relaxed">
            Enter any public or private GitHub repository you maintain. DevPulse will inspect the
            manifests and build your unified headquarters automatically.
          </p>
        </div>

        <form onSubmit={handleImport} className="space-y-4 text-left p-6 rounded-2xl bg-zinc-900/80 border border-zinc-800 shadow-xl">
          <div>
            <label className="block text-xs font-semibold text-zinc-300 mb-1.5">
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
                className="w-full pl-9 pr-3 py-2.5 rounded-xl bg-zinc-950 border border-zinc-800 text-sm text-white placeholder-zinc-500 focus:outline-none focus:border-indigo-500 font-mono"
              />
            </div>
            <p className="text-[11px] text-zinc-500 mt-1.5">
              We detect package.json (npm), Cargo.toml (Rust), pyproject.toml (PyPI), and go.mod (Go).
            </p>
          </div>

          {error && (
            <div className="p-3 rounded-xl bg-red-950/40 border border-red-500/30 text-red-300 text-xs">
              {error}
            </div>
          )}

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

          {summary && (
            <div className="p-3.5 rounded-xl bg-emerald-950/40 border border-emerald-500/30 text-emerald-200 text-xs space-y-1">
              <div className="flex items-center gap-1.5 font-semibold text-emerald-400">
                <CheckCircle2 className="w-4 h-4" />
                <span>Auto-Configured Ecosystems:</span>
              </div>
              <ul className="pl-4 list-disc text-emerald-300/90 text-[11px]">
                {summary.map((item, idx) => (
                  <li key={idx}>{item}</li>
                ))}
              </ul>
            </div>
          )}

          <button
            type="submit"
            disabled={isScanning}
            className="w-full flex items-center justify-center gap-2 py-3 px-4 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-xs font-semibold text-white shadow-lg shadow-indigo-600/20 transition"
          >
            {isScanning ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Scanning Repository...</span>
              </>
            ) : (
              <>
                <span>Scan & Launch Headquarters</span>
                <ArrowRight className="w-4 h-4" />
              </>
            )}
          </button>
        </form>
      </main>

      <footer className="border-t border-zinc-900 bg-zinc-950 py-6 text-center text-xs text-zinc-600">
        DevPulse &bull; Unified Developer Headquarters
      </footer>
    </div>
  );
}
