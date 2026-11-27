"use client";

import React, { useState, useEffect, createContext, useContext, useMemo, useCallback } from "react";
import Link from "next/link";
import { getProjectStorageKey } from "@/lib/storage-keys";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
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
  ShieldAlert,
  Bot,
  Palette,
  PanelLeftClose,
  PanelLeftOpen,
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
import { CustomCssModal } from "./CustomCssModal";
import { ModalShell } from "./ModalShell";
import { useToast } from "./ToastContext";
import {
  DEFAULT_APPEARANCE_PREFS,
  getAppearancePrefsCss,
  getPresetThemeCss,
  normalizeThemeId,
  scopeCustomCss,
  type AppearancePreferences,
} from "@/lib/layout/css-scoper";

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
  theme: string;
  customCss: string;
  appearancePrefs: AppearancePreferences;
  setTheme: (theme: string) => void;
  setCustomCss: (css: string) => void;
  setAppearancePrefs: (prefs: AppearancePreferences) => void;
  openThemeStudio: () => void;
}

const WorkspaceShellContext = createContext<WorkspaceShellContextValue>({
  isInsideShell: false,
  setHeaderActions: () => {},
  theme: "obsidian",
  customCss: "",
  appearancePrefs: DEFAULT_APPEARANCE_PREFS,
  setTheme: () => {},
  setCustomCss: () => {},
  setAppearancePrefs: () => {},
  openThemeStudio: () => {},
});

export function useWorkspaceAppearance() {
  return useContext(WorkspaceShellContext);
}

const NAV_GROUPS: Array<{
  title: string;
  items: Array<{ href: string; label: string; icon: React.ComponentType<{ className?: string }>; exact?: boolean }>;
}> = [
  {
    title: "Core",
    items: [
      { href: "/dashboard", label: "Overview", icon: LayoutGrid, exact: true },
      { href: "/dashboard/github", label: "Git & PRs", icon: GitBranch },
      { href: "/dashboard/packages", label: "Packages", icon: Package },
      { href: "/dashboard/analytics", label: "Daily Users", icon: BarChart3 },
    ],
  },
  {
    title: "Observability",
    items: [
      { href: "/dashboard/crashes", label: "Crashes & Maps", icon: Bug },
      { href: "/dashboard/traces", label: "Traces (OTEL)", icon: Workflow },
      { href: "/dashboard/logs", label: "Logs (Loki)", icon: ScrollText },
      { href: "/dashboard/uptime", label: "Uptime & P95", icon: HeartPulse },
    ],
  },
  {
    title: "Security & AI",
    items: [
      { href: "/dashboard/security", label: "Security & SBOM", icon: ShieldAlert },
      { href: "/dashboard/defense", label: "Defense Suite", icon: Sparkles },
      { href: "/dashboard/mcp", label: "MCP & AI Agents", icon: Bot },
      { href: "/dashboard/flags", label: "Flags & A/B", icon: Flag },
      { href: "/dashboard/feedback", label: "Feedback & Releases", icon: MessageSquare },
    ],
  },
  {
    title: "Platform",
    items: [
      { href: "/dashboard/revenue", label: "Revenue & Plan", icon: CreditCard },
      { href: "/dashboard/settings", label: "Settings", icon: Settings },
    ],
  },
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
  const router = useRouter();
  const { showToast } = useToast();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [childHeaderActions, setChildHeaderActions] = useState<React.ReactNode>(null);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [isImportOpen, setIsImportOpen] = useState(false);
  const [isQuickConnectOpen, setIsQuickConnectOpen] = useState(false);
  const [isPackageAdderOpen, setIsPackageAdderOpen] = useState(false);
  const [isBillingOpen, setIsBillingOpen] = useState(false);
  const [isPaletteOpen, setIsPaletteOpen] = useState(false);
  const [isStylingOpen, setIsStylingOpen] = useState(false);

  const [liveTheme, setLiveTheme] = useState(() => normalizeThemeId(currentProject.theme));
  const [liveCustomCss, setLiveCustomCss] = useState(() => currentProject.customCss || "");
  const [appearancePrefs, setAppearancePrefs] = useState<AppearancePreferences>(
    DEFAULT_APPEARANCE_PREFS
  );

  useEffect(() => {
    if (isInsideShell) return;
    try {
      setCollapsed(localStorage.getItem("devpulse_sidebar_collapsed") === "1");
    } catch {
      // ignore
    }
  }, [isInsideShell]);

  useEffect(() => {
    if (isInsideShell || typeof document === "undefined") return;
    document.documentElement.setAttribute("data-theme", normalizeThemeId(liveTheme));
  }, [liveTheme, isInsideShell]);

  // Sync project theme when switching workspaces cleanly
  useEffect(() => {
    if (isInsideShell) return;
    const frame = requestAnimationFrame(() => {
      try {
        const savedTheme = localStorage.getItem(getProjectStorageKey("theme", currentProject.id, isDemo));
        const savedCss = localStorage.getItem(getProjectStorageKey("css", currentProject.id, isDemo));
        const savedPrefs = localStorage.getItem(getProjectStorageKey("prefs", currentProject.id, isDemo));
        setLiveTheme(normalizeThemeId(savedTheme || currentProject.theme));
        setLiveCustomCss(savedCss !== null ? savedCss : currentProject.customCss || "");
        if (savedPrefs) {
          const parsed = JSON.parse(savedPrefs) as Partial<AppearancePreferences>;
          setAppearancePrefs({ ...DEFAULT_APPEARANCE_PREFS, ...parsed });
        } else {
          setAppearancePrefs(DEFAULT_APPEARANCE_PREFS);
        }
      } catch {
        setLiveTheme(normalizeThemeId(currentProject.theme));
        setLiveCustomCss(currentProject.customCss || "");
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [currentProject.id, currentProject.theme, currentProject.customCss, isInsideShell]);

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

  const openThemeStudio = useCallback(() => setIsStylingOpen(true), []);

  const providerValue = useMemo<WorkspaceShellContextValue>(
    () => ({
      isInsideShell: true,
      setHeaderActions: setChildHeaderActions,
      theme: liveTheme,
      customCss: liveCustomCss,
      appearancePrefs,
      setTheme: setLiveTheme,
      setCustomCss: setLiveCustomCss,
      setAppearancePrefs,
      openThemeStudio,
    }),
    [liveTheme, liveCustomCss, appearancePrefs, openThemeStudio]
  );

  if (isInsideShell) {
    return <>{children}</>;
  }

  const projectList = projects.length > 0 ? projects : [currentProject];
  const activeThemeId = normalizeThemeId(liveTheme);
  const combinedDynamicCss = [
    getPresetThemeCss(activeThemeId),
    getAppearancePrefsCss(appearancePrefs),
    scopeCustomCss(liveCustomCss, ".devpulse-workspace"),
  ]
    .filter(Boolean)
    .join("\n");

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

  const toggleCollapse = () => {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem("devpulse_sidebar_collapsed", next ? "1" : "0");
      } catch {
        // ignore
      }
      return next;
    });
  };

  const renderNavLinks = (onClick?: () => void, isRail = false) => (
    <div className="space-y-3.5 px-2.5">
      {NAV_GROUPS.map((group) => (
        <div key={group.title} className="space-y-1">
          {!isRail && (
            <div className="px-2.5 pb-0.5 text-[10px] font-bold uppercase tracking-wider text-zinc-500">
              {group.title}
            </div>
          )}
          <nav className="space-y-0.5">
            {group.items.map((item) => {
              const Icon = item.icon;
              const active = item.exact
                ? pathname === item.href
                : pathname.startsWith(item.href);

              return (
                <Link
                  key={item.href}
                  href={buildNavHref(item.href)}
                  aria-current={active ? "page" : undefined}
                  title={isRail ? item.label : undefined}
                  onClick={onClick}
                  className={`flex items-center ${isRail ? "justify-center px-2" : "gap-2.5 px-3"} py-2 rounded-xl text-xs font-medium transition ${
                    active
                      ? "devpulse-nav-active bg-indigo-600/20 text-white border border-indigo-500/40 shadow-sm shadow-indigo-500/10"
                      : "text-zinc-400 hover:text-white hover:bg-zinc-900 border border-transparent"
                  }`}
                >
                  <Icon className={`w-4 h-4 shrink-0 ${active ? "text-indigo-400" : "text-zinc-500"}`} />
                  {!isRail && <span className="truncate">{item.label}</span>}
                </Link>
              );
            })}
          </nav>
        </div>
      ))}
    </div>
  );

  const effectiveRightActions = rightActions ?? childHeaderActions;

  return (
    <WorkspaceShellContext.Provider value={providerValue}>
    <div
      data-theme={activeThemeId}
      className="devpulse-shell min-h-screen bg-zinc-950 text-zinc-100 flex selection:bg-indigo-500/30 selection:text-white transition-colors duration-200"
    >
      {combinedDynamicCss && <style dangerouslySetInnerHTML={{ __html: combinedDynamicCss }} />}

      {/* Desktop Left Sidebar */}
      <aside
        className={`devpulse-sidebar hidden lg:flex ${
          collapsed ? "lg:w-16" : "lg:w-60"
        } lg:flex-col lg:fixed lg:inset-y-0 border-r border-zinc-800/80 bg-zinc-950/95 backdrop-blur-xl z-40 transition-all duration-200`}
      >
        <div className={`h-14 ${collapsed ? "px-2 justify-center" : "px-4 justify-between"} flex items-center border-b border-zinc-800/80`}>
          <Link href="/" className="flex items-center gap-2.5 group min-w-0">
            <div className="w-8 h-8 rounded-xl bg-gradient-to-tr from-indigo-600 via-indigo-500 to-cyan-400 p-[1px] shadow-lg shadow-indigo-500/20 shrink-0">
              <div className="w-full h-full bg-zinc-950 rounded-[11px] flex items-center justify-center">
                <Activity className="w-4 h-4 text-indigo-400" />
              </div>
            </div>
            {!collapsed && (
              <span className="font-extrabold text-white text-base tracking-tight truncate">DevPulse</span>
            )}
          </Link>
          {!collapsed && (
            <button
              type="button"
              onClick={toggleCollapse}
              title="Collapse sidebar rail"
              className="p-1.5 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-900 transition"
            >
              <PanelLeftClose className="w-4 h-4" />
            </button>
          )}
        </div>

        <div className="p-2.5 border-b border-zinc-800/60 space-y-2">
          {collapsed && (
            <button
              type="button"
              onClick={toggleCollapse}
              title="Expand sidebar"
              className="w-full flex items-center justify-center p-2 rounded-xl bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-zinc-300 hover:text-white transition"
            >
              <PanelLeftOpen className="w-4 h-4" />
            </button>
          )}
          <button
            type="button"
            onClick={() => setIsQuickConnectOpen(true)}
            title="Quick Connect Link"
            className="w-full flex items-center justify-center gap-2 px-2.5 py-2 rounded-xl bg-gradient-to-r from-indigo-600 to-cyan-600 hover:from-indigo-500 hover:to-cyan-500 text-white text-xs font-semibold shadow-lg shadow-indigo-600/20 transition"
          >
            <Wand2 className="w-3.5 h-3.5 shrink-0" />
            {!collapsed && <span>Quick Connect Link</span>}
          </button>
          <button
            type="button"
            onClick={() => setIsPackageAdderOpen(true)}
            title="Add Package / Extension"
            className="w-full flex items-center justify-center gap-2 px-2.5 py-1.5 rounded-xl bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-zinc-200 text-xs font-semibold transition"
          >
            <Package className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
            {!collapsed && <span>Add Package / Extension</span>}
          </button>
        </div>

        <div className="flex-1 overflow-y-auto py-3">
          {renderNavLinks(undefined, collapsed)}
        </div>

        <div className="p-2.5 border-t border-zinc-800/80 space-y-2 text-xs">
          <button
            type="button"
            onClick={() => setIsStylingOpen(true)}
            title="Theme & Appearance"
            className={`w-full flex items-center ${collapsed ? "justify-center px-2" : "justify-between px-3"} py-2 rounded-xl bg-zinc-900/70 hover:bg-zinc-900 border border-zinc-800 text-zinc-300 hover:text-white transition text-[11px]`}
          >
            <span className="flex items-center gap-1.5">
              <Palette className="w-3.5 h-3.5 text-purple-400 shrink-0" />
              {!collapsed && <span>Theme &amp; Appearance</span>}
            </span>
            {!collapsed && (
              <span className="text-[10px] font-mono text-zinc-400 capitalize">{activeThemeId.replace("_", " ")}</span>
            )}
          </button>
          {customDomain ? (
            <a
              href={`https://${customDomain}`}
              target="_blank"
              rel="noreferrer"
              title={customDomain}
              className={`flex items-center ${collapsed ? "justify-center px-2" : "justify-between px-3"} py-2 rounded-xl bg-zinc-900 border border-zinc-800 text-zinc-300 hover:text-white transition`}
            >
              {!collapsed && <span className="truncate font-mono text-[11px]">{customDomain}</span>}
              <ExternalLink className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
            </a>
          ) : (
            <Link
              href={buildNavHref("/dashboard/settings")}
              title="Portal & Domain"
              className={`flex items-center ${collapsed ? "justify-center px-2" : "justify-between px-3"} py-2 rounded-xl bg-zinc-900/70 border border-zinc-800 text-zinc-400 hover:text-white transition text-[11px]`}
            >
              <span className="flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
                {!collapsed && <span>Portal &amp; Domain</span>}
              </span>
              {!collapsed && <span>Setup</span>}
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
          <aside className="devpulse-sidebar relative w-64 max-w-[80vw] bg-zinc-950 border-r border-zinc-800 flex flex-col z-10">
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
            <div className="p-3 border-t border-zinc-800">
              <button
                type="button"
                onClick={() => {
                  setMobileOpen(false);
                  setIsStylingOpen(true);
                }}
                className="w-full flex items-center justify-between px-3 py-2 rounded-xl bg-zinc-900 border border-zinc-800 text-xs text-zinc-200"
              >
                <span className="flex items-center gap-1.5">
                  <Palette className="w-3.5 h-3.5 text-purple-400" />
                  <span>Theme &amp; Appearance</span>
                </span>
              </button>
            </div>
          </aside>
        </div>
      )}

      {/* Main Content Column */}
      <div className={`flex-1 ${collapsed ? "lg:pl-16" : "lg:pl-60"} flex flex-col min-w-0 transition-all duration-200`}>
        {/* Clean Minimal Top Bar */}
        <header className="devpulse-topbar h-14 border-b border-zinc-800/80 bg-zinc-950/75 backdrop-blur-xl sticky top-0 z-30 px-3 sm:px-6 flex items-center justify-between gap-2 sm:gap-3">
          <div className="flex items-center gap-2 sm:gap-2.5 min-w-0 shrink">
            <button
              type="button"
              onClick={() => setMobileOpen(true)}
              className="lg:hidden shrink-0 p-2 rounded-lg bg-zinc-900 border border-zinc-800 text-zinc-300 hover:text-white"
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
              <span className="hidden 2xl:inline-flex shrink-0 whitespace-nowrap text-[10px] font-semibold px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/20">
                Demo Snapshot
              </span>
            )}
            <div
              className="hidden md:inline-flex items-center rounded-lg bg-zinc-900 border border-zinc-800 p-0.5 shrink-0"
              role="group"
              aria-label="Global time range filter"
            >
              {(["7d", "30d", "90d", "1y"] as const).map((r) => {
                const activeRange = searchParams.get("range") || "30d";
                const active = activeRange === r;
                return (
                  <button
                    key={r}
                    type="button"
                    aria-pressed={active}
                    onClick={() => {
                      const next = new URLSearchParams(searchParams.toString());
                      next.set("range", r);
                      router.replace(`${pathname}?${next.toString()}`);
                    }}
                    className={`px-2 py-0.5 rounded-md text-[11px] font-mono tabular-nums transition ${
                      active
                        ? "bg-indigo-600 text-white font-semibold"
                        : "text-zinc-400 hover:text-zinc-200"
                    }`}
                  >
                    {r}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
            <button
              type="button"
              onClick={() => setIsPaletteOpen(true)}
              className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-lg bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-xs text-zinc-400 hover:text-zinc-200 transition"
              title="Open Command Palette (Ctrl+K / Cmd+K)"
            >
              <Search className="w-3.5 h-3.5 text-zinc-500" />
              <span className="hidden 2xl:inline">Search...</span>
              <kbd className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-zinc-950 border border-zinc-800 text-zinc-400">
                ⌘K
              </kbd>
            </button>
            <button
              type="button"
              onClick={() => setIsStylingOpen(true)}
              className="hidden md:flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-xs text-zinc-200 font-medium transition"
              title="Theme, Appearance & Scoped CSS Studio"
            >
              <Palette className="w-3.5 h-3.5 text-purple-400" />
              <span>Theme</span>
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
              className={`flex items-center gap-1.5 px-2 sm:px-3 py-1.5 rounded-lg text-xs font-semibold border whitespace-nowrap shrink-0 transition ${
                storageTier === "free"
                  ? "bg-emerald-600/20 hover:bg-emerald-600/30 border-emerald-500/40 text-emerald-300"
                  : "bg-zinc-900 hover:bg-zinc-800 border-zinc-800 text-zinc-200"
              }`}
              title="Manage DevPulse subscription plans, quotas, and upgrades"
            >
              <CreditCard className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
              <span>{storageTier === "free" ? "Upgrade" : `${storageTier.toUpperCase()} Plan`}</span>
            </button>
            <AuthButton />
          </div>
        </header>

        {/* Page Body */}
        <main className="devpulse-workspace flex-1 w-full max-w-none px-4 sm:px-6 lg:px-8 py-6">
          {children}
        </main>
      </div>

      {/* Modals */}
      <CustomCssModal
        isOpen={isStylingOpen}
        onClose={() => setIsStylingOpen(false)}
        projectId={currentProject.id}
        currentTheme={activeThemeId}
        onApplyTheme={(t) => setLiveTheme(t)}
        customCss={liveCustomCss}
        onSaveCustomCss={(c) => setLiveCustomCss(c)}
        appearancePrefs={appearancePrefs}
        onSaveAppearancePrefs={(p) => setAppearancePrefs(p)}
        isDemo={isDemo}
      />

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

      <ModalShell
        isOpen={isPackageAdderOpen}
        onClose={() => setIsPackageAdderOpen(false)}
        maxWidthClass="max-w-xl"
      >
        <div className="space-y-4">
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
              aria-label="Close modal"
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
              if (isDemo) {
                showToast(`Demo preview: ${item.name} (${item.ecosystem}) selected`, "info");
                return;
              }
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
                showToast(`Attached ${item.name} (${item.ecosystem})`, "success");
                router.refresh();
              } else {
                showToast("Failed to attach package", "error");
              }
            }}
          />
          {isDemo && (
            <p className="text-[11px] text-amber-300">
              Sign in with GitHub to attach packages or extensions to a live workspace.
            </p>
          )}
        </div>
      </ModalShell>

      <CommandPalette
        isOpen={isPaletteOpen}
        onClose={() => setIsPaletteOpen(false)}
        currentProject={currentProject}
        projects={projectList}
        isDemo={isDemo}
        onOpenQuickConnect={() => setIsQuickConnectOpen(true)}
        onOpenImport={() => setIsImportOpen(true)}
        onOpenThemeStudio={() => setIsStylingOpen(true)}
      />

      <ModalShell
        isOpen={isQuickConnectOpen}
        onClose={() => setIsQuickConnectOpen(false)}
        maxWidthClass="max-w-3xl"
      >
        <div className="flex-1 overflow-y-auto pr-1">
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
              showToast("Quick Connect integrations updated", "success");
              router.refresh();
            }}
          />
        </div>
      </ModalShell>
    </div>
    </WorkspaceShellContext.Provider>
  );
}
