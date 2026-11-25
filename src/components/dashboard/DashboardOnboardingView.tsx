"use client";

import React, { useState, useEffect } from "react";
import {
  Sparkles,
  GitBranch,
  ArrowRight,
  Loader2,
  CheckCircle2,
  Star,
  Lock,
  Search,
  Layers,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { AuthButton } from "@/components/auth/AuthButton";

interface GitHubRepoChoice {
  id: number;
  name: string;
  fullName: string;
  description: string | null;
  language: string | null;
  stars: number;
  isPrivate: boolean;
  updatedAt: string;
  alreadyImported: boolean;
}

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
  const [repos, setRepos] = useState<GitHubRepoChoice[]>([]);
  const [loadingRepos, setLoadingRepos] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [isScanning, setIsScanning] = useState(false);
  const [scanningRepo, setScanningRepo] = useState<string | null>(null);
  const [scanStep, setScanStep] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<string[] | null>(null);

  useEffect(() => {
    fetch("/api/v1/github/repos")
      .then((r) => r.json())
      .then((d) => {
        if (Array.isArray(d.repos)) setRepos(d.repos);
      })
      .catch(() => {})
      .finally(() => setLoadingRepos(false));
  }, []);

  const importRepository = async (fullName: string) => {
    const clean = fullName.trim().replace(/^https?:\/\/github\.com\//, "");
    if (!clean || !clean.includes("/")) {
      setError("Please provide a repository in 'owner/repo' format.");
      return;
    }

    setError(null);
    setIsScanning(true);
    setScanningRepo(clean);
    setScanStep(`Scanning ${clean} manifests (package.json, Cargo.toml, pyproject.toml, go.mod)...`);

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

      setScanStep("Command Center provisioned! Redirecting...");
      setSummary(data.summary || []);

      setTimeout(() => {
        router.push(`/dashboard?project=${data.project.slug}`);
        router.refresh();
      }, 900);
    } catch (err: any) {
      setError(err.message || "An error occurred while importing repository.");
      setIsScanning(false);
      setScanningRepo(null);
    }
  };

  const createBlankAppWorkspace = async () => {
    setError(null);
    setIsScanning(true);
    setScanStep("Creating Sentry & App Analytics workspace...");
    try {
      const res = await fetch("/api/v1/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: `${user.githubUsername} App` }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to create workspace.");
      router.push(`/dashboard?project=${data.project.slug}`);
      router.refresh();
    } catch (err: any) {
      setError(err.message || "Failed to create workspace.");
      setIsScanning(false);
    }
  };

  const filteredRepos = repos.filter((r) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return (
      r.fullName.toLowerCase().includes(q) ||
      (r.description || "").toLowerCase().includes(q) ||
      (r.language || "").toLowerCase().includes(q)
    );
  });

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 flex flex-col justify-between selection:bg-indigo-500/30 selection:text-white">
      <header className="w-full border-b border-zinc-800/80 bg-zinc-950/70 backdrop-blur-xl">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="font-extrabold text-white text-base tracking-tight">DevPulse</span>
            <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
              Enterprise Onboarding
            </span>
          </div>
          <AuthButton />
        </div>
      </header>

      <main className="max-w-3xl mx-auto w-full px-4 py-12 space-y-8 relative">
        <div className="text-center space-y-3">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-zinc-900 border border-zinc-800 text-xs text-zinc-300">
            <Sparkles className="w-3.5 h-3.5 text-indigo-400" />
            <span>Authenticated as @{user.githubUsername}</span>
          </div>

          <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight text-white">
            Select a Repository or Create App Workspace
          </h1>
          <p className="text-sm text-zinc-400 max-w-lg mx-auto leading-relaxed">
            Pick one of your real GitHub repositories below—DevPulse zero-config scans your manifests,
            or launch a standalone Web/Desktop/Mobile App workspace for Sentry-style crash &amp; analytics tracking.
          </p>
        </div>

        {error && (
          <div className="p-3.5 rounded-xl bg-red-950/50 border border-red-500/40 text-red-200 text-xs text-center">
            {error}
          </div>
        )}

        {isScanning && (
          <div className="p-4 rounded-2xl bg-indigo-950/40 border border-indigo-500/30 space-y-2">
            <div className="flex items-center gap-2 text-indigo-300 text-xs font-medium">
              <Loader2 className="w-4 h-4 animate-spin text-indigo-400" />
              <span>{scanStep}</span>
            </div>
            {summary && summary.length > 0 && (
              <div className="text-[11px] text-emerald-300 flex items-center gap-1.5 pt-1">
                <CheckCircle2 className="w-3.5 h-3.5" />
                <span>{summary.join(" • ")}</span>
              </div>
            )}
          </div>
        )}

        {/* Real GitHub Repository Picker */}
        <div className="rounded-2xl bg-zinc-900/80 border border-zinc-800 shadow-xl overflow-hidden">
          <div className="p-4 border-b border-zinc-800 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <GitBranch className="w-4 h-4 text-indigo-400" />
              <span className="text-xs font-bold text-white">
                Your GitHub Repositories ({repos.length})
              </span>
            </div>
            <div className="relative w-full sm:w-64">
              <Search className="w-3.5 h-3.5 text-zinc-500 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Filter repositories..."
                className="w-full pl-8 pr-3 py-1.5 rounded-xl bg-zinc-950 border border-zinc-800 text-xs text-white placeholder-zinc-500 focus:outline-none focus:border-indigo-500"
              />
            </div>
          </div>

          <div className="max-h-72 overflow-y-auto divide-y divide-zinc-800/70">
            {loadingRepos ? (
              <div className="p-8 flex items-center justify-center gap-2 text-xs text-zinc-400">
                <Loader2 className="w-4 h-4 animate-spin text-indigo-400" />
                <span>Loading repositories from @{user.githubUsername}...</span>
              </div>
            ) : filteredRepos.length === 0 ? (
              <div className="p-6 text-center text-xs text-zinc-500">
                No matching public/accessible repositories found. Enter any <code className="text-zinc-300">owner/repo</code> below or create a blank App workspace.
              </div>
            ) : (
              filteredRepos.map((repo) => (
                <div
                  key={repo.id}
                  className="px-4 py-3 flex items-center justify-between gap-3 hover:bg-zinc-950/60 transition"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-semibold text-white truncate">
                        {repo.fullName}
                      </span>
                      {repo.isPrivate && (
                        <Lock className="w-3 h-3 text-amber-400 shrink-0" />
                      )}
                      {repo.language && (
                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-zinc-800 text-zinc-300">
                          {repo.language}
                        </span>
                      )}
                      <span className="text-[10px] text-zinc-500 flex items-center gap-0.5">
                        <Star className="w-3 h-3 text-amber-400" />
                        {repo.stars}
                      </span>
                    </div>
                    {repo.description && (
                      <p className="text-[11px] text-zinc-500 truncate mt-0.5">
                        {repo.description}
                      </p>
                    )}
                  </div>
                  <button
                    type="button"
                    disabled={isScanning}
                    onClick={() => importRepository(repo.fullName)}
                    className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-[11px] font-semibold text-white transition"
                  >
                    {scanningRepo === repo.fullName ? (
                      <Loader2 className="w-3 h-3 animate-spin" />
                    ) : (
                      <ArrowRight className="w-3 h-3" />
                    )}
                    <span>Import</span>
                  </button>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Manual owner/repo + Blank App Workspace */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              importRepository(repoInput);
            }}
            className="p-5 rounded-2xl bg-zinc-900/60 border border-zinc-800 space-y-3"
          >
            <label className="block text-xs font-semibold text-zinc-200">
              Or Scan Any External GitHub Repo
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={repoInput}
                onChange={(e) => setRepoInput(e.target.value)}
                placeholder="owner/repo"
                disabled={isScanning}
                className="flex-1 px-3 py-2 rounded-xl bg-zinc-950 border border-zinc-800 text-xs text-white font-mono placeholder-zinc-500 focus:outline-none focus:border-indigo-500"
              />
              <button
                type="submit"
                disabled={isScanning}
                className="px-3.5 py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-xs font-semibold text-white transition"
              >
                Scan
              </button>
            </div>
          </form>

          <div className="p-5 rounded-2xl bg-zinc-900/60 border border-zinc-800 flex flex-col justify-between space-y-3">
            <div>
              <h3 className="text-xs font-semibold text-zinc-200 flex items-center gap-1.5">
                <Layers className="w-3.5 h-3.5 text-emerald-400" />
                Track a Website, SaaS, or Desktop/Mobile App
              </h3>
              <p className="text-[11px] text-zinc-500 mt-1">
                Get instant Sentry-style crash capture + Web/App analytics without linking a GitHub repo.
              </p>
            </div>
            <button
              type="button"
              disabled={isScanning}
              onClick={createBlankAppWorkspace}
              className="w-full py-2 px-3 rounded-xl bg-emerald-600/20 hover:bg-emerald-600/30 border border-emerald-500/30 text-emerald-300 text-xs font-semibold transition"
            >
              Launch App &amp; Telemetry Workspace
            </button>
          </div>
        </div>
      </main>

      <footer className="border-t border-zinc-900 bg-zinc-950 py-6 text-center text-xs text-zinc-600">
        DevPulse &bull; Enterprise Developer Command Center
      </footer>
    </div>
  );
}
