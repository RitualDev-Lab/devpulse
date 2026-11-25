"use client";

import React, { useState, useEffect } from "react";
import {
  X,
  CheckCircle2,
  Loader2,
  Sparkles,
  Star,
  Lock,
  Search,
  Building2,
  RefreshCw,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

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
  alreadyImported: boolean;
}

interface GitHubOrgSummary {
  login: string;
  avatarUrl: string | null;
}

interface ImportRepositoryModalProps {
  isOpen: boolean;
  onClose: () => void;
  onImportSuccess?: (project: any) => void;
}

export function ImportRepositoryModal({
  isOpen,
  onClose,
  onImportSuccess,
}: ImportRepositoryModalProps) {
  const router = useRouter();
  const [repos, setRepos] = useState<GitHubRepoChoice[]>([]);
  const [orgs, setOrgs] = useState<GitHubOrgSummary[]>([]);
  const [githubUsername, setGithubUsername] = useState<string>("");
  const [hasOAuthToken, setHasOAuthToken] = useState(true);
  const [selectedOwner, setSelectedOwner] = useState<string>("all");
  const [loadingRepos, setLoadingRepos] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [isScanning, setIsScanning] = useState(false);
  const [scanStep, setScanStep] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [scanResult, setScanResult] = useState<{
    project: any;
    summary: string[];
  } | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setLoadingRepos(true);
    setError(null);
    fetch("/api/v1/github/repos")
      .then((r) => r.json())
      .then((d) => {
        if (Array.isArray(d.repos)) setRepos(d.repos);
        if (Array.isArray(d.orgs)) setOrgs(d.orgs);
        if (d.githubUsername) setGithubUsername(d.githubUsername);
        if (typeof d.hasOAuthToken === "boolean") setHasOAuthToken(d.hasOAuthToken);
      })
      .catch(() => {})
      .finally(() => setLoadingRepos(false));
  }, [isOpen]);

  if (!isOpen) return null;

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

  const handleScanAndImport = async (targetRepo: string) => {
    setError(null);
    setIsScanning(true);
    setScanStep(`Verifying ownership & scanning ${targetRepo} manifests...`);

    try {
      const res = await fetch("/api/v1/projects/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repo: targetRepo }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to scan repository.");
      }

      setScanStep("Project command center generated!");
      setScanResult({
        project: data.project,
        summary: data.summary || [],
      });

      setTimeout(() => {
        if (onImportSuccess) onImportSuccess(data.project);
        setIsScanning(false);
        onClose();
        router.push(`/dashboard?project=${data.project.slug}`);
        router.refresh();
      }, 900);
    } catch (err: any) {
      setError(err.message || "An unexpected error occurred while scanning.");
      setIsScanning(false);
    }
  };

  const ownerTabs = Array.from(
    new Set([githubUsername, ...orgs.map((o) => o.login)].filter(Boolean))
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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-in fade-in duration-200">
      <div className="relative w-full max-w-xl rounded-2xl bg-zinc-900 border border-zinc-800 shadow-2xl p-6 overflow-hidden max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between pb-4 border-b border-zinc-800/80 mb-4">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-400">
              <Sparkles className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-base font-semibold text-white">
                Import Personal or Org Repository
              </h3>
              <p className="text-xs text-zinc-400">
                Verified ownership only &bull; Protects telemetry, API keys &amp; analytics
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

        <div className="space-y-4 overflow-y-auto flex-1 pr-1">
          {!loadingRepos && (!hasOAuthToken || orgs.length === 0) && (
            <div className="p-3 rounded-xl bg-indigo-950/40 border border-indigo-500/40 flex items-center justify-between gap-3 text-xs">
              <div className="flex items-center gap-2 text-indigo-200">
                <Building2 className="w-4 h-4 text-indigo-400 shrink-0" />
                <span>Sync GitHub Organizations (e.g. RitualDev-Lab) with read:org access.</span>
              </div>
              <button
                type="button"
                onClick={syncGitHubOrgs}
                className="shrink-0 flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-semibold"
              >
                <RefreshCw className="w-3 h-3" />
                <span>Sync Orgs</span>
              </button>
            </div>
          )}

          {/* Owner / Organization Tabs */}
          {ownerTabs.length > 0 && (
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
                  {owner.toLowerCase() !== githubUsername.toLowerCase() && (
                    <Building2 className="w-3 h-3 text-cyan-400" />
                  )}
                  <span>{owner}</span>
                </button>
              ))}
            </div>
          )}

          {/* Searchable Owned + Organization Repos */}
          <div className="rounded-xl bg-zinc-950 border border-zinc-800 overflow-hidden">
            <div className="p-2.5 border-b border-zinc-800 flex items-center gap-2">
              <Search className="w-3.5 h-3.5 text-zinc-500" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search your repositories & organizations..."
                className="w-full bg-transparent text-xs text-white placeholder-zinc-500 focus:outline-none"
              />
            </div>
            <div className="max-h-64 overflow-y-auto divide-y divide-zinc-800/60">
              {loadingRepos ? (
                <div className="p-5 flex items-center justify-center gap-2 text-xs text-zinc-400">
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-indigo-400" />
                  <span>Loading your personal &amp; organization repositories...</span>
                </div>
              ) : filteredRepos.length === 0 ? (
                <div className="p-5 text-center text-xs text-zinc-500">
                  No owned or organization repositories found in this view.
                </div>
              ) : (
                filteredRepos.map((repo) => (
                  <div
                    key={repo.id}
                    className="px-3 py-2.5 flex items-center justify-between gap-2 hover:bg-zinc-900/70 transition"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5 text-xs font-medium text-white truncate">
                        <span className="truncate">{repo.fullName}</span>
                        {repo.ownerType === "organization" && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-cyan-500/15 text-cyan-300 border border-cyan-500/30">
                            Org
                          </span>
                        )}
                        {repo.isPrivate && <Lock className="w-3 h-3 text-amber-400 shrink-0" />}
                        {repo.language && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-300">
                            {repo.language}
                          </span>
                        )}
                        <span className="text-[10px] text-zinc-500 inline-flex items-center gap-0.5">
                          <Star className="w-2.5 h-2.5 text-amber-400" />
                          {repo.stars}
                        </span>
                      </div>
                    </div>
                    <button
                      type="button"
                      disabled={isScanning || repo.alreadyImported}
                      onClick={() => handleScanAndImport(repo.fullName)}
                      className="shrink-0 px-2.5 py-1 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:bg-zinc-800 disabled:text-zinc-500 text-[11px] font-semibold text-white transition"
                    >
                      {repo.alreadyImported ? "Imported" : "Import"}
                    </button>
                  </div>
                ))
              )}
            </div>
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
            </div>
          )}

          {scanResult && (
            <div className="p-3.5 rounded-xl bg-emerald-950/40 border border-emerald-500/30 text-emerald-200 text-xs space-y-1.5">
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

          <div className="flex items-center justify-end pt-1">
            <button
              type="button"
              onClick={onClose}
              disabled={isScanning}
              className="px-3.5 py-1.5 rounded-xl text-xs text-zinc-400 hover:text-white transition"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
