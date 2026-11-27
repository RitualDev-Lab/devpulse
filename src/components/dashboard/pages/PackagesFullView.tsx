"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
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
import { useWorkspaceData } from "../WorkspaceCacheContext";
import { useToast } from "../ToastContext";
import { NpmDownloadsCard } from "../widgets/NpmDownloadsCard";
import { PyPiDownloadsCard } from "../widgets/PyPiDownloadsCard";
import { RustCratesCard } from "../widgets/RustCratesCard";
import { GoModuleCard } from "../widgets/GoModuleCard";
import { DockerContainerCard } from "../widgets/DockerContainerCard";
import { VsCodeStatsCard } from "../widgets/VsCodeStatsCard";
import { McpStatsCard } from "../widgets/McpStatsCard";
import { PackageSecurityBadge } from "../widgets/PackageSecurityBadge";
import { SnapshotSyncBar } from "../SnapshotSyncBar";
import { QuickConnectPanel } from "../QuickConnectPanel";
import { PackageSearchPicker } from "../PackageSearchPicker";
import { securitySummaryKey } from "@/lib/integrations/registry-adapter";

export function PackagesFullView({ workspace }: { workspace: LoadedWorkspaceReady }) {
  const router = useRouter();
  const { showToast } = useToast();
  const { projects, customDomain, storageTier, isDemo } = workspace;
  const initialData = useWorkspaceData(workspace.initialData);
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
  const [hiddenSeries, setHiddenSeries] = useState<Record<string, boolean>>({});

  const toggleSeries = (key: string) =>
    setHiddenSeries((prev) => ({ ...prev, [key]: !prev[key] }));

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
      if (res.ok) {
        setPkgLabel("");
        setPkgUrl("");
        setPkgToken("");
        showToast("Package connector added", "success");
        router.refresh();
      }
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
    showToast("Package connector removed", "info");
    router.refresh();
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
          <div className="flex flex-wrap items-center gap-2">
            <SnapshotSyncBar
              projectId={project.id}
              snapshotUpdatedAt={initialData.snapshotUpdatedAt}
              isDemo={isDemo}
            />
            {project.hasNpmToken && (
              <span className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-xl bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 font-medium">
                <KeyRound className="w-3.5 h-3.5" />
                <span>Encrypted npm Token Active</span>
              </span>
            )}
          </div>
        </div>

        {/* Side-by-Side Daily Download Charts across npm, PyPI, Crates, Go, Docker, VS Code */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          {npmDaily.length > 0 && (
            <div className="p-5 rounded-2xl bg-zinc-900/90 border border-zinc-800 space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-sm font-bold text-white flex items-center gap-1.5">
                    <Download className="w-4 h-4 text-red-400" />
                    <span>npm Daily Downloads ({project.npmPackage})</span>
                  </h2>
                  <p className="text-xs text-zinc-400">
                    {initialData.npmStats?.downloadsLastMonth.toLocaleString()} downloads last 30d
                  </p>
                </div>
              </div>
              <div className="h-48">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={npmDaily}>
                    <XAxis dataKey="date" tick={{ fill: "#71717a", fontSize: 10 }} />
                    <YAxis tick={{ fill: "#71717a", fontSize: 10 }} width={40} />
                    <Tooltip
                      contentStyle={{ backgroundColor: "#09090b", borderColor: "#27272a", borderRadius: "8px", fontSize: "12px" }}
                    />
                    <Area type="monotone" dataKey="downloads" name="npm" stroke="#ef4444" fill="#ef444425" strokeWidth={2} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          <div className="p-5 rounded-2xl bg-zinc-900/90 border border-zinc-800 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="text-sm font-bold text-white flex items-center gap-1.5">
                  <Download className="w-4 h-4 text-indigo-400" />
                  <span>Multi-Registry Historical Velocity (PyPI, Crates, Docker, Go)</span>
                </h2>
                <p className="text-xs text-zinc-400">
                  Daily metrics persisted in Turso across package registries
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                {[
                  { key: "pypi", label: "PyPI", color: "#3b82f6" },
                  { key: "crates", label: "Crates", color: "#f97316" },
                  { key: "docker", label: "Docker", color: "#06b6d4" },
                  { key: "go", label: "Go", color: "#14b8a6" },
                ].map((s) => {
                  const off = Boolean(hiddenSeries[s.key]);
                  return (
                    <button
                      key={s.key}
                      type="button"
                      onClick={() => toggleSeries(s.key)}
                      className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-lg border transition ${
                        off
                          ? "bg-zinc-950 border-zinc-800 text-zinc-500 opacity-60"
                          : "bg-zinc-950 border-zinc-700 text-zinc-200"
                      }`}
                    >
                      <span className="w-2 h-2 rounded-full" style={{ backgroundColor: s.color }} />
                      <span>{s.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="h-48">
              {(initialData.packageHistory || []).length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart
                    data={initialData.packageHistory || []}
                    margin={{ top: 8, right: 12, left: 8, bottom: 0 }}
                  >
                    <XAxis dataKey="date" tick={{ fill: "#71717a", fontSize: 10 }} />
                    <YAxis
                      tick={{ fill: "#71717a", fontSize: 10 }}
                      width={52}
                      tickFormatter={(v: number) =>
                        v >= 1_000_000
                          ? `${(v / 1_000_000).toFixed(1)}M`
                          : v >= 1_000
                          ? `${Math.round(v / 1_000)}k`
                          : String(v)
                      }
                    />
                    <Tooltip
                      contentStyle={{ backgroundColor: "#09090b", borderColor: "#27272a", borderRadius: "8px", fontSize: "12px" }}
                    />
                    {!hiddenSeries.pypi && <Area type="monotone" dataKey="pypi" name="PyPI" stroke="#3b82f6" fill="#3b82f620" />}
                    {!hiddenSeries.crates && <Area type="monotone" dataKey="crates" name="Crates.io" stroke="#f97316" fill="#f9731620" />}
                    {!hiddenSeries.docker && <Area type="monotone" dataKey="docker" name="Docker" stroke="#06b6d4" fill="#06b6d420" />}
                    {!hiddenSeries.go && <Area type="monotone" dataKey="go" name="Go" stroke="#14b8a6" fill="#14b8a620" />}
                    {(initialData.packageHistory || []).some((d) => (d.cran || 0) > 0) && (
                      <Area type="monotone" dataKey="cran" name="CRAN (R)" stroke="#60a5fa" fill="#60a5fa20" />
                    )}
                    {(initialData.packageHistory || []).some((d) => (d.nuget || 0) > 0) && (
                      <Area type="monotone" dataKey="nuget" name="NuGet" stroke="#a855f7" fill="#a855f720" />
                    )}
                    {(initialData.packageHistory || []).some((d) => (d.packagist || 0) > 0) && (
                      <Area type="monotone" dataKey="packagist" name="Packagist" stroke="#f59e0b" fill="#f59e0b20" />
                    )}
                    {(initialData.packageHistory || []).some((d) => (d.rubygems || 0) > 0) && (
                      <Area type="monotone" dataKey="rubygems" name="RubyGems" stroke="#ef4444" fill="#ef444420" />
                    )}
                    {(initialData.packageHistory || []).some((d) => (d.pubdev || 0) > 0) && (
                      <Area type="monotone" dataKey="pubdev" name="pub.dev" stroke="#38bdf8" fill="#38bdf820" />
                    )}
                    {(initialData.packageHistory || []).some((d) => (d.hex || 0) > 0) && (
                      <Area type="monotone" dataKey="hex" name="Hex.pm" stroke="#c084fc" fill="#c084fc20" />
                    )}
                    {(initialData.packageHistory || []).some((d) => (d.homebrew || 0) > 0) && (
                      <Area type="monotone" dataKey="homebrew" name="Homebrew" stroke="#fbbf24" fill="#fbbf2420" />
                    )}
                  </AreaChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-full rounded-xl bg-zinc-950/60 border border-zinc-800/70 flex items-center justify-center text-xs text-zinc-500 text-center px-4">
                  Multi-registry daily points appear here as daily cron sync snapshots PyPI, Crates.io, Docker Hub &amp; Go metrics.
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Release Version Adoption & Registry Matrix Table */}
        <div className="rounded-2xl bg-zinc-900/90 border border-zinc-800 overflow-hidden">
          <div className="px-5 py-3.5 border-b border-zinc-800 flex items-center justify-between">
            <div>
              <h2 className="text-sm font-bold text-white">Release Version Adoption &amp; Registry Versions</h2>
              <p className="text-xs text-zinc-400">Live SDK session adoption, crash-free rates, and latest published versions</p>
            </div>
            <div className="flex flex-wrap gap-1.5 text-[11px] font-mono">
              {initialData.npmStats?.latestVersion && (
                <span className="px-2 py-0.5 rounded bg-red-500/15 text-red-300 border border-red-500/30">
                  npm: v{initialData.npmStats.latestVersion}
                </span>
              )}
              {initialData.pypiStats?.latestVersion && (
                <span className="px-2 py-0.5 rounded bg-blue-500/15 text-blue-300 border border-blue-500/30">
                  PyPI: v{initialData.pypiStats.latestVersion}
                </span>
              )}
              {initialData.rustStats?.maxVersion && (
                <span className="px-2 py-0.5 rounded bg-orange-500/15 text-orange-300 border border-orange-500/30">
                  Crates: v{initialData.rustStats.maxVersion}
                </span>
              )}
              {initialData.vscodeStats?.version && (
                <span className="px-2 py-0.5 rounded bg-indigo-500/15 text-indigo-300 border border-indigo-500/30">
                  VS Code: v{initialData.vscodeStats.version}
                </span>
              )}
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-zinc-950/70 text-zinc-400 border-b border-zinc-800">
                <tr>
                  <th className="px-4 py-2.5">Release Tag</th>
                  <th className="px-4 py-2.5">Commit</th>
                  <th className="px-4 py-2.5" title="Share of sessions across the 10 most recent releases shown">Session Share</th>
                  <th className="px-4 py-2.5">Sessions</th>
                  <th className="px-4 py-2.5">Crashes</th>
                  <th className="px-4 py-2.5">Crash-Free Rate</th>
                  <th className="px-4 py-2.5">Published</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800/60">
                {(initialData.releases || []).length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-6 text-center text-zinc-500">
                      No SDK release adoption sessions recorded yet — initialize <code className="text-zinc-300">DevPulse(&#123; release: &quot;v1.0.0&quot; &#125;)</code> to track version adoption.
                    </td>
                  </tr>
                ) : (
                  (initialData.releases || []).map((rel) => (
                    <tr key={rel.id} className="hover:bg-zinc-950/50">
                      <td className="px-4 py-2.5 font-mono font-semibold text-white">{rel.version}</td>
                      <td className="px-4 py-2.5 font-mono text-zinc-400">{rel.commitSha ? rel.commitSha.slice(0, 7) : "—"}</td>
                      <td className="px-4 py-2.5 font-mono text-zinc-300">{rel.sessionSharePct === null ? "No session data" : `${rel.sessionSharePct}%`}</td>
                      <td className="px-4 py-2.5 font-mono text-zinc-200">{rel.totalSessions.toLocaleString()}</td>
                      <td className="px-4 py-2.5 font-mono text-amber-300">{rel.crashCount}</td>
                      <td className="px-4 py-2.5 font-mono">
                        <span className={rel.crashFreeRate !== null && rel.crashFreeRate >= 99 ? "text-emerald-300" : "text-amber-300"}>
                          {rel.crashFreeRate === null ? "No session data" : `${rel.crashFreeRate}%`}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-zinc-400 font-mono">
                        {rel.releasedAt.slice(0, 10)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Active Ecosystem Cards */}
        {hasAnyPackage && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {project.npmPackage && (
              <NpmDownloadsCard
                stats={initialData.npmStats}
                packageName={project.npmPackage}
                security={initialData.packageSecurity?.[securitySummaryKey("NPM", project.npmPackage)] || null}
              />
            )}
            {project.pypiPackage && (
              <PyPiDownloadsCard
                stats={initialData.pypiStats}
                packageName={project.pypiPackage}
                security={initialData.packageSecurity?.[securitySummaryKey("PYPI", project.pypiPackage)] || null}
              />
            )}
            {project.rustCrate && (
              <RustCratesCard
                stats={initialData.rustStats}
                crateName={project.rustCrate}
                security={initialData.packageSecurity?.[securitySummaryKey("CARGO", project.rustCrate)] || null}
              />
            )}
            {project.goModule && (
              <GoModuleCard
                stats={initialData.goStats || null}
                modulePath={project.goModule}
                security={initialData.packageSecurity?.[securitySummaryKey("GO", project.goModule)] || null}
              />
            )}
            {project.dockerImage && (
              <DockerContainerCard stats={initialData.dockerStats || null} imageName={project.dockerImage} />
            )}
            {project.vscodeExtension && (
              <VsCodeStatsCard stats={initialData.vscodeStats} extensionId={project.vscodeExtension} />
            )}
            {project.mcpServerName && (
              <McpStatsCard stats={initialData.mcpStats} serverName={project.mcpServerName} projectId={project.id} />
            )}
          </div>
        )}

        {/* Additional Monorepo / Multi-Package Trackers */}
        {(initialData.extraPackages || []).length > 0 && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-bold text-white flex items-center gap-2">
                <Download className="w-4 h-4 text-indigo-400" />
                <span>Tracked Monorepo &amp; Secondary Packages</span>
              </h2>
              <span className="text-[11px] text-zinc-400">
                {(initialData.extraPackages || []).length} extra packages synced via RegistryAdapter
              </span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {(initialData.extraPackages || []).map((pkg) => (
                <div
                  key={pkg.connectorId}
                  className="p-4 rounded-2xl bg-zinc-900/90 border border-zinc-800 space-y-2.5 flex flex-col justify-between"
                >
                  <div>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded-full bg-indigo-500/15 text-indigo-300 border border-indigo-500/30">
                        {pkg.provider}
                      </span>
                      <div className="flex items-center gap-1.5">
                        {pkg.latestVersion && (
                          <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-zinc-950 border border-zinc-800 text-zinc-300">
                            v{pkg.latestVersion}
                          </span>
                        )}
                        <a
                          href={pkg.url}
                          target="_blank"
                          rel="noreferrer"
                          className="text-zinc-400 hover:text-white p-1"
                          title="Open in registry"
                        >
                          <ExternalLink className="w-3.5 h-3.5" />
                        </a>
                        {!isDemo && (
                          <button
                            type="button"
                            onClick={() => handleDeletePackageConnector(pkg.connectorId)}
                            className="p-1 text-zinc-500 hover:text-red-300"
                            title="Remove tracked package"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </div>
                    <div className="text-sm font-bold text-white font-mono mt-1.5 truncate" title={pkg.identifier}>
                      {pkg.identifier}
                    </div>
                    <div className="mt-2 flex items-baseline justify-between text-xs">
                      <span className="text-zinc-400">{pkg.metricLabel}</span>
                      <span className="font-mono font-bold text-white">
                        {pkg.metricValue !== null ? pkg.metricValue.toLocaleString() : "—"}
                      </span>
                    </div>
                    {pkg.secondaryLabel && pkg.secondaryValue && (
                      <div className="mt-1 flex items-baseline justify-between text-[11px]">
                        <span className="text-zinc-500">{pkg.secondaryLabel}</span>
                        <span className="font-mono text-zinc-300 truncate max-w-[170px]" title={pkg.secondaryValue}>
                          {pkg.secondaryValue}
                        </span>
                      </div>
                    )}
                  </div>
                  {pkg.security && (
                    <div className="pt-2 border-t border-zinc-800/70">
                      <PackageSecurityBadge summary={pkg.security} />
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 1-Click Search & Add Package / Extension / Container */}
        <div className="p-5 rounded-2xl bg-zinc-900/90 border border-zinc-800 space-y-3">
          <div>
            <h2 className="text-sm font-bold text-white flex items-center gap-2">
              <Package className="w-4 h-4 text-emerald-400" />
              <span>Search &amp; Add Package, Extension, Container or MCP Server</span>
            </h2>
            <p className="text-xs text-zinc-400 mt-0.5">
              Browse live registries (npm, PyPI, Crates.io, VS Code / Open-VSX, Docker Hub, MCP, Go) and attach in 1 click without a Git repo — supports multiple packages per project.
            </p>
          </div>
          <PackageSearchPicker
            selectedValues={{
              npmPackage: project.npmPackage,
              pypiPackage: project.pypiPackage,
              rustCrate: project.rustCrate,
              goModule: project.goModule,
              dockerImage: project.dockerImage,
            }}
            onSelectItem={async (item) => {
              if (isDemo) return;
              const res = await fetch("/api/v1/projects/connectors", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  action: "add_package_connector",
                  projectId: project.id,
                  provider: item.ecosystem,
                  identifier: item.name,
                  label: `${item.ecosystem}: ${item.name}`,
                  targetUrl: item.url,
                }),
              });
              if (res.ok) window.location.reload();
            }}
          />
        </div>

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
