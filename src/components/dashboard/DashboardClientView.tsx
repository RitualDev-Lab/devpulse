"use client";

import React, { useState } from "react";
import { DashboardHeader } from "./DashboardHeader";
import { DragDropGrid, type DashboardData } from "./DragDropGrid";
import { CustomCssModal } from "./CustomCssModal";
import { AlertSettingsModal } from "./AlertSettingsModal";
import { IntegrationsModal } from "./IntegrationsModal";
import { DomainsStorageModal } from "./DomainsStorageModal";
import { ShareEmbedModal } from "./ShareEmbedModal";
import { BillingModal } from "./BillingModal";
import type { ProjectSummary } from "./ProjectWorkspaceSwitcher";
import { buildThemeCss, getThemePreset, scopeCustomCss } from "@/lib/styling/themes";

interface DashboardClientViewProps {
  initialData: DashboardData;
  projects?: ProjectSummary[];
  subdomain?: string | null;
  customDomain?: string | null;
  storageTier: string;
  extraCustomDomains?: number;
  isDemo?: boolean;
}

export function DashboardClientView({
  initialData,
  projects = [],
  subdomain,
  customDomain,
  storageTier,
  extraCustomDomains = 0,
  isDemo = false,
}: DashboardClientViewProps) {
  const [data] = useState<DashboardData>(initialData);
  const [isCustomizing, setIsCustomizing] = useState(false);
  const [isStylingOpen, setIsStylingOpen] = useState(false);
  const [isAlertsOpen, setIsAlertsOpen] = useState(false);
  const [isIntegrationsOpen, setIsIntegrationsOpen] = useState(false);
  const [isDomainsOpen, setIsDomainsOpen] = useState(false);
  const [isShareOpen, setIsShareOpen] = useState(false);
  const [isBillingOpen, setIsBillingOpen] = useState(false);

  const [currentTheme, setCurrentTheme] = useState(initialData.project.theme || "dark");
  const [customCss, setCustomCss] = useState(initialData.project.customCss || "");
  const [isPublic, setIsPublic] = useState(initialData.project.isPublic ?? true);

  const handleResetLayout = async () => {
    try {
      localStorage.removeItem(`devpulse_layout_${data.project.id}`);
      localStorage.removeItem(`devpulse_layout_v2_${data.project.id}`);
      if (!isDemo) {
        await fetch("/api/v1/projects/layout", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ projectId: data.project.id, widgets: [] }),
        });
      }
      window.location.reload();
    } catch {
      // ignore
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
    telemetryApiKey: data.project.telemetryApiKey || "",
  };

  const themePreset = getThemePreset(currentTheme);
  const themeVarsCss = buildThemeCss(currentTheme);
  const scopedCss = customCss ? scopeCustomCss(customCss) : "";

  return (
    <div
      data-theme={themePreset.id}
      className={`devpulse-dashboard min-h-screen ${themePreset.wrapperClass} flex flex-col selection:bg-indigo-500/30 selection:text-white`}
    >
      {/* Scoped Theme Variables + Custom CSS overrides */}
      <style dangerouslySetInnerHTML={{ __html: `${themeVarsCss}\n${scopedCss}` }} />

      {/* Top Navbar */}
      <DashboardHeader
        currentProject={currentProjectSummary}
        projects={projects.length > 0 ? projects : [currentProjectSummary]}
        isCustomizing={isCustomizing}
        onToggleCustomizing={() => setIsCustomizing((prev) => !prev)}
        onOpenStyling={() => setIsStylingOpen(true)}
        onOpenAlerts={() => setIsAlertsOpen(true)}
        onOpenIntegrations={() => setIsIntegrationsOpen(true)}
        onOpenDomains={() => setIsDomainsOpen(true)}
        onOpenShare={() => setIsShareOpen(true)}
        onOpenBilling={() => setIsBillingOpen(true)}
        subdomain={subdomain}
        customDomain={customDomain}
        storageTier={storageTier}
        onResetLayout={handleResetLayout}
        isDemo={isDemo}
      />

      {/* Main Content Area */}
      <main className="flex-1 max-w-7xl mx-auto w-full px-4 sm:px-6 py-6 sm:py-8 space-y-6">
        {isCustomizing && (
          <div className="p-4 rounded-2xl bg-indigo-950/40 border border-indigo-500/40 text-indigo-200 text-xs flex flex-wrap items-center justify-between gap-2 shadow-lg shadow-indigo-950/40">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-indigo-400 animate-ping" />
              <span className="font-semibold text-white">2D Customization Mode Active:</span>
              <span>
                Drag cards to reorder, drag the bottom-right corner handle to resize in 2D, or toggle visibility.
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

        {/* True 2D Draggable & Resizable Card Grid */}
        <DragDropGrid data={data} isCustomizing={isCustomizing} isDemo={isDemo} />
      </main>

      {/* Footer */}
      <footer className="border-t border-zinc-900 bg-zinc-950 py-6 px-4 sm:px-6 text-center text-xs text-zinc-500">
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-zinc-300">DevPulse</span>
            <span>&bull;</span>
            <span>Multi-Tenant Developer Telemetry Headquarters</span>
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
            <a href={`/p/${data.project.slug}`} className="hover:text-white transition">
              Public Dashboard
            </a>
          </div>
        </div>
      </footer>

      {/* Custom Theme & Scoped CSS Modal */}
      <CustomCssModal
        isOpen={isStylingOpen}
        onClose={() => setIsStylingOpen(false)}
        projectId={data.project.id}
        currentTheme={currentTheme}
        customCss={customCss}
        isPublic={isPublic}
        isDemo={isDemo}
        onSaved={(next) => {
          setCurrentTheme(next.theme);
          setCustomCss(next.customCss);
          setIsPublic(next.isPublic);
        }}
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

      {/* Subdomain, Custom Domains & R2 Storage Quotas Modal */}
      <DomainsStorageModal
        isOpen={isDomainsOpen}
        onClose={() => setIsDomainsOpen(false)}
        projectId={data.project.id}
        initialSubdomain={subdomain}
        onOpenBilling={() => setIsBillingOpen(true)}
      />

      {/* Share Public Link, SVG Badges & Iframe Embeds Modal */}
      <ShareEmbedModal
        isOpen={isShareOpen}
        onClose={() => setIsShareOpen(false)}
        projectName={data.project.name}
        projectSlug={data.project.slug}
        subdomain={subdomain}
        customDomain={customDomain}
        isPublic={isPublic}
      />

      {/* Dodo Payments Plans & Billing Upgrade Modal */}
      <BillingModal
        isOpen={isBillingOpen}
        onClose={() => setIsBillingOpen(false)}
        currentTier={storageTier}
        extraCustomDomains={extraCustomDomains}
      />
    </div>
  );
}
