"use client";

import React from "react";
import { Bug, Code2, Terminal } from "lucide-react";
import type { LoadedWorkspaceReady } from "@/lib/dashboard/load-workspace";
import { WorkspaceShell } from "../WorkspaceShell";
import { ErrorStreamCard } from "../widgets/ErrorStreamCard";
import { ReleaseHealthCard } from "../widgets/ReleaseHealthCard";
import { LanguageSdkTabs } from "../LanguageSdkTabs";
import { SmartAlertsPanel } from "../widgets/SmartAlertsPanel";

export function CrashesFullView({ workspace }: { workspace: LoadedWorkspaceReady }) {
  const { initialData, projects, customDomain, storageTier, isDemo } = workspace;
  const project = initialData.project;

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
              <Bug className="w-6 h-6 text-amber-400" />
              <span>Crash Stream, Source Maps &amp; Release Health</span>
            </h1>
            <p className="text-xs text-zinc-400 mt-0.5">
              Sentry-style issue grouping, R2 trace offload, and Base64 VLQ / Rust DWARF symbolication.
            </p>
          </div>
        </div>

        <ErrorStreamCard
          initialErrors={initialData.errors}
          projectId={project.id}
          telemetryApiKey={project.telemetryApiKey}
        />

        <div className="grid grid-cols-1 gap-5">
          <SmartAlertsPanel projectId={project.id} isDemo={isDemo} />
          <ReleaseHealthCard
            releases={initialData.releases || []}
            githubRepo={project.githubRepo}
          />
          <LanguageSdkTabs
            apiKey={project.telemetryApiKey}
            projectSlug={project.slug}
            isDemo={isDemo}
          />
        </div>

        <div className="p-5 rounded-2xl bg-zinc-900/80 border border-zinc-800 space-y-3">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div>
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <Code2 className="w-4 h-4 text-cyan-400" />
                <span>Uploaded Source Maps &amp; Rust DWARF Artifacts ({(initialData.sourceMaps || []).length})</span>
              </h3>
              <p className="text-xs text-zinc-400">
                Upload <code className="text-zinc-200">.map</code> or <code className="text-zinc-200">.dwarf.json</code> files from CI so minified stack frames decode back to exact TypeScript or Rust lines.
              </p>
            </div>
          </div>
          <div className="p-3 rounded-xl bg-zinc-950 border border-zinc-800 font-mono text-xs text-cyan-300 flex items-center gap-2 overflow-x-auto">
            <Terminal className="w-4 h-4 shrink-0 text-zinc-500" />
            <code>
              npx @ritualdev/pulse upload-sourcemaps --key {project.telemetryApiKey} --release v1.0.0 --dir ./dist
            </code>
          </div>
          {(initialData.sourceMaps || []).length > 0 && (
            <div className="overflow-x-auto rounded-xl border border-zinc-800">
              <table className="w-full text-left text-xs">
                <thead className="bg-zinc-950 text-zinc-400 border-b border-zinc-800">
                  <tr>
                    <th className="px-3 py-2">Release</th>
                    <th className="px-3 py-2">Map File</th>
                    <th className="px-3 py-2">Size</th>
                    <th className="px-3 py-2">Uploaded</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800/60 bg-zinc-950/40">
                  {(initialData.sourceMaps || []).map((sm) => (
                    <tr key={sm.id}>
                      <td className="px-3 py-2 font-mono text-emerald-300">{sm.version}</td>
                      <td className="px-3 py-2 font-mono text-zinc-200">{sm.filePath}</td>
                      <td className="px-3 py-2 font-mono text-zinc-400">{Math.round(sm.sizeBytes / 1024)} KB</td>
                      <td className="px-3 py-2 text-zinc-500">{new Date(sm.createdAt).toLocaleDateString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </WorkspaceShell>
  );
}
