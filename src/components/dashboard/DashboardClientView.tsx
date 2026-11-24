"use client";

import React, { useState, useEffect } from "react";
import { DashboardHeader } from "./DashboardHeader";
import { DragDropGrid, type DashboardData } from "./DragDropGrid";
import { CustomCssModal } from "./CustomCssModal";
import { AlertSettingsModal } from "./AlertSettingsModal";
import { IntegrationsModal } from "./IntegrationsModal";
import { StorageSettingsModal } from "./StorageSettingsModal";
import type { ProjectSummary } from "./ProjectWorkspaceSwitcher";
import {
  normalizeThemeId,
  getPresetThemeCss,
  scopeCustomCss,
} from "@/lib/layout/css-scoper";

interface DashboardClientViewProps {
  initialData: DashboardData;
  projects?: ProjectSummary[];
  customDomain?: string | null;
  storageTier: string;
  isDemo?: boolean;
}

export function DashboardClientView({
  initialData,
  projects = [],
  customDomain,
  storageTier,
  isDemo = false,
}: DashboardClientViewProps) {
  const [data] = useState<DashboardData>(initialData);
  const [isCustomizing, setIsCustomizing] = useState(false);
  const [isStylingOpen, setIsStylingOpen] = useState(false);
  const [isAlertsOpen, setIsAlertsOpen] = useState(false);
  const [isIntegrationsOpen, setIsIntegrationsOpen] = useState(false);
  const [isStorageOpen, setIsStorageOpen] = useState(false);
  const [currentTheme, setCurrentTheme] = useState(() =>
    normalizeThemeId(initialData.project.theme)
  );
  const [customCss, setCustomCss] = useState(() => initialData.project.customCss || "");

  // In demo mode, restore persisted theme/CSS from localStorage if customized locally
  useEffect(() => {
    if (!isDemo) return;
    try {
      const savedTheme = localStorage.getItem(`devpulse_theme_${data.project.id}`);
      const savedCss = localStorage.getItem(`devpulse_css_${data.project.id}`);
      if (savedTheme) setCurrentTheme(normalizeThemeId(savedTheme));
      if (savedCss !== null) setCustomCss(savedCss);
    } catch {
      // ignore
    }
  }, [data.project.id, isDemo]);

  const handleResetLayout = async () => {
    try {
      localStorage.removeItem(`devpulse_layout_${data.project.id}`);
      localStorage.removeItem(`devpulse_colspans_${data.project.id}`);
      localStorage.removeItem(`devpulse_2d_layout_${data.project.id}`);
      if (!isDemo) {
        await fetch(`/api/v1/projects/layout?projectId=${encodeURIComponent(data.project.id)}`, {
          method: "DELETE",
        });
      }
      window.location.reload();
    } catch {
      window.location.reload();
    }
  };

  const currentProjectSummary: ProjectSummary = {
    id: data.project.id,
    name: data.project.name,
    slug: data.project.slug,
    githubRepo: data.project.githubRepo,
    npmPackage: data.project.npmPackage,
    pypiPackage: data.project.pypiPackage,
    rustCrate: data.project.rustCrate,
    goModule: data.project.goModule,
    dockerImage: data.project.dockerImage,
    telemetryApiKey: data.project.telemetryApiKey,
  };

  const activeThemeId = normalizeThemeId(currentTheme);
  const combinedDynamicCss = [
    getPresetThemeCss(activeThemeId),
    scopeCustomCss(customCss, ".devpulse-workspace"),
  ]
    .filter(Boolean)
    .join("\n");

  return (
    <div
      data-theme={activeThemeId}
      className="devpulse-shell min-h-screen bg-zinc-950 text-zinc-100 flex flex-col selection:bg-indigo-500/30 selection:text-white transition-colors duration-300"
    >
      {/* Dynamic Preset Theme + Scoped Custom CSS injection */}
      {combinedDynamicCss && <style dangerouslySetInnerHTML={{ __html: combinedDynamicCss }} />}

      {/* Top Navbar (protected outside .devpulse-workspace) */}
      <DashboardHeader
        currentProject={currentProjectSummary}
        projects={projects.length > 0 ? projects : [currentProjectSummary]}
        isCustomizing={isCustomizing}
        onToggleCustomizing={() => setIsCustomizing((prev) => !prev)}
        onOpenStyling={() => setIsStylingOpen(true)}
        onOpenAlerts={() => setIsAlertsOpen(true)}
        onOpenIntegrations={() => setIsIntegrationsOpen(true)}
        onOpenStorage={() => setIsStorageOpen(true)}
        customDomain={customDomain}
        storageTier={storageTier}
        onResetLayout={handleResetLayout}
        isDemo={isDemo}
      />

      {/* Scoped Workspace Canvas */}
      <main className="devpulse-workspace flex-1 max-w-7xl mx-auto w-full px-4 sm:px-6 py-6 sm:py-8 space-y-6">
        {/* Customization Alert Banner */}
        {isCustomizing && (
          <div className="p-4 rounded-2xl bg-indigo-950/40 border border-indigo-500/40 text-indigo-200 text-xs flex flex-wrap items-center justify-between gap-2 shadow-lg shadow-indigo-950/40">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-indigo-400 animate-ping"></span>
              <span className="font-semibold text-white">2D Grid Customization Active:</span>
              <span>
                Drag cards anywhere on the 12-column matrix, use corner resize handles or size pills (1x1..4x2), or hide widgets.
              </span>
            </div>
            <button
              onClick={() => setIsCustomizing(false)}
              className="px-3 py-1 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-medium transition"
            >
              Done Customizing
            </button>
          </div>
        )}

        {/* True 2D Drag & Drop + Resizable Card Matrix */}
        <DragDropGrid data={data} isCustomizing={isCustomizing} isDemo={isDemo} />
      </main>

      {/* Footer */}
      <footer className="border-t border-zinc-900 bg-zinc-950 py-6 px-4 sm:px-6 text-center text-xs text-zinc-500">
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-zinc-300">DevPulse</span>
            <span>&bull;</span>
            <span>Open Source Developer Command Center</span>
          </div>
          <div className="flex items-center gap-4 text-zinc-400">
            <a
              href="https://github.com/ritualdev-lab"
              target="_blank"
              rel="noreferrer"
              className="hover:text-white transition"
            >
              ritualdev-lab
            </a>
            <span>&bull;</span>
            <span>100% Free & Open</span>
          </div>
        </div>
      </footer>

      {/* Preset Theme Switcher & Live Scoped Custom CSS Modal */}
      <CustomCssModal
        isOpen={isStylingOpen}
        onClose={() => setIsStylingOpen(false)}
        projectId={data.project.id}
        currentTheme={activeThemeId}
        onApplyTheme={(theme) => setCurrentTheme(theme)}
        customCss={customCss}
        onSaveCustomCss={(css) => setCustomCss(css)}
        isDemo={isDemo}
      />

      {/* Webhook & Instant Crash Alerts Modal */}
      <AlertSettingsModal
        isOpen={isAlertsOpen}
        onClose={() => setIsAlertsOpen(false)}
        projectId={data.project.id}
        initialDiscord={data.project.discordWebhookUrl}
        initialSlack={data.project.slackWebhookUrl}
        initialTelegramToken={data.project.telegramBotToken}
        initialTelegramChatId={data.project.telegramChatId}
        initialGenericWebhook={data.project.genericWebhookUrl}
      />

      {/* Cloudflare R2 & BYOS Storage Settings Modal */}
      <StorageSettingsModal
        isOpen={isStorageOpen}
        onClose={() => setIsStorageOpen(false)}
        initialTier={storageTier}
        isDemo={isDemo}
      />

      {/* Package Ecosystems & Connect Data Modal */}
      <IntegrationsModal
        isOpen={isIntegrationsOpen}
        onClose={() => setIsIntegrationsOpen(false)}
        projectId={data.project.id}
        initialGithub={data.project.githubRepo}
        initialNpm={data.project.npmPackage}
        initialPypi={data.project.pypiPackage}
        initialRustCrate={data.project.rustCrate}
        initialGoModule={data.project.goModule}
        initialDockerImage={data.project.dockerImage}
        initialVsCode={data.project.vscodeExtension}
        initialMcp={data.project.mcpServerName}
      />
    </div>
  );
}
