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
  FileDown,
  Code2,
  Copy,
  Check,
  ExternalLink,
  KeyRound,
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
import { SsoScimModal } from "../SsoScimModal";

export function SettingsFullView({ workspace }: { workspace: LoadedWorkspaceReady }) {
  const { initialData, projects, customDomain, storageTier, accessRole, isDemo } = workspace;
  const project = initialData.project;

  const [openModal, setOpenModal] = useState<
    "alerts" | "security" | "sso" | "domains" | "storage" | "styling" | "integrations" | null
  >(null);
  const [copiedEmbed, setCopiedEmbed] = useState<string | null>(null);

  const iframeSnippet = `<iframe src="https://devpulse.ritualdev.in/embed/${project.slug}" width="100%" height="220" frameborder="0" style="border-radius:16px;"></iframe>`;
  const healthBadgeMd = `![DevPulse Health](https://devpulse.ritualdev.in/api/badge/health/${project.slug}.svg)`;
  const downloadsBadgeMd = `![DevPulse Downloads](https://devpulse.ritualdev.in/api/badge/downloads/${project.slug}.svg)`;

  const copyText = (key: string, text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedEmbed(key);
    setTimeout(() => setCopiedEmbed(null), 1500);
  };

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
      id: "sso" as const,
      title: "Enterprise SSO (SAML 2.0) & SCIM",
      desc: "Okta, Azure AD (Entra ID), Google Workspace SAML + SCIM auto-provisioning",
      icon: KeyRound,
      accent: "text-emerald-400 bg-emerald-500/10 border-emerald-500/20",
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

        {/* Weekly PDF/CSV Export & Public Metrics Embed Cards (Notion / Docs / README) */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          <div className="p-5 rounded-2xl bg-zinc-900/90 border border-zinc-800 space-y-3">
            <h2 className="text-sm font-bold text-white flex items-center gap-2">
              <FileDown className="w-4 h-4 text-emerald-400" />
              <span>Weekly CSV &amp; Printable PDF Reports</span>
            </h2>
            <p className="text-xs text-zinc-400">
              Export 90-day package metrics, GitHub clones/views, uptime P95 latency, release health, and crash logs.
            </p>
            <div className="flex flex-wrap gap-2.5 pt-1">
              <a
                href={`/api/v1/export?projectId=${encodeURIComponent(project.id)}&format=csv`}
                className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-emerald-600/20 hover:bg-emerald-600/35 border border-emerald-500/40 text-emerald-200 text-xs font-semibold transition"
              >
                <FileDown className="w-3.5 h-3.5" />
                <span>Download Weekly CSV</span>
              </a>
              <a
                href={`/api/v1/export?projectId=${encodeURIComponent(project.id)}&format=report`}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-indigo-600/20 hover:bg-indigo-600/35 border border-indigo-500/40 text-indigo-200 text-xs font-semibold transition"
              >
                <ExternalLink className="w-3.5 h-3.5" />
                <span>Open Printable PDF Report</span>
              </a>
            </div>
          </div>

          <div className="p-5 rounded-2xl bg-zinc-900/90 border border-zinc-800 space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-bold text-white flex items-center gap-2">
                <Code2 className="w-4 h-4 text-cyan-400" />
                <span>Public Metrics Embed Cards (Notion / Docs)</span>
              </h2>
              <a
                href={`/embed/${encodeURIComponent(project.slug)}`}
                target="_blank"
                rel="noreferrer"
                className="text-[11px] text-cyan-300 hover:underline flex items-center gap-1"
              >
                <span>Preview Card</span>
                <ExternalLink className="w-3 h-3" />
              </a>
            </div>
            <div className="space-y-2 text-[11px] font-mono">
              <div className="flex items-center justify-between gap-2 p-2 rounded-lg bg-zinc-950 border border-zinc-800">
                <span className="truncate text-zinc-300">{iframeSnippet}</span>
                <button
                  type="button"
                  onClick={() => copyText("iframe", iframeSnippet)}
                  className="px-2 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-white shrink-0 flex items-center gap-1"
                >
                  {copiedEmbed === "iframe" ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                  <span>iframe</span>
                </button>
              </div>
              <div className="flex items-center justify-between gap-2 p-2 rounded-lg bg-zinc-950 border border-zinc-800">
                <span className="truncate text-zinc-300">{healthBadgeMd}</span>
                <button
                  type="button"
                  onClick={() => copyText("health", healthBadgeMd)}
                  className="px-2 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-white shrink-0 flex items-center gap-1"
                >
                  {copiedEmbed === "health" ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                  <span>Health SVG</span>
                </button>
              </div>
              <div className="flex items-center justify-between gap-2 p-2 rounded-lg bg-zinc-950 border border-zinc-800">
                <span className="truncate text-zinc-300">{downloadsBadgeMd}</span>
                <button
                  type="button"
                  onClick={() => copyText("dl", downloadsBadgeMd)}
                  className="px-2 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-white shrink-0 flex items-center gap-1"
                >
                  {copiedEmbed === "dl" ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                  <span>Downloads SVG</span>
                </button>
              </div>
            </div>
          </div>
        </div>

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

      <SsoScimModal
        isOpen={openModal === "sso"}
        onClose={() => setOpenModal(null)}
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
