"use client";

import React, { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  type DragStartEvent,
  type DragMoveEvent,
  type DragEndEvent,
} from "@dnd-kit/core";
import { SortableCard } from "./SortableCard";
import { GitHubStatsCard } from "./widgets/GitHubStatsCard";
import { NpmDownloadsCard } from "./widgets/NpmDownloadsCard";
import { PyPiDownloadsCard } from "./widgets/PyPiDownloadsCard";
import { RustCratesCard } from "./widgets/RustCratesCard";
import { GoModuleCard } from "./widgets/GoModuleCard";
import { DockerContainerCard } from "./widgets/DockerContainerCard";
import { VsCodeStatsCard } from "./widgets/VsCodeStatsCard";
import { McpStatsCard } from "./widgets/McpStatsCard";
import { RevenueStatsCard } from "./widgets/RevenueStatsCard";
import { WebAnalyticsCard, type AnalyticsSummary } from "./widgets/WebAnalyticsCard";
import { ErrorStreamCard, type ErrorEventItem } from "./widgets/ErrorStreamCard";
import { TelemetrySetupCard } from "./widgets/TelemetrySetupCard";
import { BugReportBadgeCard } from "./widgets/BugReportBadgeCard";
import { ReleaseHealthCard, type ReleaseHealthItem } from "./widgets/ReleaseHealthCard";
import {
  UptimeMonitorsCard,
  type UptimeSummaryPayload,
} from "./widgets/UptimeMonitorsCard";
import { Plus, Eye, Cloud, Sparkles } from "lucide-react";
import {
  buildDefaultLayout,
  resolveCollisionAndReflow,
  adaptLayoutForColumns,
  packDenseLayout,
  type GridWidgetItem,
} from "@/lib/layout/grid-engine";
import type { GitHubRepoStats } from "@/lib/integrations/github";
import type { GitProviderId, GitRepoStats } from "@/lib/integrations/git-provider";
import type { NpmStats } from "@/lib/integrations/npm";
import type { PyPiStats } from "@/lib/integrations/pypi";
import type { RustCrateStats } from "@/lib/integrations/crates";
import type { GoModuleStats } from "@/lib/integrations/go";
import type { DockerRepoStats } from "@/lib/integrations/docker";
import type { VsCodeStats } from "@/lib/integrations/vscode";
import type { McpServerStats } from "@/lib/integrations/mcp";
import type { RevenueStats } from "@/lib/integrations/revenue";
import type { DepsDevAdvisorySummary } from "@/lib/integrations/deps-dev";
import { securitySummaryKey, type ExtraPackageSnapshot } from "@/lib/integrations/registry-adapter";

export interface DashboardData {
  project: {
    id: string;
    name: string;
    slug: string;
    githubRepo?: string | null;
    gitProvider?: GitProviderId | null;
    gitBaseUrl?: string | null;
    gitRepo?: string | null;
    npmPackage?: string | null;
    pypiPackage?: string | null;
    rustCrate?: string | null;
    goModule?: string | null;
    dockerImage?: string | null;
    vscodeExtension?: string | null;
    mcpServerName?: string | null;
    mcpAllowedTools?: string[] | null;
    telemetryApiKey?: string | null;
    publicWriteKey?: string | null;
    hasTelemetryApiKey?: boolean;
    discordWebhookUrl?: string | null;
    slackWebhookUrl?: string | null;
    telegramBotToken?: string | null;
    telegramChatId?: string | null;
    genericWebhookUrl?: string | null;
    pagerdutyRoutingKey?: string | null;
    teamsWebhookUrl?: string | null;
    notificationEmail?: string | null;
    emailProvider?: string | null;
    hasDiscordWebhook?: boolean;
    hasSlackWebhook?: boolean;
    hasTelegramWebhook?: boolean;
    hasGenericWebhook?: boolean;
    hasPagerDuty?: boolean;
    hasOpsgenieApiKey?: boolean;
    hasTeamsWebhook?: boolean;
    hasNotificationEmail?: boolean;
    hasEmailApiKey?: boolean;
    digestEnabled?: boolean;
    stripeApiKey?: string | null;
    dodoPaymentsApiKey?: string | null;
    theme?: string | null;
    customCss?: string | null;
  };
  githubStats: (GitHubRepoStats & Partial<Pick<GitRepoStats, "provider" | "baseUrl" | "webUrl" | "pipelineStatus">>) | null;
  npmStats: NpmStats | null;
  pypiStats: PyPiStats | null;
  rustStats: RustCrateStats | null;
  goStats?: GoModuleStats | null;
  dockerStats?: DockerRepoStats | null;
  vscodeStats: VsCodeStats | null;
  mcpStats: McpServerStats | null;
  analyticsSummary?: AnalyticsSummary | null;
  revenueStats?: RevenueStats | null;
  uptimeSummary?: UptimeSummaryPayload | null;
  packageSecurity?: Record<string, DepsDevAdvisorySummary>;
  extraPackages?: ExtraPackageSnapshot[];
  snapshotUpdatedAt?: string | null;
  errors: ErrorEventItem[];
  releases?: ReleaseHealthItem[];
  initialLayout?: GridWidgetItem[];
}

interface DragDropGridProps {
  data: DashboardData;
  isCustomizing: boolean;
  isDemo?: boolean;
  isPublicPortal?: boolean;
}

export function DragDropGrid({
  data,
  isCustomizing,
  isDemo = false,
  isPublicPortal = false,
}: DragDropGridProps) {
  const router = useRouter();
  const gridContainerRef = useRef<HTMLDivElement | null>(null);
  const [activeCols, setActiveCols] = useState<12 | 8 | 4>(12);
  const [syncStatus, setSyncStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dropPreview, setDropPreview] = useState<{
    x: number;
    y: number;
    w: number;
    h: number;
  } | null>(null);

  // Determine available widgets based on active project ecosystems
  const availableDefs = useMemo(
    () => [
      ...(data.project.githubRepo || data.project.gitRepo || data.githubStats
        ? [{ id: "github_stats", title: "Git & PRs", defaultW: 4, defaultH: 1 }]
        : []),
      ...(data.project.npmPackage
        ? [{ id: "npm_downloads", title: "npm Downloads", defaultW: 4, defaultH: 1 }]
        : []),
      ...(data.project.pypiPackage
        ? [{ id: "pypi_downloads", title: "PyPI Downloads", defaultW: 4, defaultH: 1 }]
        : []),
      ...(data.project.rustCrate
        ? [{ id: "rust_crates", title: "Rust Crates", defaultW: 4, defaultH: 1 }]
        : []),
      ...(data.project.goModule
        ? [{ id: "go_module", title: "Go Module", defaultW: 4, defaultH: 1 }]
        : []),
      ...(data.project.dockerImage
        ? [{ id: "docker_container", title: "Docker Hub Container", defaultW: 4, defaultH: 1 }]
        : []),
      ...(data.project.vscodeExtension
        ? [{ id: "vscode_stats", title: "VS Code Extension", defaultW: 4, defaultH: 1 }]
        : []),
      ...(data.project.mcpServerName
        ? [{ id: "mcp_stats", title: "MCP Server", defaultW: 4, defaultH: 1 }]
        : []),
      ...(data.revenueStats || data.project.stripeApiKey || data.project.dodoPaymentsApiKey
        ? [{ id: "revenue_stats", title: "Revenue & Monetization", defaultW: 6, defaultH: 1 }]
        : []),
      { id: "web_analytics", title: "Cookie-Free Web Traffic", defaultW: 4, defaultH: 1 },
      { id: "uptime_monitors", title: "Uptime & P95 Latency", defaultW: 4, defaultH: 1 },
      ...(!isPublicPortal
        ? [
            { id: "error_stream", title: "Runtime Crashes & Bugs", defaultW: 8, defaultH: 1 },
            { id: "release_health", title: "Release Health & Commits", defaultW: 4, defaultH: 1 },
            { id: "telemetry_setup", title: "Package Crash SDK", defaultW: 4, defaultH: 1 },
          ]
        : []),
      { id: "bug_report_badge", title: "Public Bug Report Hub", defaultW: 4, defaultH: 1 },
    ],
    [data, isPublicPortal]
  );

  const layoutSourceSignature = useMemo(() => {
    const dbPart = (data.initialLayout || [])
      .map((r) => `${r.id}:${r.x},${r.y},${r.w},${r.h},${r.isVisible ? 1 : 0}`)
      .sort()
      .join("|");
    const availPart = availableDefs.map((d) => d.id).join(",");
    return `${data.project.id}::${dbPart}::${availPart}`;
  }, [data.project.id, data.initialLayout, availableDefs]);

  // Build canonical 12-col layout merging saved DB layout with available ecosystem widgets
  const computeInitialLayout = useCallback((): GridWidgetItem[] => {
    const dbRows = data.initialLayout || [];
    // Ignore pre-Phase-4 legacy partial rows (width < 3 or single-item legacy remnants)
    const hasValid2DLayout = dbRows.length >= 2 && dbRows.every((r) => r.w >= 3);
    if (hasValid2DLayout) {
      const defaults = buildDefaultLayout(availableDefs);
      const merged: GridWidgetItem[] = [];
      const maxSavedY = dbRows.reduce((m, r) => Math.max(m, r.y + r.h), 0);

      for (const def of availableDefs) {
        const saved = dbRows.find((r) => r.id === def.id);
        if (saved) {
          merged.push({
            id: def.id,
            title: def.title,
            x: saved.x,
            y: saved.y,
            w: Math.max(3, saved.w),
            h: Math.max(1, saved.h),
            isVisible: saved.isVisible,
          });
        } else {
          const fallback = defaults.find((d) => d.id === def.id);
          merged.push({
            id: def.id,
            title: def.title,
            x: fallback?.x ?? 0,
            y: maxSavedY + (fallback?.y ?? 0),
            w: def.defaultW,
            h: def.defaultH,
            isVisible: true,
          });
        }
      }
      return packDenseLayout(merged, 12);
    }
    return buildDefaultLayout(availableDefs);
  }, [availableDefs, data.initialLayout]);

  const [desktopLayout, setDesktopLayout] = useState<GridWidgetItem[]>(computeInitialLayout);
  const lastAppliedSigRef = useRef<string>(layoutSourceSignature);

  // Sync local layout ONLY when project or server-persisted widget list actually changes
  useEffect(() => {
    if (lastAppliedSigRef.current === layoutSourceSignature) return;
    lastAppliedSigRef.current = layoutSourceSignature;

    const initial = computeInitialLayout();
    if (!data.initialLayout || data.initialLayout.length === 0) {
      try {
        const cached = localStorage.getItem(`devpulse_2d_layout_${data.project.id}`);
        if (cached) {
          const parsed = JSON.parse(cached) as GridWidgetItem[];
          if (Array.isArray(parsed) && parsed.length > 0) {
            const validIds = new Set(availableDefs.map((d) => d.id));
            const filtered = parsed.filter((item) => validIds.has(item.id));
            if (filtered.length > 0) {
              setDesktopLayout(packDenseLayout(filtered, 12));
              return;
            }
          }
        }
      } catch {
        // fallback to default
      }
    }
    setDesktopLayout(initial);
  }, [layoutSourceSignature, computeInitialLayout, data.initialLayout, data.project.id, availableDefs]);

  // Responsive breakpoint listener: 12 Desktop, 8 Tablet, 4 Mobile
  useEffect(() => {
    const updateCols = () => {
      const w = window.innerWidth;
      if (w >= 1024) setActiveCols(12);
      else if (w >= 640) setActiveCols(8);
      else setActiveCols(4);
    };
    updateCols();
    window.addEventListener("resize", updateCols);
    return () => window.removeEventListener("resize", updateCols);
  }, []);

  const persistLayout = async (nextLayout: GridWidgetItem[]) => {
    try {
      localStorage.setItem(`devpulse_2d_layout_${data.project.id}`, JSON.stringify(nextLayout));
    } catch {
      // ignore localStorage errors
    }

    if (isDemo) return;

    setSyncStatus("saving");
    try {
      const res = await fetch("/api/v1/projects/layout", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId: data.project.id,
          widgets: nextLayout,
        }),
      });
      if (res.ok) {
        setSyncStatus("saved");
        router.refresh();
        setTimeout(() => setSyncStatus("idle"), 2000);
      } else {
        setSyncStatus("error");
      }
    } catch {
      setSyncStatus("error");
    }
  };

  // Displayed layout adapted cleanly to current viewport columns (12 / 8 / 4)
  const responsiveLayout = useMemo(
    () => adaptLayoutForColumns(desktopLayout, activeCols),
    [desktopLayout, activeCols]
  );

  const visibleWidgets = responsiveLayout.filter((w) => w.isVisible);
  const hiddenWidgets = desktopLayout.filter((w) => !w.isVisible);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 5 },
    })
  );

  const computeDropCoords = (activeId: string, deltaX: number, deltaY: number) => {
    const currentItem = responsiveLayout.find((w) => w.id === activeId);
    if (!currentItem) return null;

    const gridRect = gridContainerRef.current?.getBoundingClientRect();
    const colWidth = gridRect ? gridRect.width / activeCols : 95;
    const rowHeight = 364; // 340px row + 24px gap

    const nextX = Math.min(
      Math.max(0, Math.round(currentItem.x + deltaX / colWidth)),
      Math.max(0, activeCols - currentItem.w)
    );
    const nextY = Math.max(0, Math.round(currentItem.y + deltaY / rowHeight));

    return { x: nextX, y: nextY, w: currentItem.w, h: currentItem.h };
  };

  const handleDragStart = (event: DragStartEvent) => {
    const id = String(event.active.id);
    setDraggingId(id);
    const item = responsiveLayout.find((w) => w.id === id);
    if (item) {
      setDropPreview({ x: item.x, y: item.y, w: item.w, h: item.h });
    }
  };

  const handleDragMove = (event: DragMoveEvent) => {
    const id = String(event.active.id);
    const coords = computeDropCoords(id, event.delta.x, event.delta.y);
    if (coords) {
      setDropPreview(coords);
    }
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const id = String(event.active.id);
    const coords = computeDropCoords(id, event.delta.x, event.delta.y);
    setDraggingId(null);
    setDropPreview(null);

    if (!coords) return;

    // Map tablet/mobile drop back to 12-col space cleanly
    const desktopX = activeCols === 12 ? coords.x : Math.round((coords.x / activeCols) * 12);
    const nextLayout = resolveCollisionAndReflow(
      desktopLayout,
      id,
      { x: desktopX, y: coords.y },
      12
    );
    setDesktopLayout(nextLayout);
    persistLayout(nextLayout);
  };

  const [a11yAnnouncement, setA11yAnnouncement] = useState<string>("");

  const handleMoveStep = (id: string, direction: -1 | 1) => {
    const ordered = [...desktopLayout].sort((a, b) => (a.y - b.y) || (a.x - b.x));
    const idx = ordered.findIndex((item) => item.id === id);
    if (idx === -1) return;
    const swapIdx = idx + direction;
    if (swapIdx < 0 || swapIdx >= ordered.length) return;

    const current = ordered[idx];
    const target = ordered[swapIdx];
    const swapped = ordered.map((item) => {
      if (item.id === current.id) return { ...item, x: target.x, y: target.y };
      if (item.id === target.id) return { ...item, x: current.x, y: current.y };
      return item;
    });
    const packed = packDenseLayout(swapped, 12);
    setDesktopLayout(packed);
    persistLayout(packed);
    setA11yAnnouncement(`Moved ${current.title} ${direction < 0 ? "earlier" : "later"} in workspace grid.`);
  };

  const handleResizeCard = (id: string, nextW: number, nextH: number, commit = true) => {
    // Map back to 12-col desktop width if currently on tablet
    const canonicalW = activeCols === 8 ? (nextW >= 8 ? 12 : 4) : nextW;
    const nextLayout = resolveCollisionAndReflow(
      desktopLayout,
      id,
      { w: canonicalW, h: nextH },
      12
    );
    setDesktopLayout(nextLayout);
    if (commit) {
      persistLayout(nextLayout);
    }
  };

  const hideWidget = (id: string) => {
    const updated = packDenseLayout(
      desktopLayout.map((w) => (w.id === id ? { ...w, isVisible: false } : w)),
      12
    );
    setDesktopLayout(updated);
    persistLayout(updated);
  };

  const restoreWidget = (id: string) => {
    const def = availableDefs.find((d) => d.id === id);
    const updated = packDenseLayout(
      desktopLayout.map((w) =>
        w.id === id ? { ...w, isVisible: true, w: w.w || def?.defaultW || 4, h: w.h || 1 } : w
      ),
      12
    );
    setDesktopLayout(updated);
    persistLayout(updated);
  };

  const renderWidgetContent = (id: string) => {
    switch (id) {
      case "github_stats":
        return (
          <GitHubStatsCard
            stats={data.githubStats}
            repoName={data.project.gitRepo || data.project.githubRepo || "Repository"}
            provider={data.project.gitProvider || undefined}
          />
        );
      case "npm_downloads":
        return (
          <NpmDownloadsCard
            stats={data.npmStats}
            packageName={data.project.npmPackage || "npm package"}
            security={
              data.project.npmPackage
                ? data.packageSecurity?.[securitySummaryKey("NPM", data.project.npmPackage)] || null
                : null
            }
          />
        );
      case "pypi_downloads":
        return (
          <PyPiDownloadsCard
            stats={data.pypiStats}
            packageName={data.project.pypiPackage || "PyPI package"}
            security={
              data.project.pypiPackage
                ? data.packageSecurity?.[securitySummaryKey("PYPI", data.project.pypiPackage)] || null
                : null
            }
          />
        );
      case "rust_crates":
        return (
          <RustCratesCard
            stats={data.rustStats}
            crateName={data.project.rustCrate || "Rust crate"}
            security={
              data.project.rustCrate
                ? data.packageSecurity?.[securitySummaryKey("CARGO", data.project.rustCrate)] || null
                : null
            }
          />
        );
      case "go_module":
        return (
          <GoModuleCard
            stats={data.goStats || null}
            modulePath={data.project.goModule || "Go module"}
            security={
              data.project.goModule
                ? data.packageSecurity?.[securitySummaryKey("GO", data.project.goModule)] || null
                : null
            }
          />
        );
      case "docker_container":
        return (
          <DockerContainerCard
            stats={data.dockerStats || null}
            imageName={data.project.dockerImage || "Docker container"}
          />
        );
      case "vscode_stats":
        return (
          <VsCodeStatsCard
            stats={data.vscodeStats}
            extensionId={data.project.vscodeExtension || "Extension"}
          />
        );
      case "mcp_stats":
        return (
          <McpStatsCard
            stats={data.mcpStats}
            serverName={data.project.mcpServerName || "MCP Server"}
            projectId={data.project.id}
          />
        );
      case "revenue_stats":
        return (
          <RevenueStatsCard
            stats={data.revenueStats || null}
            projectId={data.project.id}
          />
        );
      case "web_analytics":
        return (
          <WebAnalyticsCard
            summary={data.analyticsSummary || null}
            projectSlug={data.project.slug}
          />
        );
      case "uptime_monitors":
        return (
          <UptimeMonitorsCard
            projectId={data.project.id}
            initialSummary={data.uptimeSummary || null}
            isPublicPortal={isPublicPortal}
            isDemo={isDemo}
          />
        );
      case "error_stream":
        return (
          <ErrorStreamCard
            initialErrors={data.errors}
            projectId={data.project.id}
            telemetryApiKey={data.project.telemetryApiKey || undefined}
          />
        );
      case "telemetry_setup":
        return <TelemetrySetupCard apiKey={data.project.telemetryApiKey || "YOUR_API_KEY"} />;
      case "release_health":
        return (
          <ReleaseHealthCard
            releases={data.releases || []}
            githubRepo={data.project.githubRepo}
          />
        );
      case "bug_report_badge":
        return (
          <BugReportBadgeCard
            projectSlug={data.project.slug}
            projectName={data.project.name}
          />
        );
      default:
        return null;
    }
  };

  return (
    <div className="space-y-5">
      {/* Customization Bar Meta & Hidden Widgets Restore */}
      {isCustomizing && (
        <div className="flex flex-wrap items-center justify-between gap-3 text-xs">
          <div className="flex items-center gap-2 text-zinc-400">
            <span className="px-2 py-0.5 rounded-md bg-zinc-900 border border-zinc-800 font-mono text-[11px] text-indigo-300">
              {activeCols}-Col Matrix
            </span>
            <button
              type="button"
              onClick={() => {
                const packed = packDenseLayout(desktopLayout, 12);
                setDesktopLayout(packed);
                persistLayout(packed);
              }}
              className="flex items-center gap-1 px-2.5 py-0.5 rounded-md bg-indigo-600/20 hover:bg-indigo-600/35 border border-indigo-500/40 text-indigo-200 transition text-[11px] font-medium"
            >
              <Sparkles className="w-3 h-3 text-indigo-400" />
              <span>Auto-Pack</span>
            </button>
            {!isDemo && (
              <span className="flex items-center gap-1 text-[11px] text-zinc-400">
                <Cloud className={`w-3.5 h-3.5 ${syncStatus === "error" ? "text-red-400" : "text-emerald-400"}`} />
                {syncStatus === "saving"
                  ? "Syncing layout to Turso..."
                  : syncStatus === "saved"
                  ? "Layout synced across devices"
                  : syncStatus === "error"
                  ? "Layout sync failed — check permissions"
                  : "Auto-syncs to Turso DB"}
              </span>
            )}
          </div>

          {hiddenWidgets.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 p-2.5 rounded-2xl bg-zinc-900 border border-dashed border-zinc-700">
              <div className="flex items-center gap-1.5 text-zinc-300 pr-1">
                <Eye className="w-3.5 h-3.5 text-indigo-400" />
                <span className="font-medium">Restore:</span>
              </div>
              {hiddenWidgets.map((hidden) => (
                <button
                  key={hidden.id}
                  type="button"
                  onClick={() => restoreWidget(hidden.id)}
                  className="flex items-center gap-1 px-2.5 py-1 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-200 border border-zinc-700 transition"
                >
                  <Plus className="w-3 h-3 text-emerald-400" />
                  <span>{hidden.title}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* 2D Responsive Grid Matrix (12 cols Desktop / 8 Tablet / 4 Mobile) */}
      <DndContext
        id="devpulse-2d-dnd-context"
        sensors={sensors}
        onDragStart={handleDragStart}
        onDragMove={handleDragMove}
        onDragEnd={handleDragEnd}
      >
        <div
          ref={gridContainerRef}
          data-grid-cols={activeCols}
          className={isCustomizing ? "devpulse-grid-customizing transition-all duration-300" : "transition-all duration-300"}
          style={{
            display: "grid",
            gridTemplateColumns: `repeat(${activeCols}, minmax(0, 1fr))`,
            gridAutoRows: "minmax(340px, auto)",
            gap: "24px",
            position: "relative",
          }}
        >
          {/* Ghost Drop Preview Placeholder while dragging */}
          {draggingId && dropPreview && (
            <div
              style={{
                gridColumn: `${dropPreview.x + 1} / span ${Math.min(dropPreview.w, activeCols)}`,
                gridRow: `${dropPreview.y + 1} / span ${dropPreview.h}`,
              }}
              className="rounded-2xl border-2 border-dashed border-indigo-400/90 bg-indigo-500/15 pointer-events-none z-10 transition-all duration-150 animate-pulse"
            />
          )}

          {visibleWidgets.map((widget) => (
            <SortableCard
              key={widget.id}
              id={widget.id}
              x={widget.x}
              y={widget.y}
              w={widget.w}
              h={widget.h}
              activeCols={activeCols}
              isCustomizing={isCustomizing}
              onHide={hideWidget}
              onResize={handleResizeCard}
              onMoveStep={handleMoveStep}
              gridContainerRef={gridContainerRef}
            >
              {renderWidgetContent(widget.id)}
            </SortableCard>
          ))}
        </div>
      </DndContext>
      <div className="sr-only" aria-live="polite">
        {a11yAnnouncement}
      </div>
    </div>
  );
}
