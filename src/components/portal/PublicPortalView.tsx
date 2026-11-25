"use client";

import React from "react";
import { DragDropGrid, type DashboardData } from "@/components/dashboard/DragDropGrid";
import { Activity, Bug, Globe, ShieldCheck } from "lucide-react";
import {
  normalizeThemeId,
  getPresetThemeCss,
  scopeCustomCss,
} from "@/lib/layout/css-scoper";

interface PublicPortalViewProps {
  portalHost: string;
  user: {
    githubUsername: string;
    name: string | null;
    avatarUrl: string | null;
    subdomain: string;
    customDomain: string | null;
    brandTitle: string | null;
    brandDescription: string | null;
    brandFaviconUrl: string | null;
    isWhiteLabeled: boolean;
  };
  projects: Array<{
    id: string;
    name: string;
    slug: string;
    description: string | null;
  }>;
  dashboardData: DashboardData | null;
}

export function PublicPortalView({
  portalHost,
  user,
  projects,
  dashboardData,
}: PublicPortalViewProps) {
  const activeProject = dashboardData?.project;
  const activeTheme = normalizeThemeId(activeProject?.theme);
  const dynamicCss = [
    getPresetThemeCss(activeTheme),
    scopeCustomCss(activeProject?.customCss || "", ".devpulse-workspace"),
  ]
    .filter(Boolean)
    .join("\n");

  const displayBrandName =
    user.brandTitle || user.name || user.githubUsername;
  const displayDesc =
    user.brandDescription ||
    activeProject?.name
      ? `${user.brandDescription || "Live package telemetry, ecosystem downloads, and operational health."}`
      : "Public Maintainer Telemetry Portal";

  return (
    <div
      data-theme={activeTheme}
      className="devpulse-shell min-h-screen bg-zinc-950 text-zinc-100 flex flex-col transition-colors duration-300"
    >
      {dynamicCss && <style dangerouslySetInnerHTML={{ __html: dynamicCss }} />}

      {/* Branded Public Header */}
      <header className="w-full border-b border-zinc-800/80 bg-zinc-950/75 backdrop-blur-xl sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3.5 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            {user.brandFaviconUrl || user.avatarUrl ? (
              <img
                src={user.brandFaviconUrl || user.avatarUrl || ""}
                alt={displayBrandName}
                className="w-9 h-9 rounded-xl border border-zinc-800 object-cover"
              />
            ) : (
              <div className="w-9 h-9 rounded-xl bg-indigo-600/20 border border-indigo-500/40 flex items-center justify-center text-indigo-400">
                <Activity className="w-4 h-4" />
              </div>
            )}

            <div>
              <div className="flex items-center gap-2">
                <h1 className="font-bold text-white text-base tracking-tight">
                  {displayBrandName}
                </h1>
                <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/25 font-medium">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                  Live Telemetry
                </span>
              </div>
              <p className="text-xs text-zinc-400 flex items-center gap-1.5">
                <Globe className="w-3 h-3 text-zinc-500" />
                <span className="font-mono">{portalHost}</span>
              </p>
            </div>
          </div>

          <div className="flex items-center flex-wrap gap-2">
            {/* Public Project Switcher */}
            {projects.length > 1 && (
              <div className="flex items-center gap-1 bg-zinc-900 p-1 rounded-xl border border-zinc-800">
                {projects.map((p) => {
                  const isCurrent = activeProject?.id === p.id;
                  return (
                    <a
                      key={p.id}
                      href={`?project=${encodeURIComponent(p.slug)}`}
                      className={`px-3 py-1 rounded-lg text-xs font-medium transition ${
                        isCurrent
                          ? "bg-indigo-600 text-white shadow-sm"
                          : "text-zinc-400 hover:text-zinc-200"
                      }`}
                    >
                      {p.name}
                    </a>
                  );
                })}
              </div>
            )}

            {activeProject && (
              <a
                href={`https://devpulse.ritualdev.in/report/${activeProject.slug}`}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-xs font-medium text-zinc-200 transition"
              >
                <Bug className="w-3.5 h-3.5 text-amber-400" />
                <span>Report Issue</span>
              </a>
            )}
          </div>
        </div>
      </header>

      {/* Main Scoped Portal Grid */}
      <main className="devpulse-workspace flex-1 max-w-7xl mx-auto w-full px-4 sm:px-6 py-6 sm:py-8 space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-2 border-b border-zinc-800/50">
          <div>
            <h2 className="text-xl font-bold text-white">
              {activeProject ? activeProject.name : displayBrandName}
            </h2>
            <p className="text-xs text-zinc-400 mt-0.5">{displayDesc}</p>
          </div>
          <div className="flex items-center gap-1.5 text-[11px] text-zinc-400">
            <ShieldCheck className="w-4 h-4 text-emerald-400" />
            <span>Verified Public Registry Metrics</span>
          </div>
        </div>

        {dashboardData ? (
          <DragDropGrid
            data={dashboardData}
            isCustomizing={false}
            isDemo={true}
            isPublicPortal={true}
          />
        ) : (
          <div className="p-12 rounded-2xl bg-zinc-900/80 border border-zinc-800 text-center text-zinc-400 text-sm">
            No public projects published yet for <strong>@{user.githubUsername}</strong>.
          </div>
        )}
      </main>

      {/* White-Label Aware Footer */}
      <footer className="border-t border-zinc-900 bg-zinc-950 py-6 px-4 sm:px-6 text-xs text-zinc-500">
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-zinc-300">{displayBrandName}</span>
            <span>&bull;</span>
            <span>Public Status &amp; Telemetry</span>
          </div>

          {!user.isWhiteLabeled ? (
            <a
              href="https://devpulse.ritualdev.in/#pricing"
              target="_blank"
              rel="noreferrer"
              className="text-zinc-400 hover:text-white transition"
            >
              Powered by <span className="font-semibold text-indigo-400">DevPulse</span> &mdash; Claim your free telemetry subdomain
            </a>
          ) : (
            <span className="text-zinc-500 font-mono text-[11px]">{portalHost}</span>
          )}
        </div>
      </footer>
    </div>
  );
}
