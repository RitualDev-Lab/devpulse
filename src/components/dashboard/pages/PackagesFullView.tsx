"use client";

import React, { useState } from "react";
import { Package, Download, KeyRound, Plus, Trash2, Loader2, ExternalLink } from "lucide-react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import type { LoadedWorkspaceReady } from "@/lib/dashboard/load-workspace";
import { WorkspaceShell } from "../WorkspaceShell";
import { NpmDownloadsCard } from "../widgets/NpmDownloadsCard";
import { PyPiDownloadsCard } from "../widgets/PyPiDownloadsCard";
import { RustCratesCard } from "../widgets/RustCratesCard";
import { GoModuleCard } from "../widgets/GoModuleCard";
import { DockerContainerCard } from "../widgets/DockerContainerCard";
import { VsCodeStatsCard } from "../widgets/VsCodeStatsCard";
import { McpStatsCard } from "../widgets/McpStatsCard";
import { QuickConnectPanel } from "../QuickConnectPanel";

export function PackagesFullView({ workspace }: { workspace: LoadedWorkspaceReady }) {
  const { initialData, projects, customDomain, storageTier, isDemo } = workspace;
  const project = initialData.project;
  const npmDaily = initialData.npmStats?.dailyHistory || [];
  const packageConnectors = (initialData.connectors || []).filter(
    (c) => c.category === "package" || c.category === "custom"
  );

  const [pkgProvider, setPkgProvider] = useState("docker");
  const [pkgLabel, setPkgLabel] = useState("");
  const [pkgUrl, setPkgUrl] = useState("");
  const [pkgToken, setPkgToken] = useState("");
  const [savingPkg, setSavingPkg] = useState(false);

  const handleAddPackageConnector = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isDemo) return;
    setSavingPkg(true);
    try {
      const res = await fetch("/api/v1/projects/connectors", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "add_connector",
          projectId: project.id,
          category: pkgProvider === "custom" ? "custom" : "package",
          provider: pkgProvider,
          label: pkgLabel.trim() || `${pkgProvider} Connector`,
          targetUrl: pkgUrl.trim() || undefined,
          apiKey: pkgToken.trim() || undefined,
        }),
      });
      if (res.ok) window.location.reload();
    } finally {
      setSavingPkg(false);
    }
  };

  const handleDeletePackageConnector = async (connectorId: string) => {
    if (isDemo) return;
    await fetch("/api/v1/projects/connectors", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "delete_connector", projectId: project.id, connectorId }),
    });
    window.location.reload();
  };

  const hasAnyPackage = Boolean(
    project.npmPackage ||
      project.pypiPackage ||
      project.rustCrate ||
      project.goModule ||
      project.dockerImage ||
      project.vscodeExtension ||
      project.mcpServerName
  );

  return (
    <WorkspaceShell
      currentProject={{ ...project, telemetryApiKey: project.telemetryApiKey }}
      projects={projects}
      storageTier={storageTier}
      customDomain={customDomain}
      isDemo={isDemo}
    >
      <div className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-extrabold text-white flex items-center gap-2.5">
              <Package className="w-6 h-6 text-indigo-400" />
              <span>Packages &amp; Daily Downloads</span>
            </h1>
            <p className="text-xs text-zinc-400 mt-0.5">
              Paste any npm/PyPI/Crates/Docker/VS Code URL or supply an optional npm Read Token for private packages.
            </p>
          </div>
          {project.hasNpmToken && (
            <span className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-xl bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 font-medium">
              <KeyRound className="w-3.5 h-3.5" />
              <span>Encrypted npm Token Active</span>
            </span>
          )}
        </div>

        {/* Full-Width 30-Day Daily Download Velocity Chart */}
        {npmDaily.length > 0 && (
          <div className="p-5 rounded-2xl bg-zinc-900/90 border border-zinc-800 space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-sm font-bold text-white flex items-center gap-1.5">
                  <Download className="w-4 h-4 text-red-400" />
                  <span>Daily Downloads ({project.npmPackage}) — Last 30 Days</span>
                </h2>
                <p className="text-xs text-zinc-400">
                  {initialData.npmStats?.downloadsLastMonth.toLocaleString()} total downloads last 30d
                </p>
              </div>
            </div>
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={npmDaily}>
                  <XAxis dataKey="date" tick={{ fill: "#71717a", fontSize: 10 }} />
                  <YAxis tick={{ fill: "#71717a", fontSize: 10 }} width={40} />
                  <Tooltip
                    contentStyle={{ backgroundColor: "#09090b", borderColor: "#27272a", borderRadius: "8px", fontSize: "12px" }}
                  />
                  <Area type="monotone" dataKey="downloads" stroke="#ef4444" fill="#ef444425" strokeWidth={2} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}

        {/* Active Ecosystem Cards */}
        {hasAnyPackage && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {project.npmPackage && (
              <NpmDownloadsCard stats={initialData.npmStats} packageName={project.npmPackage} />
            )}
            {project.pypiPackage && (
              <PyPiDownloadsCard stats={initialData.pypiStats} packageName={project.pypiPackage} />
            )}
            {project.rustCrate && (
              <RustCratesCard stats={initialData.rustStats} crateName={project.rustCrate} />
            )}
            {project.goModule && (
              <GoModuleCard stats={initialData.goStats || null} modulePath={project.goModule} />
            )}
            {project.dockerImage && (
              <DockerContainerCard stats={initialData.dockerStats || null} imageName={project.dockerImage} />
            )}
            {project.vscodeExtension && (
              <VsCodeStatsCard stats={initialData.vscodeStats} extensionId={project.vscodeExtension} />
            )}
            {project.mcpServerName && (
              <McpStatsCard stats={initialData.mcpStats} serverName={project.mcpServerName} />
            )}
          </div>
        )}

        {/* Modular Package Tokens & Custom URL Probes */}
        <form
          onSubmit={handleAddPackageConnector}
          className="p-5 rounded-2xl bg-zinc-900/90 border border-zinc-800 space-y-3"
        >
          <div>
            <h2 className="text-sm font-bold text-white flex items-center gap-2">
              <Plus className="w-4 h-4 text-cyan-400" />
              <span>Add Package Registry Token or Custom URL Probe</span>
            </h2>
            <p className="text-xs text-zinc-400 mt-0.5">
              Supply Docker Hub PAT, PyPI/Crates/npm tokens, or custom JSON stats URLs — encrypted at rest with AES-256-GCM.
            </p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <select
              value={pkgProvider}
              onChange={(e) => setPkgProvider(e.target.value)}
              className="px-3 py-2 rounded-xl bg-zinc-950 border border-zinc-800 text-xs text-white"
            >
              <option value="docker">Docker Hub PAT</option>
              <option value="npm">npm Token / Org</option>
              <option value="pypi">PyPI Probe</option>
              <option value="crates">Crates.io Probe</option>
              <option value="custom">Custom Registry URL Probe</option>
            </select>
            <input
              type="text"
              value={pkgLabel}
              onChange={(e) => setPkgLabel(e.target.value)}
              placeholder="Label (e.g. Private Docker Hub)"
              className="px-3 py-2 rounded-xl bg-zinc-950 border border-zinc-800 text-xs text-white"
            />
            <input
              type="url"
              value={pkgUrl}
              onChange={(e) => setPkgUrl(e.target.value)}
              placeholder="Registry or JSON URL (optional)"
              className="px-3 py-2 rounded-xl bg-zinc-950 border border-zinc-800 text-xs font-mono text-white"
            />
            <input
              type="password"
              value={pkgToken}
              onChange={(e) => setPkgToken(e.target.value)}
              placeholder="PAT / API Token (optional)"
              className="px-3 py-2 rounded-xl bg-zinc-950 border border-zinc-800 text-xs font-mono text-white"
            />
          </div>
          <div className="flex justify-end">
            <button
              type="submit"
              disabled={savingPkg || isDemo}
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold disabled:opacity-50"
            >
              {savingPkg ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
              <span>Add Package Connector</span>
            </button>
          </div>
        </form>

        {packageConnectors.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {packageConnectors.map((c) => (
              <div key={c.id} className="p-4 rounded-2xl bg-zinc-900/90 border border-zinc-800 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded-full bg-indigo-500/15 text-indigo-300 border border-indigo-500/30">
                    {c.provider}
                  </span>
                  <div className="text-sm font-bold text-white mt-1 truncate">{c.label}</div>
                  {c.targetUrl && (
                    <a href={c.targetUrl} target="_blank" rel="noreferrer" className="text-[11px] font-mono text-cyan-400 inline-flex items-center gap-1">
                      <span className="truncate max-w-[180px]">{c.targetUrl}</span>
                      <ExternalLink className="w-3 h-3" />
                    </a>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => handleDeletePackageConnector(c.id)}
                  className="p-1.5 rounded-lg bg-zinc-950 hover:bg-red-950/60 text-zinc-500 hover:text-red-300 border border-zinc-800"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Inline Quick Connect to paste package URLs or add npm API Key */}
        <QuickConnectPanel
          projectId={project.id}
          projectSlug={project.slug}
          telemetryApiKey={project.telemetryApiKey}
          initialPreset={project.stackPreset}
          hasNpmToken={project.hasNpmToken}
          hasGithubToken={project.hasGithubToken}
          isDemo={isDemo}
          onSuccess={() => window.location.reload()}
        />
      </div>
    </WorkspaceShell>
  );
}
