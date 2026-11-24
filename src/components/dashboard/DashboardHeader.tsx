"use client";

import React, { useState } from "react";
import {
  Activity,
  Sliders,
  Palette,
  Globe,
  HardDrive,
  RefreshCw,
  Bell,
  Plug,
  Plus,
} from "lucide-react";
import { AuthButton } from "@/components/auth/AuthButton";
import {
  ProjectWorkspaceSwitcher,
  type ProjectSummary,
} from "./ProjectWorkspaceSwitcher";
import { ImportRepositoryModal } from "./ImportRepositoryModal";

interface DashboardHeaderProps {
  currentProject: ProjectSummary;
  projects?: ProjectSummary[];
  isCustomizing: boolean;
  onToggleCustomizing: () => void;
  onOpenStyling: () => void;
  onOpenAlerts: () => void;
  onOpenIntegrations: () => void;
  onOpenStorage?: () => void;
  customDomain?: string | null;
  storageTier: string;
  onResetLayout: () => void;
  isDemo?: boolean;
}

export function DashboardHeader({
  currentProject,
  projects = [],
  isCustomizing,
  onToggleCustomizing,
  onOpenStyling,
  onOpenAlerts,
  onOpenIntegrations,
  onOpenStorage,
  customDomain,
  storageTier,
  onResetLayout,
  isDemo = false,
}: DashboardHeaderProps) {
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);

  const projectList = projects.length > 0 ? projects : [currentProject];

  return (
    <>
      <header className="w-full border-b border-zinc-800/80 bg-zinc-950/70 backdrop-blur-xl sticky top-0 z-40 transition">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3 flex flex-wrap items-center justify-between gap-3">
          {/* Left: Branding & Multi-Project Workspace Switcher */}
          <div className="flex items-center gap-3">
            <a href="/" className="flex items-center gap-2.5 group">
              <div className="w-8 h-8 rounded-xl bg-gradient-to-tr from-indigo-600 via-indigo-500 to-cyan-400 p-[1px] shadow-lg shadow-indigo-500/20 group-hover:scale-105 transition">
                <div className="w-full h-full bg-zinc-950 rounded-[11px] flex items-center justify-center">
                  <Activity className="w-4 h-4 text-indigo-400" />
                </div>
              </div>
              <span className="font-extrabold text-white text-base tracking-tight hidden sm:inline">
                DevPulse
              </span>
            </a>

            {/* Separator */}
            <div className="h-5 w-[1px] bg-zinc-800" />

            {/* Project Switcher Dropdown */}
            <ProjectWorkspaceSwitcher
              currentProject={currentProject}
              projects={projectList}
              onOpenImportModal={() => setIsImportModalOpen(true)}
            />

            {isDemo && (
              <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/20">
                Demo Preview
              </span>
            )}
          </div>

          {/* Center / Right: Meta Statuses & Actions */}
          <div className="flex items-center flex-wrap gap-2 text-xs">
            {customDomain && (
              <div
                className="hidden lg:flex items-center gap-1.5 px-2.5 py-1 rounded-xl bg-zinc-900 border border-zinc-800 text-zinc-300"
                title="Verified Custom Domain"
              >
                <Globe className="w-3.5 h-3.5 text-cyan-400" />
                <span className="font-mono text-[11px]">{customDomain}</span>
              </div>
            )}

            <button
              type="button"
              onClick={onOpenStorage}
              className="hidden sm:flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-zinc-400 hover:text-white transition shadow-sm"
              title="Cloudflare R2 Storage Quota & BYOS Settings"
            >
              <HardDrive className="w-3.5 h-3.5 text-purple-400" />
              <span>R2:</span>
              <span className="text-zinc-200 uppercase font-semibold text-[10px]">
                {storageTier}
              </span>
            </button>

            {/* 1-Click Import Button */}
            <button
              onClick={() => setIsImportModalOpen(true)}
              className="hidden md:flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-indigo-600/15 hover:bg-indigo-600/25 border border-indigo-500/30 text-indigo-300 hover:text-white transition shadow-sm"
              title="Import a new GitHub repository"
            >
              <Plus className="w-3.5 h-3.5 text-indigo-400" />
              <span>Import Repo</span>
            </button>

            {/* Action Buttons */}
            <button
              onClick={onOpenIntegrations}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-zinc-300 hover:text-white transition shadow-sm"
              title="Connect or disconnect package tabs (npm, PyPI, Rust, VS Code)"
            >
              <Plug className="w-3.5 h-3.5 text-cyan-400" />
              <span>Connect Data</span>
            </button>

            <button
              onClick={onOpenAlerts}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-zinc-300 hover:text-white transition shadow-sm"
              title="Configure Discord / Slack / Telegram webhooks"
            >
              <Bell className="w-3.5 h-3.5 text-red-400" />
              <span>Alerts</span>
            </button>

            <button
              onClick={onOpenStyling}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-zinc-300 hover:text-white transition shadow-sm"
            >
              <Palette className="w-3.5 h-3.5 text-indigo-400" />
              <span>Theme / CSS</span>
            </button>

            <button
              onClick={onToggleCustomizing}
              className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-semibold transition shadow-sm ${
                isCustomizing
                  ? "bg-indigo-600 text-white shadow-indigo-600/30"
                  : "bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-zinc-300 hover:text-white"
              }`}
            >
              <Sliders className="w-3.5 h-3.5 text-indigo-300" />
              <span>{isCustomizing ? "Save Layout" : "Customize"}</span>
            </button>

            {isCustomizing && (
              <button
                onClick={onResetLayout}
                className="p-1.5 rounded-xl bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-zinc-400 hover:text-zinc-200 transition"
                title="Reset to Default Layout"
              >
                <RefreshCw className="w-3.5 h-3.5" />
              </button>
            )}

            <div className="pl-1 border-l border-zinc-800">
              <AuthButton />
            </div>
          </div>
        </div>
      </header>

      {/* 1-Click Import Modal */}
      <ImportRepositoryModal
        isOpen={isImportModalOpen}
        onClose={() => setIsImportModalOpen(false)}
      />
    </>
  );
}
