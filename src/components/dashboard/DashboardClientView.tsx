"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Sliders, RefreshCw } from "lucide-react";
import { WorkspaceShell } from "./WorkspaceShell";
import { getProjectStorageKey } from "@/lib/storage-keys";
import { useWorkspaceData } from "./WorkspaceCacheContext";
import { DragDropGrid, type DashboardData } from "./DragDropGrid";
import { SnapshotSyncBar } from "./SnapshotSyncBar";
import { AlertSettingsModal } from "./AlertSettingsModal";
import { IntegrationsModal } from "./IntegrationsModal";
import { StorageSettingsModal } from "./StorageSettingsModal";
import { DomainSettingsModal } from "./DomainSettingsModal";
import { BillingModal } from "./BillingModal";
import { SecurityModal } from "./SecurityModal";
import type { ProjectSummary } from "./ProjectWorkspaceSwitcher";

interface DashboardClientViewProps {
  initialData: DashboardData;
  projects?: ProjectSummary[];
  customDomain?: string | null;
  storageTier: string;
  accessRole?: import("@/lib/security/rbac").OrgRole;
  isDemo?: boolean;
}

export function DashboardClientView({
  initialData,
  projects = [],
  customDomain,
  storageTier,
  accessRole = "owner",
  isDemo = false,
}: DashboardClientViewProps) {
  const router = useRouter();
  const data = useWorkspaceData(initialData);
  const [isCustomizing, setIsCustomizing] = useState(false);
  const [isAlertsOpen, setIsAlertsOpen] = useState(false);
  const [isIntegrationsOpen, setIsIntegrationsOpen] = useState(false);
  const [isStorageOpen, setIsStorageOpen] = useState(false);
  const [isDomainsOpen, setIsDomainsOpen] = useState(false);
  const [isBillingOpen, setIsBillingOpen] = useState(false);
  const [isSecurityOpen, setIsSecurityOpen] = useState(false);
  const [billingSuccessBanner, setBillingSuccessBanner] = useState(false);

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      try {
        const params = new URLSearchParams(window.location.search);
        if (params.get("billing") === "success") {
          setBillingSuccessBanner(true);
        }
        const upgradeParam = params.get("upgrade");
        if (upgradeParam === "pro" || upgradeParam === "team" || upgradeParam === "extra_domain" || upgradeParam === "extra_storage") {
          setIsBillingOpen(true);
        }
        const landedKey = `dp_landed_${data.project.id}`;
        if (!sessionStorage.getItem(landedKey)) {
          sessionStorage.setItem(landedKey, "1");
          const savedTab = localStorage.getItem(getProjectStorageKey("default_tab", data.project.id, isDemo));
          if (savedTab && savedTab !== "/dashboard" && savedTab.startsWith("/dashboard/")) {
            const qs = new URLSearchParams(window.location.search);
            router.replace(`${savedTab}${qs.toString() ? `?${qs.toString()}` : ""}`);
          }
        }
      } catch {
        // ignore
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [data.project.id, isDemo, router]);

  const handleResetLayout = async () => {
    try {
      localStorage.removeItem(getProjectStorageKey("layout", data.project.id, isDemo));
      localStorage.removeItem(getProjectStorageKey("colspans", data.project.id, isDemo));
      localStorage.removeItem(getProjectStorageKey("2d_layout", data.project.id, isDemo));
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
    theme: data.project.theme,
    customCss: data.project.customCss,
  };

  const overviewToolbar = (
    <div className="flex items-center gap-1.5 text-xs">
      <button
        type="button"
        onClick={() => setIsCustomizing((prev) => !prev)}
        className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg font-medium border transition ${
          isCustomizing
            ? "bg-indigo-600 text-white border-indigo-500"
            : "bg-zinc-900 hover:bg-zinc-800 text-zinc-200 border-zinc-800"
        }`}
      >
        <Sliders className="w-3.5 h-3.5" />
        <span className="hidden sm:inline">{isCustomizing ? "Done" : "Customize"}</span>
      </button>
      {isCustomizing && (
        <button
          type="button"
          onClick={handleResetLayout}
          title="Reset Grid Layout"
          className="p-1.5 rounded-lg bg-zinc-900 hover:bg-zinc-800 text-zinc-300 border border-zinc-800"
        >
          <RefreshCw className="w-3.5 h-3.5" />
        </button>
      )}
    </div>
  );

  return (
    <div className="text-zinc-100 transition-colors duration-300">
      <WorkspaceShell
        currentProject={{
          ...currentProjectSummary,
          stackPreset: (data.project as any).stackPreset,
          hasNpmToken: (data.project as any).hasNpmToken,
          hasGithubToken: (data.project as any).hasGithubToken,
        }}
        projects={projects.length > 0 ? projects : [currentProjectSummary]}
        storageTier={storageTier}
        customDomain={customDomain}
        isDemo={isDemo}
        rightActions={overviewToolbar}
      >
        <div className="space-y-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h1 className="text-xl sm:text-2xl font-extrabold text-white tracking-tight">
                {data.project.name} Overview
              </h1>
              <p className="text-xs text-zinc-400">
                Modular 2D workspace &bull; Use the Left Sidebar for full-page GitHub PRs, Packages, Daily Users, Crashes &amp; Revenue
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <SnapshotSyncBar
                projectId={data.project.id}
                snapshotUpdatedAt={data.snapshotUpdatedAt}
                isDemo={isDemo}
              />
              <Link
                href={isDemo ? "/dashboard/github?demo=1" : `/dashboard/github?project=${encodeURIComponent(data.project.slug)}`}
                className="px-3 py-1.5 rounded-xl bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-zinc-200 font-medium transition"
              >
                Git &amp; PRs &rarr;
              </Link>
              <Link
                href={isDemo ? "/dashboard/revenue?demo=1" : `/dashboard/revenue?project=${encodeURIComponent(data.project.slug)}`}
                className="px-3 py-1.5 rounded-xl bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/30 text-emerald-300 font-medium transition"
              >
                Revenue &amp; Add Payment &rarr;
              </Link>
            </div>
          </div>

          {billingSuccessBanner && (
            <div className="p-4 rounded-2xl bg-emerald-950/50 border border-emerald-500/40 text-emerald-200 text-xs flex items-center justify-between gap-2 shadow-lg">
              <span>
                Dodo Payments checkout completed! Your DevPulse subscription quotas and custom domain entitlements sync automatically.
              </span>
              <button
                onClick={() => setBillingSuccessBanner(false)}
                className="px-3 py-1 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-medium transition"
              >
                Dismiss
              </button>
            </div>
          )}

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

          <DragDropGrid data={data} isCustomizing={isCustomizing} isDemo={isDemo} />
        </div>
      </WorkspaceShell>

      {/* Webhook & Instant Crash Alerts Modal */}
      <AlertSettingsModal
        isOpen={isAlertsOpen}
        onClose={() => setIsAlertsOpen(false)}
        projectId={data.project.id}
        initialHasDiscord={Boolean(data.project.hasDiscordWebhook)}
        initialHasSlack={Boolean(data.project.hasSlackWebhook)}
        initialHasTelegram={Boolean(data.project.hasTelegramWebhook)}
        initialHasGeneric={Boolean(data.project.hasGenericWebhook)}
        initialHasPagerDuty={Boolean(data.project.hasPagerDuty)}
        initialHasOpsgenie={Boolean(data.project.hasOpsgenieApiKey)}
        initialHasTeams={Boolean(data.project.hasTeamsWebhook)}
        initialHasNotificationEmail={Boolean(data.project.hasNotificationEmail)}
        initialEmailProvider={data.project.emailProvider}
        initialHasEmailApiKey={data.project.hasEmailApiKey}
        initialDigestEnabled={data.project.digestEnabled}
      />

      {/* Billing, Quotas, Add-Ons & Invoices Modal */}
      <BillingModal
        isOpen={isBillingOpen}
        onClose={() => setIsBillingOpen(false)}
        storageTier={storageTier}
        isDemo={isDemo}
      />

      {/* Enterprise Security: SHA-256 Keys, RBAC Orgs & Immutable Audit Log */}
      <SecurityModal
        isOpen={isSecurityOpen}
        onClose={() => setIsSecurityOpen(false)}
        projectId={data.project.id}
        projectName={data.project.name}
        accessRole={accessRole}
        isDemo={isDemo}
      />

      {/* Cloudflare R2 & BYOS Storage Settings Modal */}
      <StorageSettingsModal
        isOpen={isStorageOpen}
        onClose={() => setIsStorageOpen(false)}
        initialTier={storageTier}
        isDemo={isDemo}
      />

      {/* Subdomain, Custom Domain & White-Labeling Modal */}
      <DomainSettingsModal
        isOpen={isDomainsOpen}
        onClose={() => setIsDomainsOpen(false)}
        storageTier={storageTier}
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
        initialMcpAllowedTools={data.project.mcpAllowedTools}
        canManageMcpPolicy={accessRole === "owner" || accessRole === "admin"}
      />
    </div>
  );
}
