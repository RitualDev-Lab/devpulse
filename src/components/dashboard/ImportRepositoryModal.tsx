"use client";

import React, { useState, useEffect } from "react";
import {
  X,
  CheckCircle2,
  ArrowRight,
  Loader2,
  Sparkles,
  GitBranch,
  Star,
  Lock,
  Search,
} from "lucide-react";
import { useRouter } from "next/navigation";

interface GitHubRepoChoice {
  id: number;
  name: string;
  fullName: string;
  description: string | null;
  language: string | null;
  stars: number;
  isPrivate: boolean;
  alreadyImported: boolean;
}

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
  const [repos, setRepos] = useState<GitHubRepoChoice[]>([]);
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
    fetch("/api/v1/github/repos")
      .then((r) => r.json())
      .then((d) => {
        if (Array.isArray(d.repos)) setRepos(d.repos);
      })
      .catch(() => {})
      .finally(() => setLoadingRepos(false));
  }, [isOpen]);

  if (!isOpen) return null;

  const handleScanAndImport = async (targetRepo?: string) => {
    const clean = (targetRepo ?? repoInput).trim().replace(/^https?:\/\/github\.com\//, "");
    if (!clean || !clean.includes("/")) {
      setError("Please enter a valid repository in 'owner/repo' format.");
      return;
    }

    setError(null);
    setIsScanning(true);
    setScanStep(`Scanning ${clean} root manifests (package.json, Cargo.toml, pyproject.toml, go.mod)...`);

    try {
      const res = await fetch("/api/v1/projects/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repo: clean }),
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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-in fade-in duration-200">
      <div className="relative w-full max-w-xl rounded-2xl bg-zinc-900 border border-zinc-800 shadow-2xl p-6 overflow-hidden max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between pb-4 border-b border-zinc-800/80 mb-4">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-400">
              <Sparkles className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-base font-semibold text-white">Import Your GitHub Repository</h3>
              <p className="text-xs text-zinc-400">
                1-Click Scanner detects npm, PyPI, Rust, Go, Docker &amp; MCP manifests
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
          {/* Searchable Real Repos */}
          <div className="rounded-xl bg-zinc-950 border border-zinc-800 overflow-hidden">
            <div className="p-2.5 border-b border-zinc-800 flex items-center gap-2">
              <Search className="w-3.5 h-3.5 text-zinc-500" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search your GitHub repositories..."
                className="w-full bg-transparent text-xs text-white placeholder-zinc-500 focus:outline-none"
              />
            </div>
            <div className="max-h-48 overflow-y-auto divide-y divide-zinc-800/60">
              {loadingRepos ? (
                <div className="p-4 flex items-center justify-center gap-2 text-xs text-zinc-400">
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-indigo-400" />
                  <span>Fetching your repositories from GitHub...</span>
                </div>
              ) : filteredRepos.length === 0 ? (
                <div className="p-4 text-center text-xs text-zinc-500">
                  No matching repositories found. Enter any <code className="text-zinc-300">owner/repo</code> below.
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

          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleScanAndImport();
            }}
            className="space-y-3"
          >
            <div>
              <label className="block text-xs font-medium text-zinc-300 mb-1.5">
                Or Enter Repository Manually (owner/repo)
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
                  placeholder="owner/repository"
                  disabled={isScanning}
                  className="w-full pl-9 pr-3 py-2 rounded-xl bg-zinc-950 border border-zinc-800 text-sm text-white placeholder-zinc-500 focus:outline-none focus:border-indigo-500 transition font-mono"
                />
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
                disabled={isScanning || !repoInput.trim()}
                className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-xs font-semibold text-white shadow-lg shadow-indigo-600/20 transition"
              >
                <span>Scan &amp; Import</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
