"use client";

import React, { useState, useEffect, useRef, useMemo } from "react";
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
import { DockerContainerCard } from "./widgets/DockerContainerCard";
import { VsCodeStatsCard } from "./widgets/VsCodeStatsCard";
import { McpStatsCard } from "./widgets/McpStatsCard";
import { RevenueStatsCard } from "./widgets/RevenueStatsCard";
import { WebAnalyticsCard, type AnalyticsSummary } from "./widgets/WebAnalyticsCard";
import { ErrorStreamCard, type ErrorEventItem } from "./widgets/ErrorStreamCard";
import { TelemetrySetupCard } from "./widgets/TelemetrySetupCard";
import { BugReportBadgeCard } from "./widgets/BugReportBadgeCard";
import { Plus, Eye, Cloud } from "lucide-react";
import {
  buildDefaultLayout,
  resolveCollisionAndReflow,
  adaptLayoutForColumns,
  compactLayout,
  type GridWidgetItem,
} from "@/lib/layout/grid-engine";
import type { GitHubRepoStats } from "@/lib/integrations/github";
import type { NpmStats } from "@/lib/integrations/npm";
import type { PyPiStats } from "@/lib/integrations/pypi";
import type { RustCrateStats } from "@/lib/integrations/crates";
import type { DockerRepoStats } from "@/lib/integrations/docker";
import type { VsCodeStats } from "@/lib/integrations/vscode";
import type { McpServerStats } from "@/lib/integrations/mcp";
import type { RevenueStats } from "@/lib/integrations/revenue";

export interface DashboardData {
  project: {
    id: string;
    name: string;
    slug: string;
    githubRepo?: string | null;
    npmPackage?: string | null;
    pypiPackage?: string | null;
    rustCrate?: string | null;
    goModule?: string | null;
    dockerImage?: string | null;
    vscodeExtension?: string | null;
    mcpServerName?: string | null;
    telemetryApiKey: string;
    discordWebhookUrl?: string | null;
    slackWebhookUrl?: string | null;
    telegramBotToken?: string | null;
    telegramChatId?: string | null;
    genericWebhookUrl?: string | null;
    stripeApiKey?: string | null;
    dodoPaymentsApiKey?: string | null;
    theme?: string | null;
    customCss?: string | null;
  };
  githubStats: GitHubRepoStats | null;
  npmStats: NpmStats | null;
  pypiStats: PyPiStats | null;
  rustStats: RustCrateStats | null;
  dockerStats?: DockerRepoStats | null;
  vscodeStats: VsCodeStats | null;
  mcpStats: McpServerStats | null;
  analyticsSummary?: AnalyticsSummary | null;
  revenueStats?: RevenueStats | null;
  errors: ErrorEventItem[];
  initialLayout?: GridWidgetItem[];
}

interface DragDropGridProps {
  data: DashboardData;
  isCustomizing: boolean;
  isDemo?: boolean;
}

export function DragDropGrid({ data, isCustomizing, isDemo = false }: DragDropGridProps) {
  const gridContainerRef = useRef<HTMLDivElement | null>(null);
  const [activeCols, setActiveCols] = useState<12 | 8 | 4>(12);
  const [syncStatus, setSyncStatus] = useState<"idle" | "saving" | "saved">("idle");
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
      ...(data.project.githubRepo
        ? [{ id: "github_stats", title: "GitHub Stats", defaultW: 4, defaultH: 1 }]
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
      { id: "error_stream", title: "Runtime Crashes & Bugs", defaultW: 8, defaultH: 1 },
      { id: "telemetry_setup", title: "Package Crash SDK", defaultW: 4, defaultH: 1 },
      { id: "bug_report_badge", title: "Public Bug Report Hub", defaultW: 4, defaultH: 1 },
    ],
    [data]
  );

  // Build canonical 12-col layout merging saved DB layout with available ecosystem widgets
  const computeInitialLayout = (): GridWidgetItem[] => {
    const dbRows = data.initialLayout || [];
    // Ignore pre-Phase-4 legacy 4-col rows (width < 3) so cards never render squished in 12-col matrix
    const hasValid2DLayout = dbRows.length > 0 && dbRows.every((r) => r.w >= 3);
    if (hasValid2DLayout) {
      const merged: GridWidgetItem[] = [];
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
          merged.push({
            id: def.id,
            title: def.title,
            x: 0,
            y: 99,
            w: def.defaultW,
            h: def.defaultH,
            isVisible: true,
          });
        }
      }
      return compactLayout(merged, 12);
    }
    return buildDefaultLayout(availableDefs);
  };

  const [desktopLayout, setDesktopLayout] = useState<GridWidgetItem[]>(computeInitialLayout);

  // Sync local layout if project changes or localStorage fallback exists (when no DB layout)
  useEffect(() => {
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
              setDesktopLayout(compactLayout(filtered, 12));
              return;
            }
          }
        }
      } catch {
        // fallback to default
      }
    }
    setDesktopLayout(initial);
  }, [data.project.id]);

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
        setTimeout(() => setSyncStatus("idle"), 2000);
      } else {
        setSyncStatus("idle");
      }
    } catch {
      setSyncStatus("idle");
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
    const updated = compactLayout(
      desktopLayout.map((w) => (w.id === id ? { ...w, isVisible: false } : w)),
      12
    );
    setDesktopLayout(updated);
    persistLayout(updated);
  };

  const restoreWidget = (id: string) => {
    const def = availableDefs.find((d) => d.id === id);
    const updated = resolveCollisionAndReflow(
      desktopLayout.map((w) =>
        w.id === id ? { ...w, isVisible: true, w: w.w || def?.defaultW || 4, h: w.h || 1 } : w
      ),
      id,
      { y: 99 },
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
            repoName={data.project.githubRepo || "Repository"}
          />
        );
      case "npm_downloads":
        return (
          <NpmDownloadsCard
            stats={data.npmStats}
            packageName={data.project.npmPackage || "npm package"}
          />
        );
      case "pypi_downloads":
        return (
          <PyPiDownloadsCard
            stats={data.pypiStats}
            packageName={data.project.pypiPackage || "PyPI package"}
          />
        );
      case "rust_crates":
        return (
          <RustCratesCard
            stats={data.rustStats}
            crateName={data.project.rustCrate || "Rust crate"}
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
      case "error_stream":
        return (
          <ErrorStreamCard
            initialErrors={data.errors}
            projectId={data.project.id}
            telemetryApiKey={data.project.telemetryApiKey}
          />
        );
      case "telemetry_setup":
        return <TelemetrySetupCard apiKey={data.project.telemetryApiKey} />;
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
            {!isDemo && (
              <span className="flex items-center gap-1 text-[11px] text-zinc-400">
                <Cloud className="w-3.5 h-3.5 text-emerald-400" />
                {syncStatus === "saving"
                  ? "Syncing layout to Turso..."
                  : syncStatus === "saved"
                  ? "Layout synced across devices"
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
              className="rounded-2xl border-2 border-dashed border-indigo-400/80 bg-indigo-500/10 pointer-events-none z-10 transition-all duration-100"
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
              gridContainerRef={gridContainerRef}
            >
              {renderWidgetContent(widget.id)}
            </SortableCard>
          ))}
        </div>
      </DndContext>
    </div>
  );
}
