"use client";

import React, { useState } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import {
  Activity,
  LayoutGrid,
  GitBranch,
  Package,
  BarChart3,
  Bug,
  HeartPulse,
  CreditCard,
  Settings,
  Wand2,
  Menu,
  X,
  ExternalLink,
  Sparkles,
} from "lucide-react";
import { AuthButton } from "@/components/auth/AuthButton";
import {
  ProjectWorkspaceSwitcher,
  type ProjectSummary,
} from "./ProjectWorkspaceSwitcher";
import { ImportRepositoryModal } from "./ImportRepositoryModal";
import { QuickConnectPanel } from "./QuickConnectPanel";

interface WorkspaceShellProps {
  currentProject: ProjectSummary & {
    stackPreset?: string;
    hasNpmToken?: boolean;
    hasGithubToken?: boolean;
  };
  projects: ProjectSummary[];
  storageTier: string;
  customDomain?: string | null;
  isDemo?: boolean;
  rightActions?: React.ReactNode;
  children: React.ReactNode;
}

const NAV_ITEMS = [
  { href: "/dashboard", label: "Overview", icon: LayoutGrid, exact: true },
  { href: "/dashboard/github", label: "GitHub & PRs", icon: GitBranch },
  { href: "/dashboard/packages", label: "Packages", icon: Package },
  { href: "/dashboard/analytics", label: "Daily Users", icon: BarChart3 },
  { href: "/dashboard/crashes", label: "Crashes & Maps", icon: Bug },
  { href: "/dashboard/uptime", label: "Uptime & P95", icon: HeartPulse },
  { href: "/dashboard/revenue", label: "Revenue & Plan", icon: CreditCard },
  { href: "/dashboard/settings", label: "Settings", icon: Settings },
];

export function WorkspaceShell({
  currentProject,
  projects,
  storageTier,
  customDomain,
  isDemo = false,
  rightActions,
  children,
}: WorkspaceShellProps) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [isImportOpen, setIsImportOpen] = useState(false);
  const [isQuickConnectOpen, setIsQuickConnectOpen] = useState(false);

  const projectList = projects.length > 0 ? projects : [currentProject];

  const buildNavHref = (baseHref: string) => {
    const qs = new URLSearchParams();
    const projParam = searchParams.get("project") || currentProject.slug;
    if (isDemo || searchParams.get("demo") === "1") {
      qs.set("demo", "1");
    } else if (projParam) {
      qs.set("project", projParam);
    }
    const query = qs.toString();
    return query ? `${baseHref}?${query}` : baseHref;
  };

  const renderNavLinks = (onClick?: () => void) => (
    <nav className="space-y-1 px-3">
      {NAV_ITEMS.map((item) => {
        const Icon = item.icon;
        const active = item.exact
          ? pathname === item.href
          : pathname.startsWith(item.href);

        return (
          <Link
            key={item.href}
            href={buildNavHref(item.href)}
            onClick={onClick}
            className={`flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-medium transition ${
              active
                ? "bg-indigo-600/20 text-white border border-indigo-500/40 shadow-sm shadow-indigo-500/10"
                : "text-zinc-400 hover:text-white hover:bg-zinc-900 border border-transparent"
            }`}
          >
            <Icon className={`w-4 h-4 shrink-0 ${active ? "text-indigo-400" : "text-zinc-500"}`} />
            <span>{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 flex selection:bg-indigo-500/30 selection:text-white">
      {/* Desktop Left Sidebar */}
      <aside className="hidden lg:flex lg:w-60 lg:flex-col lg:fixed lg:inset-y-0 border-r border-zinc-800/80 bg-zinc-950/95 backdrop-blur-xl z-40">
        <div className="h-14 px-4 flex items-center justify-between border-b border-zinc-800/80">
          <Link href="/" className="flex items-center gap-2.5 group">
            <div className="w-8 h-8 rounded-xl bg-gradient-to-tr from-indigo-600 via-indigo-500 to-cyan-400 p-[1px] shadow-lg shadow-indigo-500/20">
              <div className="w-full h-full bg-zinc-950 rounded-[11px] flex items-center justify-center">
                <Activity className="w-4 h-4 text-indigo-400" />
              </div>
            </div>
            <span className="font-extrabold text-white text-base tracking-tight">DevPulse</span>
          </Link>
          <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded-full bg-zinc-900 border border-zinc-800 text-zinc-400">
            {storageTier}
          </span>
        </div>

        <div className="p-3 border-b border-zinc-800/60">
          <button
            type="button"
            onClick={() => setIsQuickConnectOpen(true)}
            className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-xl bg-gradient-to-r from-indigo-600 to-cyan-600 hover:from-indigo-500 hover:to-cyan-500 text-white text-xs font-semibold shadow-lg shadow-indigo-600/20 transition"
          >
            <Wand2 className="w-3.5 h-3.5" />
            <span>Quick Connect Link</span>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto py-3">
          <div className="px-4 pb-1.5 text-[10px] font-bold uppercase tracking-wider text-zinc-500">
            Workspace Views
          </div>
          {renderNavLinks()}
        </div>

        <div className="p-3 border-t border-zinc-800/80 space-y-2 text-xs">
          {customDomain ? (
            <a
              href={`https://${customDomain}`}
              target="_blank"
              rel="noreferrer"
              className="flex items-center justify-between px-3 py-2 rounded-xl bg-zinc-900 border border-zinc-800 text-zinc-300 hover:text-white transition"
            >
              <span className="truncate font-mono text-[11px]">{customDomain}</span>
              <ExternalLink className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
            </a>
          ) : (
            <Link
              href={buildNavHref("/dashboard/settings")}
              className="flex items-center justify-between px-3 py-2 rounded-xl bg-zinc-900/70 border border-zinc-800 text-zinc-400 hover:text-white transition text-[11px]"
            >
              <span className="flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5 text-indigo-400" />
                <span>Portal &amp; Domain</span>
              </span>
              <span>Setup</span>
            </Link>
          )}
        </div>
      </aside>

      {/* Mobile Sidebar Drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden flex">
          <div
            className="fixed inset-0 bg-black/80 backdrop-blur-sm"
            onClick={() => setMobileOpen(false)}
          />
          <aside className="relative w-64 max-w-[80vw] bg-zinc-950 border-r border-zinc-800 flex flex-col z-10">
            <div className="h-14 px-4 flex items-center justify-between border-b border-zinc-800">
              <span className="font-extrabold text-white text-base">DevPulse</span>
              <button
                type="button"
                onClick={() => setMobileOpen(false)}
                className="p-1.5 rounded-lg text-zinc-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-3 border-b border-zinc-800">
              <button
                type="button"
                onClick={() => {
                  setMobileOpen(false);
                  setIsQuickConnectOpen(true);
                }}
                className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-xl bg-indigo-600 text-white text-xs font-semibold"
              >
                <Wand2 className="w-3.5 h-3.5" />
                <span>Quick Connect Link</span>
              </button>
            </div>
            <div className="flex-1 overflow-y-auto py-3">
              {renderNavLinks(() => setMobileOpen(false))}
            </div>
          </aside>
        </div>
      )}

      {/* Main Content Column */}
      <div className="flex-1 lg:pl-60 flex flex-col min-w-0">
        {/* Clean Minimal Top Bar */}
        <header className="h-14 border-b border-zinc-800/80 bg-zinc-950/75 backdrop-blur-xl sticky top-0 z-30 px-4 sm:px-6 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <button
              type="button"
              onClick={() => setMobileOpen(true)}
              className="lg:hidden p-2 rounded-lg bg-zinc-900 border border-zinc-800 text-zinc-300 hover:text-white"
              aria-label="Open navigation menu"
            >
              <Menu className="w-4 h-4" />
            </button>

            <ProjectWorkspaceSwitcher
              currentProject={currentProject}
              projects={projectList}
              onOpenImportModal={() => setIsImportOpen(true)}
            />

            {isDemo && (
              <span className="hidden sm:inline-flex text-[10px] font-semibold px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/20">
                Demo Preview
              </span>
            )}
          </div>

          <div className="flex items-center gap-2">
            {rightActions}
            <button
              type="button"
              onClick={() => setIsQuickConnectOpen(true)}
              className="hidden sm:flex lg:hidden items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-600 text-white text-xs font-semibold"
            >
              <Wand2 className="w-3.5 h-3.5" />
              <span>Quick Connect</span>
            </button>
            <AuthButton />
          </div>
        </header>

        {/* Page Body */}
        <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 py-6 sm:py-8">
          {children}
        </main>
      </div>

      {/* Modals */}
      <ImportRepositoryModal
        isOpen={isImportOpen}
        onClose={() => setIsImportOpen(false)}
      />

      {isQuickConnectOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
          <div className="w-full max-w-3xl max-h-[92vh] overflow-y-auto">
            <QuickConnectPanel
              projectId={currentProject.id}
              projectSlug={currentProject.slug}
              telemetryApiKey={currentProject.telemetryApiKey}
              initialPreset={currentProject.stackPreset}
              hasNpmToken={currentProject.hasNpmToken}
              hasGithubToken={currentProject.hasGithubToken}
              isDemo={isDemo}
              onClose={() => setIsQuickConnectOpen(false)}
              onSuccess={() => {
                setIsQuickConnectOpen(false);
                window.location.reload();
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
}
