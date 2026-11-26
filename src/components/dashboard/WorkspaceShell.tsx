"use client";

import React, { useState, useEffect, createContext, useContext, useMemo } from "react";
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
  Search,
  Workflow,
  ScrollText,
  Flag,
  MessageSquare,
} from "lucide-react";
import { AuthButton } from "@/components/auth/AuthButton";
import {
  ProjectWorkspaceSwitcher,
  type ProjectSummary,
} from "./ProjectWorkspaceSwitcher";
import { ImportRepositoryModal } from "./ImportRepositoryModal";
import { QuickConnectPanel } from "./QuickConnectPanel";
import { CommandPalette } from "./CommandPalette";
import { BillingModal } from "./BillingModal";
import { PackageSearchPicker } from "./PackageSearchPicker";

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

interface WorkspaceShellContextValue {
  isInsideShell: boolean;
  setHeaderActions: (node: React.ReactNode) => void;
}

const WorkspaceShellContext = createContext<WorkspaceShellContextValue>({
  isInsideShell: false,
  setHeaderActions: () => {},
});

const NAV_ITEMS = [
  { href: "/dashboard", label: "Overview", icon: LayoutGrid, exact: true },
  { href: "/dashboard/github", label: "Git & PRs", icon: GitBranch },
  { href: "/dashboard/packages", label: "Packages", icon: Package },
  { href: "/dashboard/analytics", label: "Daily Users", icon: BarChart3 },
  { href: "/dashboard/crashes", label: "Crashes & Maps", icon: Bug },
  { href: "/dashboard/traces", label: "Traces (OTEL)", icon: Workflow },
  { href: "/dashboard/logs", label: "Logs (Loki)", icon: ScrollText },
  { href: "/dashboard/flags", label: "Flags & A/B", icon: Flag },
  { href: "/dashboard/feedback", label: "Feedback & Releases", icon: MessageSquare },
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
  const { isInsideShell, setHeaderActions } = useContext(WorkspaceShellContext);
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [childHeaderActions, setChildHeaderActions] = useState<React.ReactNode>(null);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [isImportOpen, setIsImportOpen] = useState(false);
  const [isQuickConnectOpen, setIsQuickConnectOpen] = useState(false);
  const [isPackageAdderOpen, setIsPackageAdderOpen] = useState(false);
  const [isBillingOpen, setIsBillingOpen] = useState(false);
  const [isPaletteOpen, setIsPaletteOpen] = useState(false);

  useEffect(() => {
    if (!isInsideShell) return;
    setHeaderActions(rightActions ?? null);
    return () => setHeaderActions(null);
  }, [isInsideShell, setHeaderActions, rightActions]);

  useEffect(() => {
    if (isInsideShell) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setIsPaletteOpen((prev) => !prev);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isInsideShell]);

  const providerValue = useMemo(
    () => ({ isInsideShell: true, setHeaderActions: setChildHeaderActions }),
    []
  );

  if (isInsideShell) {
    return <>{children}</>;
  }

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

  const effectiveRightActions = rightActions ?? childHeaderActions;

  return (
    <WorkspaceShellContext.Provider value={providerValue}>
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
          <button
            type="button"
            onClick={() => setIsBillingOpen(true)}
            className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded-full border transition ${
              storageTier === "free"
                ? "bg-emerald-500/15 border-emerald-500/40 text-emerald-300 hover:bg-emerald-500/25"
                : "bg-zinc-900 border-zinc-800 text-zinc-300 hover:text-white"
            }`}
            title="View plans & upgrade"
          >
            {storageTier === "free" ? "FREE · Upgrade" : storageTier}
          </button>
        </div>

        <div className="p-3 border-b border-zinc-800/60 space-y-2">
          <button
            type="button"
            onClick={() => setIsQuickConnectOpen(true)}
            className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-xl bg-gradient-to-r from-indigo-600 to-cyan-600 hover:from-indigo-500 hover:to-cyan-500 text-white text-xs font-semibold shadow-lg shadow-indigo-600/20 transition"
          >
            <Wand2 className="w-3.5 h-3.5" />
            <span>Quick Connect Link</span>
          </button>
          <button
            type="button"
            onClick={() => setIsPackageAdderOpen(true)}
            className="w-full flex items-center justify-center gap-2 px-3 py-1.5 rounded-xl bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-zinc-200 text-xs font-semibold transition"
          >
            <Package className="w-3.5 h-3.5 text-emerald-400" />
            <span>Add Package / Extension</span>
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
            <div className="p-3 border-b border-zinc-800 space-y-2">
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
              <button
                type="button"
                onClick={() => {
                  setMobileOpen(false);
                  setIsPackageAdderOpen(true);
                }}
                className="w-full flex items-center justify-center gap-2 px-3 py-1.5 rounded-xl bg-zinc-900 border border-zinc-800 text-zinc-200 text-xs font-semibold"
              >
                <Package className="w-3.5 h-3.5 text-emerald-400" />
                <span>Add Package / Extension</span>
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
            <button
              type="button"
              onClick={() => setIsPaletteOpen(true)}
              className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-lg bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-xs text-zinc-400 hover:text-zinc-200 transition"
              title="Open Command Palette (Ctrl+K / Cmd+K)"
            >
              <Search className="w-3.5 h-3.5 text-zinc-500" />
              <span>Search...</span>
              <kbd className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-zinc-950 border border-zinc-800 text-zinc-400">
                ⌘K
              </kbd>
            </button>
            {effectiveRightActions}
            <button
              type="button"
              onClick={() => setIsPackageAdderOpen(true)}
              className="hidden md:flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-zinc-200 text-xs font-semibold transition"
              title="Search & add npm, PyPI, Crates, Docker, VS Code, MCP, or Go packages"
            >
              <Package className="w-3.5 h-3.5 text-emerald-400" />
              <span>Add Package</span>
            </button>
            <button
              type="button"
              onClick={() => setIsBillingOpen(true)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border transition ${
                storageTier === "free"
                  ? "bg-emerald-600/20 hover:bg-emerald-600/30 border-emerald-500/40 text-emerald-300"
                  : "bg-zinc-900 hover:bg-zinc-800 border-zinc-800 text-zinc-200"
              }`}
              title="Manage DevPulse subscription plans, quotas, and upgrades"
            >
              <CreditCard className="w-3.5 h-3.5 text-emerald-400" />
              <span>{storageTier === "free" ? "Upgrade" : `${storageTier.toUpperCase()} Plan`}</span>
            </button>
            <AuthButton />
          </div>
        </header>

        {/* Page Body */}
        <main className="flex-1 w-full max-w-none px-4 sm:px-6 lg:px-8 py-6">
          {children}
        </main>
      </div>

      {/* Modals */}
      <ImportRepositoryModal
        isOpen={isImportOpen}
        onClose={() => setIsImportOpen(false)}
      />

      <BillingModal
        isOpen={isBillingOpen}
        onClose={() => setIsBillingOpen(false)}
        storageTier={storageTier}
        isDemo={isDemo}
      />

      {isPackageAdderOpen && (
        <div
          onClick={() => setIsPackageAdderOpen(false)}
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-xl rounded-2xl bg-zinc-900 border border-zinc-800 shadow-2xl p-6 space-y-4"
          >
            <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400">
                  <Package className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-base font-semibold text-white">
                    Add Package, Extension, Container or MCP Server
                  </h3>
                  <p className="text-xs text-zinc-400">
                    Search public registries and attach in 1 click to {currentProject.name}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsPackageAdderOpen(false)}
                className="p-1 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <PackageSearchPicker
              selectedValues={{
                npmPackage: currentProject.npmPackage,
                pypiPackage: currentProject.pypiPackage,
                rustCrate: currentProject.rustCrate,
                goModule: currentProject.goModule,
                dockerImage: currentProject.dockerImage,
              }}
              onSelectItem={async (item) => {
                if (isDemo) return;
                const res = await fetch("/api/v1/projects/connectors", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    action: "add_package_connector",
                    projectId: currentProject.id,
                    provider: item.ecosystem,
                    identifier: item.name,
                    label: `${item.ecosystem}: ${item.name}`,
                    targetUrl: item.url,
                  }),
                });
                if (res.ok) {
                  setIsPackageAdderOpen(false);
                  window.location.reload();
                }
              }}
            />
            {isDemo && (
              <p className="text-[11px] text-amber-300">
                Sign in with GitHub to attach packages or extensions to a live workspace.
              </p>
            )}
          </div>
        </div>
      )}

      <CommandPalette
        isOpen={isPaletteOpen}
        onClose={() => setIsPaletteOpen(false)}
        currentProject={currentProject}
        projects={projectList}
        isDemo={isDemo}
        onOpenQuickConnect={() => setIsQuickConnectOpen(true)}
        onOpenImport={() => setIsImportOpen(true)}
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
    </WorkspaceShellContext.Provider>
  );
}
