"use client";

import React, { useState } from "react";
import { DashboardHeader } from "./DashboardHeader";
import { DragDropGrid, type DashboardData } from "./DragDropGrid";
import { CustomCssModal } from "./CustomCssModal";
import { AlertSettingsModal } from "./AlertSettingsModal";

interface DashboardClientViewProps {
  initialData: DashboardData;
  customDomain?: string | null;
  storageTier: string;
}

export function DashboardClientView({
  initialData,
  customDomain,
  storageTier,
}: DashboardClientViewProps) {
  const [data, setData] = useState<DashboardData>(initialData);
  const [isCustomizing, setIsCustomizing] = useState(false);
  const [isStylingOpen, setIsStylingOpen] = useState(false);
  const [isAlertsOpen, setIsAlertsOpen] = useState(false);
  const [currentTheme, setCurrentTheme] = useState("dark");
  const [customCss, setCustomCss] = useState("");

  const handleResetLayout = () => {
    try {
      localStorage.removeItem(`devpulse_layout_${data.project.id}`);
      window.location.reload();
    } catch {
      // ignore
    }
  };

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 flex flex-col selection:bg-indigo-500/30 selection:text-white">
      {/* Dynamic Custom CSS injection */}
      {customCss && <style dangerouslySetInnerHTML={{ __html: customCss }} />}

      {/* Top Navbar */}
      <DashboardHeader
        projectName={data.project.name}
        repoName={data.project.githubRepo || undefined}
        isCustomizing={isCustomizing}
        onToggleCustomizing={() => setIsCustomizing((prev) => !prev)}
        onOpenStyling={() => setIsStylingOpen(true)}
        onOpenAlerts={() => setIsAlertsOpen(true)}
        customDomain={customDomain}
        storageTier={storageTier}
        onResetLayout={handleResetLayout}
      />

      {/* Main Content Area */}
      <main className="flex-1 max-w-7xl mx-auto w-full px-4 sm:px-6 py-6 sm:py-8 space-y-6">
        {/* Customization Alert Banner */}
        {isCustomizing && (
          <div className="p-4 rounded-2xl bg-indigo-950/40 border border-indigo-500/40 text-indigo-200 text-xs flex flex-wrap items-center justify-between gap-2 shadow-lg shadow-indigo-950/40">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-indigo-400 animate-ping"></span>
              <span className="font-semibold text-white">Customization Mode Active:</span>
              <span>Drag cards by the handle in the top-right corner to reorder. Click the eye icon to hide.</span>
            </div>
            <button
              onClick={() => setIsCustomizing(false)}
              className="px-3 py-1 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-medium transition"
            >
              Done Customizing
            </button>
          </div>
        )}

        {/* Drag & Drop Card Grid */}
        <DragDropGrid data={data} isCustomizing={isCustomizing} />
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

      {/* Custom Theme & CSS Modal */}
      <CustomCssModal
        isOpen={isStylingOpen}
        onClose={() => setIsStylingOpen(false)}
        currentTheme={currentTheme}
        onApplyTheme={(theme) => setCurrentTheme(theme)}
        customCss={customCss}
        onSaveCustomCss={(css) => setCustomCss(css)}
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
    </div>
  );
}
