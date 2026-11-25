"use client";

import React from "react";
import { Package, Download, KeyRound } from "lucide-react";
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
