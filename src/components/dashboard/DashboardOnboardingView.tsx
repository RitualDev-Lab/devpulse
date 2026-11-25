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
  Building2,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { AuthButton } from "@/components/auth/AuthButton";
import { createClient } from "@/lib/supabase/client";
import { STACK_PRESETS, type StackPresetId } from "@/lib/dashboard/presets";

interface GitHubRepoChoice {
  id: number;
  name: string;
  fullName: string;
  owner: string;
  ownerType: "personal" | "organization";
  description: string | null;
  language: string | null;
  stars: number;
  isPrivate: boolean;
  updatedAt: string;
  alreadyImported: boolean;
}

interface GitHubOrgSummary {
  login: string;
  avatarUrl: string | null;
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
  const [repos, setRepos] = useState<GitHubRepoChoice[]>([]);
  const [orgs, setOrgs] = useState<GitHubOrgSummary[]>([]);
  const [hasOAuthToken, setHasOAuthToken] = useState(true);
  const [selectedOwner, setSelectedOwner] = useState<string>("all");
  const [selectedPreset, setSelectedPreset] = useState<StackPresetId>("saas");
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
        if (Array.isArray(d.orgs)) setOrgs(d.orgs);
        if (typeof d.hasOAuthToken === "boolean") setHasOAuthToken(d.hasOAuthToken);
      })
      .catch(() => {})
      .finally(() => setLoadingRepos(false));
  }, []);

  const syncGitHubOrgs = async () => {
    const supabase = createClient();
    await supabase.auth.signInWithOAuth({
      provider: "github",
      options: {
        scopes: "read:user user:email read:org",
        redirectTo: `${window.location.origin}/auth/callback`,
      },
    });
  };

  const importRepository = async (fullName: string) => {
    const clean = fullName.trim();
    setError(null);
    setIsScanning(true);
    setScanningRepo(clean);
    setScanStep(`Scanning ${clean} manifests (package.json, Cargo.toml, pyproject.toml, go.mod)...`);

    try {
      const res = await fetch("/api/v1/projects/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repo: clean, stackPreset: selectedPreset }),
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

  const ownerTabs = Array.from(
    new Set([user.githubUsername, ...orgs.map((o) => o.login)])
  );

  const filteredRepos = repos.filter((r) => {
    if (selectedOwner !== "all" && r.owner.toLowerCase() !== selectedOwner.toLowerCase()) {
      return false;
    }
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

      <main className="max-w-3xl mx-auto w-full px-4 py-12 space-y-6 relative">
        <div className="text-center space-y-3">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-zinc-900 border border-zinc-800 text-xs text-zinc-300">
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
            <span>Verified Account: @{user.githubUsername}</span>
          </div>

          <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight text-white">
            Import Your Personal or Organization Repository
          </h1>
          <p className="text-sm text-zinc-400 max-w-xl mx-auto leading-relaxed">
            For telemetry isolation and security, DevPulse only connects repositories you own or
            verified GitHub Organizations (like <code className="text-zinc-200">RitualDev-Lab</code>).
          </p>
        </div>

        {/* Sync Organizations prompt if read:org token isn't active yet */}
        {!loadingRepos && (!hasOAuthToken || orgs.length === 0) && (
          <div className="p-4 rounded-2xl bg-indigo-950/35 border border-indigo-500/40 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2.5 text-xs text-indigo-200">
              <Building2 className="w-4 h-4 text-indigo-400 shrink-0" />
              <span>
                Want to see your Organization repositories (e.g.{" "}
                <strong className="text-white">RitualDev-Lab</strong>)? Grant GitHub{" "}
                <code className="text-indigo-300">read:org</code> permission.
              </span>
            </div>
            <button
              type="button"
              onClick={syncGitHubOrgs}
              className="shrink-0 flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-xs font-semibold text-white transition"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>Sync GitHub Orgs</span>
            </button>
          </div>
        )}

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

        {/* Role-Aware Preset Picker */}
        <div className="rounded-2xl bg-zinc-900/70 border border-zinc-800 p-4 space-y-2.5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-zinc-200 flex items-center gap-1.5">
              <Layers className="w-4 h-4 text-indigo-400" />
              <span>Select Role-Aware Stack Preset</span>
            </span>
            <span className="text-[11px] text-zinc-400">Auto-sets dashboard &amp; telemetry snippet</span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
            {Object.values(STACK_PRESETS).map((preset) => (
              <button
                key={preset.id}
                type="button"
                onClick={() => setSelectedPreset(preset.id)}
                className={`p-3 rounded-xl border text-left transition ${
                  selectedPreset === preset.id
                    ? "bg-indigo-600/20 border-indigo-500 text-white"
                    : "bg-zinc-950 border-zinc-800 text-zinc-400 hover:border-zinc-700"
                }`}
              >
                <div className="text-xs font-bold text-white">{preset.name}</div>
                <div className="text-[10px] font-mono text-indigo-300 mt-0.5">{preset.badge}</div>
              </button>
            ))}
          </div>
        </div>

        {/* Personal + Organization Repository Picker */}
        <div className="rounded-2xl bg-zinc-900/80 border border-zinc-800 shadow-xl overflow-hidden">
          <div className="p-4 border-b border-zinc-800 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <GitBranch className="w-4 h-4 text-indigo-400" />
                <span className="text-xs font-bold text-white">
                  Your Owned &amp; Organization Repositories ({filteredRepos.length})
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

            <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
              <button
                type="button"
                onClick={() => setSelectedOwner("all")}
                className={`px-2.5 py-1 rounded-lg font-medium transition ${
                  selectedOwner === "all"
                    ? "bg-indigo-600 text-white"
                    : "bg-zinc-950 border border-zinc-800 text-zinc-400 hover:text-white"
                }`}
              >
                All ({repos.length})
              </button>
              {ownerTabs.map((owner) => (
                <button
                  key={owner}
                  type="button"
                  onClick={() => setSelectedOwner(owner)}
                  className={`px-2.5 py-1 rounded-lg font-medium transition flex items-center gap-1 ${
                    selectedOwner.toLowerCase() === owner.toLowerCase()
                      ? "bg-indigo-600 text-white"
                      : "bg-zinc-950 border border-zinc-800 text-zinc-400 hover:text-white"
                  }`}
                >
                  {owner.toLowerCase() !== user.githubUsername.toLowerCase() && (
                    <Building2 className="w-3 h-3 text-cyan-400" />
                  )}
                  <span>{owner}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="max-h-80 overflow-y-auto divide-y divide-zinc-800/70">
            {loadingRepos ? (
              <div className="p-8 flex items-center justify-center gap-2 text-xs text-zinc-400">
                <Loader2 className="w-4 h-4 animate-spin text-indigo-400" />
                <span>Discovering personal &amp; organization repositories...</span>
              </div>
            ) : filteredRepos.length === 0 ? (
              <div className="p-6 text-center text-xs text-zinc-500">
                No repositories matched. Click <strong>Sync GitHub Orgs</strong> above if your organization membership is private on GitHub.
              </div>
            ) : (
              filteredRepos.map((repo) => (
                <div
                  key={repo.id}
                  className="px-4 py-3 flex items-center justify-between gap-3 hover:bg-zinc-950/60 transition"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs font-semibold text-white truncate">
                        {repo.fullName}
                      </span>
                      {repo.ownerType === "organization" && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-cyan-500/15 text-cyan-300 border border-cyan-500/30 font-medium">
                          Org
                        </span>
                      )}
                      {repo.isPrivate && <Lock className="w-3 h-3 text-amber-400 shrink-0" />}
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

        {/* Standalone App Workspace */}
        <div className="p-5 rounded-2xl bg-zinc-900/60 border border-zinc-800 flex flex-wrap items-center justify-between gap-4">
          <div>
            <h3 className="text-xs font-semibold text-zinc-200 flex items-center gap-1.5">
              <Layers className="w-3.5 h-3.5 text-emerald-400" />
              Track a Website, SaaS, or Desktop/Mobile Software App
            </h3>
            <p className="text-[11px] text-zinc-500 mt-1">
              Get Sentry-style crash tracking, Cloudflare R2 stack dumps &amp; cookie-free analytics without linking a GitHub repo.
            </p>
          </div>
          <button
            type="button"
            disabled={isScanning}
            onClick={createBlankAppWorkspace}
            className="shrink-0 py-2.5 px-4 rounded-xl bg-emerald-600/20 hover:bg-emerald-600/30 border border-emerald-500/30 text-emerald-300 text-xs font-semibold transition"
          >
            Launch App &amp; Telemetry Workspace
          </button>
        </div>
      </main>

      <footer className="border-t border-zinc-900 bg-zinc-950 py-6 text-center text-xs text-zinc-600">
        DevPulse &bull; Enterprise Developer Command Center
      </footer>
    </div>
  );
}
