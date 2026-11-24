"use client";

import React from "react";
import {
  Activity,
  Sliders,
  Palette,
  Globe,
  HardDrive,
  RefreshCw,
} from "lucide-react";
import { AuthButton } from "@/components/auth/AuthButton";

interface DashboardHeaderProps {
  projectName: string;
  repoName?: string;
  isCustomizing: boolean;
  onToggleCustomizing: () => void;
  onOpenStyling: () => void;
  customDomain?: string | null;
  storageTier: string;
  onResetLayout: () => void;
}

export function DashboardHeader({
  projectName,
  repoName,
  isCustomizing,
  onToggleCustomizing,
  onOpenStyling,
  customDomain,
  storageTier,
  onResetLayout,
}: DashboardHeaderProps) {
  return (
    <header className="w-full border-b border-zinc-800/80 bg-zinc-950/70 backdrop-blur-xl sticky top-0 z-40 transition">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3.5 flex flex-wrap items-center justify-between gap-3">
        {/* Left: Branding & Project */}
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-indigo-600 via-indigo-500 to-cyan-400 p-[1px] shadow-lg shadow-indigo-500/20">
            <div className="w-full h-full bg-zinc-950 rounded-[11px] flex items-center justify-center">
              <Activity className="w-5 h-5 text-indigo-400" />
            </div>
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-extrabold text-white text-base tracking-tight">DevPulse</span>
              <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
                ritualdev-lab
              </span>
            </div>
            <p className="text-xs text-zinc-400 font-medium">
              {projectName} {repoName ? `(${repoName})` : ""}
            </p>
          </div>
        </div>

        {/* Center / Right: Meta Statuses */}
        <div className="flex items-center flex-wrap gap-2 text-xs">
          {customDomain && (
            <div
              className="hidden sm:flex items-center gap-1.5 px-2.5 py-1 rounded-xl bg-zinc-900 border border-zinc-800 text-zinc-300"
              title="Verified Custom Domain"
            >
              <Globe className="w-3.5 h-3.5 text-cyan-400" />
              <span className="font-mono text-[11px]">{customDomain}</span>
            </div>
          )}

          <div
            className="hidden md:flex items-center gap-1.5 px-2.5 py-1 rounded-xl bg-zinc-900 border border-zinc-800 text-zinc-400"
            title="Cloudflare R2 Storage"
          >
            <HardDrive className="w-3.5 h-3.5 text-purple-400" />
            <span>R2 Storage:</span>
            <span className="text-zinc-200 uppercase font-semibold text-[10px]">
              {storageTier}
            </span>
          </div>

          {/* Action Buttons */}
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
  );
}
