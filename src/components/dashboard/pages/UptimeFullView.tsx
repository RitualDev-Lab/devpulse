"use client";

import React from "react";
import { HeartPulse, ExternalLink } from "lucide-react";
import type { LoadedWorkspaceReady } from "@/lib/dashboard/load-workspace";
import { WorkspaceShell } from "../WorkspaceShell";
import { UptimeMonitorsCard } from "../widgets/UptimeMonitorsCard";

export function UptimeFullView({ workspace }: { workspace: LoadedWorkspaceReady }) {
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
              <HeartPulse className="w-6 h-6 text-emerald-400" />
              <span>Uptime &amp; P95 Latency Monitors</span>
            </h1>
            <p className="text-xs text-zinc-400 mt-0.5">
              Edge heartbeat checks for your APIs and apps &bull; Status &amp; P95 latency feed directly onto your public status portal.
            </p>
          </div>
          {customDomain && (
            <a
              href={`https://${customDomain}`}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-xs font-semibold text-emerald-300"
            >
              <span>Open Status Portal</span>
              <ExternalLink className="w-3.5 h-3.5" />
            </a>
          )}
        </div>

        <UptimeMonitorsCard
          projectId={project.id}
          initialSummary={initialData.uptimeSummary || null}
          isDemo={isDemo}
        />
      </div>
    </WorkspaceShell>
  );
}
