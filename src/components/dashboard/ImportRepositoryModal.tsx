"use client";

import React, { useState, useEffect } from "react";
import { createPortal } from "react-dom";
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
  Globe,
  Package,
  KeyRound,
  GitBranch,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { STACK_PRESETS, type StackPresetId } from "@/lib/dashboard/presets";
import { PackageSearchPicker } from "./PackageSearchPicker";

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
  const [mode, setMode] = useState<"github" | "standalone">("github");

  const [repos, setRepos] = useState<GitHubRepoChoice[]>([]);
  const [orgs, setOrgs] = useState<GitHubOrgSummary[]>([]);
  const [githubUsername, setGithubUsername] = useState<string>("");
  const [hasOAuthToken, setHasOAuthToken] = useState(true);
  const [selectedOwner, setSelectedOwner] = useState<string>("all");
  const [selectedPreset, setSelectedPreset] = useState<StackPresetId>("saas");
  const [loadingRepos, setLoadingRepos] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [showPrivatePatBox, setShowPrivatePatBox] = useState(false);
  const [manualRepoSlug, setManualRepoSlug] = useState("");
  const [manualPat, setManualPat] = useState("");

  // Standalone (No GitHub Repo) state
  const [standaloneName, setStandaloneName] = useState("");
  const [pypiPackage, setPypiPackage] = useState("");
  const [npmPackage, setNpmPackage] = useState("");
  const [rustCrate, setRustCrate] = useState("");
  const [goModule, setGoModule] = useState("");
  const [dockerImage, setDockerImage] = useState("");
  const [vscodeExtension, setVsCodeExtension] = useState("");
  const [mcpServerName, setMcpServerName] = useState("");
  const [websiteUrl, setWebsiteUrl] = useState("");

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

  if (!isOpen || typeof document === "undefined") return null;

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

  const handleScanAndImport = async (targetRepo: string, explicitPat?: string) => {
    setError(null);
    setIsScanning(true);
    setScanStep(`Verifying ownership & scanning ${targetRepo} manifests...`);

    try {
      const res = await fetch("/api/v1/projects/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          repo: targetRepo,
          stackPreset: selectedPreset,
          githubToken: explicitPat?.trim() || undefined,
        }),
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

  const handleCreateStandalone = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!standaloneName.trim()) {
      setError("Please enter a project or app name.");
      return;
    }
    setError(null);
    setIsScanning(true);
    setScanStep(`Provisioning standalone workspace "${standaloneName.trim()}"...`);

    try {
      const res = await fetch("/api/v1/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: standaloneName.trim(),
          stackPreset: selectedPreset,
          pypiPackage: pypiPackage.trim() || null,
          npmPackage: npmPackage.trim() || null,
          rustCrate: rustCrate.trim() || null,
          goModule: goModule.trim() || null,
          dockerImage: dockerImage.trim() || null,
          vscodeExtension: vscodeExtension.trim() || null,
          mcpServerName: mcpServerName.trim() || null,
          websiteUrl: websiteUrl.trim() || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to create standalone workspace.");
      }

      setScanStep("Workspace & telemetry keys provisioned!");
      setScanResult({
        project: data.project,
        summary: [
          `Workspace: ${data.project.name}`,
          ...(pypiPackage.trim() ? [`PyPI: ${pypiPackage.trim()}`] : []),
          ...(npmPackage.trim() ? [`npm: ${npmPackage.trim()}`] : []),
          ...(rustCrate.trim() ? [`Crates.io: ${rustCrate.trim()}`] : []),
          ...(goModule.trim() ? [`Go: ${goModule.trim()}`] : []),
          ...(dockerImage.trim() ? [`Docker: ${dockerImage.trim()}`] : []),
          ...(vscodeExtension.trim() ? [`VS Code: ${vscodeExtension.trim()}`] : []),
          ...(mcpServerName.trim() ? [`MCP: ${mcpServerName.trim()}`] : []),
          ...(websiteUrl.trim() ? [`Health Probe: ${websiteUrl.trim()}`] : []),
        ],
      });

      setTimeout(() => {
        if (onImportSuccess) onImportSuccess(data.project);
        setIsScanning(false);
        onClose();
        router.push(`/dashboard?project=${data.project.slug}`);
        router.refresh();
      }, 850);
    } catch (err: any) {
      setError(err.message || "Failed to create workspace.");
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

  return createPortal(
    <div
      onClick={onClose}
      className="fixed inset-0 z-[120] flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-in fade-in duration-200"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="relative w-full max-w-xl rounded-2xl bg-zinc-900 border border-zinc-800 shadow-2xl p-6 overflow-hidden max-h-[90vh] flex flex-col"
      >
        <div className="flex items-center justify-between pb-4 border-b border-zinc-800/80 mb-4">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-400">
              <Sparkles className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-base font-semibold text-white">
                Add Project or Telemetry Workspace
              </h3>
              <p className="text-xs text-zinc-400">
                Public or Private GitHub repo, or standalone Web / App / OCI / PyPI without Git
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

        {/* Mode Switcher */}
        <div className="grid grid-cols-2 gap-2 p-1 rounded-xl bg-zinc-950 border border-zinc-800 mb-4 shrink-0">
          <button
            type="button"
            onClick={() => setMode("github")}
            className={`flex items-center justify-center gap-1.5 py-2 px-3 rounded-lg text-xs font-semibold transition ${
              mode === "github"
                ? "bg-indigo-600 text-white"
                : "text-zinc-400 hover:text-white"
            }`}
          >
            <GitBranch className="w-3.5 h-3.5" />
            <span>GitHub Repo (Public / Private)</span>
          </button>
          <button
            type="button"
            onClick={() => setMode("standalone")}
            className={`flex items-center justify-center gap-1.5 py-2 px-3 rounded-lg text-xs font-semibold transition ${
              mode === "standalone"
                ? "bg-emerald-600 text-white"
                : "text-zinc-400 hover:text-white"
            }`}
          >
            <Globe className="w-3.5 h-3.5" />
            <span>Web / Package / OCI (No Git)</span>
          </button>
        </div>

        <div className="space-y-4 overflow-y-auto flex-1 pr-1">
          {/* Role-Aware Stack Preset Picker */}
          <div className="space-y-1.5">
            <span className="text-[11px] font-semibold text-zinc-400">
              1. Pick Stack Preset (auto-configures widgets &amp; SDK snippet)
            </span>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
              {Object.values(STACK_PRESETS).map((preset) => (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() => setSelectedPreset(preset.id)}
                  className={`p-2 rounded-xl border text-left transition ${
                    selectedPreset === preset.id
                      ? "bg-indigo-600/20 border-indigo-500 text-white"
                      : "bg-zinc-950 border-zinc-800 text-zinc-400 hover:text-zinc-200"
                  }`}
                >
                  <div className="text-[11px] font-bold truncate">{preset.name.split(" ")[0]}</div>
                  <div className="text-[10px] text-indigo-300 font-mono truncate">{preset.badge}</div>
                </button>
              ))}
            </div>
          </div>

          {mode === "github" ? (
            <>
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

              {/* Private Repo / PAT Direct Import Toggle */}
              <div className="rounded-xl bg-zinc-950 border border-zinc-800 p-3 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <button
                    type="button"
                    onClick={() => setShowPrivatePatBox((v) => !v)}
                    className="flex items-center gap-1.5 text-xs font-semibold text-amber-300 hover:text-amber-200 transition"
                  >
                    <Lock className="w-3.5 h-3.5" />
                    <span>
                      {showPrivatePatBox
                        ? "Hide Private Repo PAT Importer"
                        : "Have a Private Repo not listed? Import via GitHub PAT"}
                    </span>
                  </button>
                  <a
                    href="https://github.com/settings/tokens/new?scopes=repo,read:org&description=DevPulse+Private+Repo"
                    target="_blank"
                    rel="noreferrer"
                    className="text-[10px] text-indigo-300 hover:underline"
                  >
                    Generate PAT &rarr;
                  </a>
                </div>

                {showPrivatePatBox && (
                  <div className="pt-2 space-y-2 border-t border-zinc-800/80">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      <input
                        type="text"
                        value={manualRepoSlug}
                        onChange={(e) => setManualRepoSlug(e.target.value)}
                        placeholder="owner/private-repo"
                        className="px-3 py-2 rounded-lg bg-zinc-900 border border-zinc-800 text-xs font-mono text-white placeholder-zinc-500"
                      />
                      <input
                        type="password"
                        value={manualPat}
                        onChange={(e) => setManualPat(e.target.value)}
                        placeholder="GitHub PAT (ghp_... with repo scope)"
                        className="px-3 py-2 rounded-lg bg-zinc-900 border border-zinc-800 text-xs font-mono text-white placeholder-zinc-500"
                      />
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[10px] text-zinc-500">
                        PAT is AES-256-GCM encrypted &amp; unlocks private repo + daily clone stats.
                      </span>
                      <button
                        type="button"
                        disabled={isScanning || !manualRepoSlug.trim()}
                        onClick={() => handleScanAndImport(manualRepoSlug.trim(), manualPat)}
                        className="px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-white text-xs font-semibold flex items-center gap-1"
                      >
                        <KeyRound className="w-3 h-3" />
                        <span>Import Private Repo</span>
                      </button>
                    </div>
                  </div>
                )}
              </div>

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
                    placeholder="Search your public & private repositories..."
                    className="w-full bg-transparent text-xs text-white placeholder-zinc-500 focus:outline-none"
                  />
                </div>
                <div className="max-h-56 overflow-y-auto divide-y divide-zinc-800/60">
                  {loadingRepos ? (
                    <div className="p-5 flex items-center justify-center gap-2 text-xs text-zinc-400">
                      <Loader2 className="w-3.5 h-3.5 animate-spin text-indigo-400" />
                      <span>Loading your personal &amp; organization repositories...</span>
                    </div>
                  ) : filteredRepos.length === 0 ? (
                    <div className="p-5 text-center text-xs text-zinc-500">
                      No owned or organization repositories found. Use the Private Repo PAT box above or switch to Web / Package (No Git).
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
            </>
          ) : (
            <form onSubmit={handleCreateStandalone} className="space-y-3 p-4 rounded-xl bg-zinc-950 border border-zinc-800">
              <div className="flex items-center gap-2 text-xs font-semibold text-emerald-300">
                <Package className="w-4 h-4" />
                <span>Create Standalone App / Package / OCI Server Workspace</span>
              </div>
              <p className="text-[11px] text-zinc-400">
                No GitHub repo required. Search and attach any PyPI, npm, Crates.io, Docker, VS Code, MCP, or Go package below, or enter names manually.
              </p>

              <div className="p-3 rounded-xl bg-zinc-900/70 border border-zinc-800 space-y-2">
                <span className="text-[11px] font-semibold text-zinc-300 block">
                  Search &amp; Select Package / Extension / Container
                </span>
                <PackageSearchPicker
                  compact
                  actionLabel="Select"
                  selectedValues={{
                    pypiPackage,
                    npmPackage,
                    rustCrate,
                    dockerImage,
                    vscodeExtension,
                    mcpServerName,
                    goModule,
                  }}
                  onSelectItem={(item) => {
                    if (item.field === "pypiPackage") setPypiPackage(item.name);
                    else if (item.field === "npmPackage") setNpmPackage(item.name);
                    else if (item.field === "rustCrate") setRustCrate(item.name);
                    else if (item.field === "dockerImage") setDockerImage(item.name);
                    else if (item.field === "vscodeExtension") setVsCodeExtension(item.name);
                    else if (item.field === "mcpServerName") setMcpServerName(item.name);
                    else if (item.field === "goModule") setGoModule(item.name);
                    if (!standaloneName.trim()) {
                      setStandaloneName(item.name.split("/").pop() || item.name);
                    }
                  }}
                />
              </div>

              <div className="space-y-2.5">
                <div>
                  <label className="block text-[11px] text-zinc-400 mb-1">
                    Project / App Name *
                  </label>
                  <input
                    type="text"
                    required
                    value={standaloneName}
                    onChange={(e) => setStandaloneName(e.target.value)}
                    placeholder="e.g., my-oci-api, data-cleaner-py, my-saas-web"
                    className="w-full px-3 py-2 rounded-lg bg-zinc-900 border border-zinc-800 text-xs text-white placeholder-zinc-500 focus:outline-none focus:border-emerald-500"
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  <div>
                    <label className="block text-[11px] text-zinc-400 mb-1">
                      PyPI Package (Optional, no npm needed)
                    </label>
                    <input
                      type="text"
                      value={pypiPackage}
                      onChange={(e) => setPypiPackage(e.target.value)}
                      placeholder="e.g., fastapi or my-py-pkg"
                      className="w-full px-3 py-2 rounded-lg bg-zinc-900 border border-zinc-800 text-xs font-mono text-white placeholder-zinc-600"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] text-zinc-400 mb-1">
                      npm Package (Optional)
                    </label>
                    <input
                      type="text"
                      value={npmPackage}
                      onChange={(e) => setNpmPackage(e.target.value)}
                      placeholder="e.g., @org/sdk"
                      className="w-full px-3 py-2 rounded-lg bg-zinc-900 border border-zinc-800 text-xs font-mono text-white placeholder-zinc-600"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] text-zinc-400 mb-1">
                      Rust Crate (Optional)
                    </label>
                    <input
                      type="text"
                      value={rustCrate}
                      onChange={(e) => setRustCrate(e.target.value)}
                      placeholder="e.g., devpulse-rs"
                      className="w-full px-3 py-2 rounded-lg bg-zinc-900 border border-zinc-800 text-xs font-mono text-white placeholder-zinc-600"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] text-zinc-400 mb-1">
                      Docker Image / OCI Registry (Optional)
                    </label>
                    <input
                      type="text"
                      value={dockerImage}
                      onChange={(e) => setDockerImage(e.target.value)}
                      placeholder="e.g., myorg/api-server"
                      className="w-full px-3 py-2 rounded-lg bg-zinc-900 border border-zinc-800 text-xs font-mono text-white placeholder-zinc-600"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] text-zinc-400 mb-1">
                      Go Module Path (Optional)
                    </label>
                    <input
                      type="text"
                      value={goModule}
                      onChange={(e) => setGoModule(e.target.value)}
                      placeholder="e.g., github.com/gin-gonic/gin"
                      className="w-full px-3 py-2 rounded-lg bg-zinc-900 border border-zinc-800 text-xs font-mono text-white placeholder-zinc-600"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] text-zinc-400 mb-1">
                      VS Code Extension ID (Optional)
                    </label>
                    <input
                      type="text"
                      value={vscodeExtension}
                      onChange={(e) => setVsCodeExtension(e.target.value)}
                      placeholder="e.g., publisher.extension-name"
                      className="w-full px-3 py-2 rounded-lg bg-zinc-900 border border-zinc-800 text-xs font-mono text-white placeholder-zinc-600"
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <label className="block text-[11px] text-zinc-400 mb-1">
                      MCP Server Registry Slug (Optional)
                    </label>
                    <input
                      type="text"
                      value={mcpServerName}
                      onChange={(e) => setMcpServerName(e.target.value)}
                      placeholder="e.g., @ritualdev-lab/devpulse-mcp"
                      className="w-full px-3 py-2 rounded-lg bg-zinc-900 border border-zinc-800 text-xs font-mono text-white placeholder-zinc-600"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-[11px] text-zinc-400 mb-1">
                    Website / OCI Server URL or Health Endpoint (Optional — enables Uptime + Analytics)
                  </label>
                  <input
                    type="url"
                    value={websiteUrl}
                    onChange={(e) => setWebsiteUrl(e.target.value)}
                    placeholder="https://api.my-oci-server.com/health"
                    className="w-full px-3 py-2 rounded-lg bg-zinc-900 border border-zinc-800 text-xs font-mono text-white placeholder-zinc-600"
                  />
                </div>
              </div>

              <div className="pt-1 flex justify-end">
                <button
                  type="submit"
                  disabled={isScanning || !standaloneName.trim()}
                  className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-xs font-semibold flex items-center gap-1.5"
                >
                  {isScanning ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                  <span>Create Standalone Workspace</span>
                </button>
              </div>
            </form>
          )}

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
                <span>Workspace Provisioned! Auto-Configured:</span>
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
    </div>,
    document.body
  );
}
