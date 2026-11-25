"use client";

import React, { useState } from "react";
import {
  Settings,
  Bell,
  Shield,
  Globe,
  HardDrive,
  Palette,
  Plug,
} from "lucide-react";
import type { LoadedWorkspaceReady } from "@/lib/dashboard/load-workspace";
import { WorkspaceShell } from "../WorkspaceShell";
import { QuickConnectPanel } from "../QuickConnectPanel";
import { AlertSettingsModal } from "../AlertSettingsModal";
import { SecurityModal } from "../SecurityModal";
import { DomainSettingsModal } from "../DomainSettingsModal";
import { StorageSettingsModal } from "../StorageSettingsModal";
import { CustomCssModal } from "../CustomCssModal";
import { IntegrationsModal } from "../IntegrationsModal";

export function SettingsFullView({ workspace }: { workspace: LoadedWorkspaceReady }) {
  const { initialData, projects, customDomain, storageTier, accessRole, isDemo } = workspace;
  const project = initialData.project;

  const [openModal, setOpenModal] = useState<
    "alerts" | "security" | "domains" | "storage" | "styling" | "integrations" | null
  >(null);

  const cards = [
    {
      id: "alerts" as const,
      title: "Alerts & Weekly Digest",
      desc: "Discord, Slack, Telegram, PagerDuty & Resend/Postmark email alerts",
      icon: Bell,
      accent: "text-red-400 bg-red-500/10 border-red-500/20",
    },
    {
      id: "security" as const,
      title: "Security, Keys & RBAC",
      desc: "SHA-256 telemetry keys, Organization Owners/Maintainers & Audit Log",
      icon: Shield,
      accent: "text-amber-400 bg-amber-500/10 border-amber-500/20",
    },
    {
      id: "domains" as const,
      title: "Public Portal & Domain",
      desc: "Free *.devpulse.ritualdev.in handle, custom SSL domain & white-label",
      icon: Globe,
      accent: "text-cyan-400 bg-cyan-500/10 border-cyan-500/20",
    },
    {
      id: "storage" as const,
      title: "Cloudflare R2 & BYOS",
      desc: "Storage quota monitor & Bring-Your-Own S3 / R2 bucket settings",
      icon: HardDrive,
      accent: "text-purple-400 bg-purple-500/10 border-purple-500/20",
    },
    {
      id: "styling" as const,
      title: "Theme & Scoped Custom CSS",
      desc: "Preset visual themes & safe scoped custom CSS rules",
      icon: Palette,
      accent: "text-pink-400 bg-pink-500/10 border-pink-500/20",
    },
    {
      id: "integrations" as const,
      title: "Manual Package Identifiers",
      desc: "Fine-tune raw repo/npm/PyPI/Crates/Go/Docker/VS Code/MCP slugs",
      icon: Plug,
      accent: "text-indigo-400 bg-indigo-500/10 border-indigo-500/20",
    },
  ];

  return (
    <WorkspaceShell
      currentProject={{ ...project, telemetryApiKey: project.telemetryApiKey }}
      projects={projects}
      storageTier={storageTier}
      customDomain={customDomain}
      isDemo={isDemo}
    >
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-extrabold text-white flex items-center gap-2.5">
            <Settings className="w-6 h-6 text-indigo-400" />
            <span>Workspace Settings &amp; Quick Connect</span>
          </h1>
          <p className="text-xs text-zinc-400 mt-0.5">
            Configure pasted link auto-detection, Role-Aware stack presets, alerts, security, domains, and themes cleanly in one place.
          </p>
        </div>

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

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {cards.map((c) => {
            const Icon = c.icon;
            return (
              <button
                key={c.id}
                type="button"
                onClick={() => setOpenModal(c.id)}
                className="p-4 rounded-2xl bg-zinc-900/90 border border-zinc-800 hover:border-zinc-700 text-left transition flex items-start gap-3 group"
              >
                <div className={`w-10 h-10 rounded-xl border flex items-center justify-center shrink-0 ${c.accent}`}>
                  <Icon className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-white group-hover:text-indigo-300 transition">
                    {c.title}
                  </h3>
                  <p className="text-xs text-zinc-400 mt-1 leading-relaxed">{c.desc}</p>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      <AlertSettingsModal
        isOpen={openModal === "alerts"}
        onClose={() => setOpenModal(null)}
        projectId={project.id}
        initialDiscord={project.discordWebhookUrl}
        initialSlack={project.slackWebhookUrl}
        initialTelegramToken={project.telegramBotToken}
        initialTelegramChatId={project.telegramChatId}
        initialGenericWebhook={project.genericWebhookUrl}
        initialPagerDuty={project.pagerdutyRoutingKey}
        initialNotificationEmail={project.notificationEmail}
        initialEmailProvider={project.emailProvider}
        initialHasEmailApiKey={project.hasEmailApiKey}
        initialDigestEnabled={project.digestEnabled}
      />

      <SecurityModal
        isOpen={openModal === "security"}
        onClose={() => setOpenModal(null)}
        projectId={project.id}
        projectName={project.name}
        accessRole={accessRole}
        isDemo={isDemo}
      />

      <DomainSettingsModal
        isOpen={openModal === "domains"}
        onClose={() => setOpenModal(null)}
        storageTier={storageTier}
        isDemo={isDemo}
      />

      <StorageSettingsModal
        isOpen={openModal === "storage"}
        onClose={() => setOpenModal(null)}
        initialTier={storageTier}
        isDemo={isDemo}
      />

      <CustomCssModal
        isOpen={openModal === "styling"}
        onClose={() => setOpenModal(null)}
        projectId={project.id}
        currentTheme={project.theme || "dark"}
        customCss={project.customCss || ""}
        isDemo={isDemo}
        onApplyTheme={() => window.location.reload()}
        onSaveCustomCss={() => window.location.reload()}
      />

      <IntegrationsModal
        isOpen={openModal === "integrations"}
        onClose={() => setOpenModal(null)}
        projectId={project.id}
        initialGithub={project.githubRepo}
        initialNpm={project.npmPackage}
        initialPypi={project.pypiPackage}
        initialRustCrate={project.rustCrate}
        initialGoModule={project.goModule}
        initialDockerImage={project.dockerImage}
        initialVsCode={project.vscodeExtension}
        initialMcp={project.mcpServerName}
      />
    </WorkspaceShell>
  );
}
