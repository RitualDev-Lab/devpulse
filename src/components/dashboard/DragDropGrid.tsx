"use client";

import React, { useState, useEffect, useRef } from "react";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  rectSortingStrategy,
} from "@dnd-kit/sortable";
import { SortableCard, type GridSpan } from "./SortableCard";
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
import { Plus, Eye, Save, Check } from "lucide-react";
import type { GitHubRepoStats } from "@/lib/integrations/github";
import type { NpmStats } from "@/lib/integrations/npm";
import type { PyPiStats } from "@/lib/integrations/pypi";
import type { RustCrateStats } from "@/lib/integrations/crates";
import type { GoModuleStats } from "@/lib/integrations/go";
import type { DockerRepoStats } from "@/lib/integrations/docker";
import type { VsCodeStats } from "@/lib/integrations/vscode";
import type { McpServerStats } from "@/lib/integrations/mcp";
import type { RevenueStats } from "@/lib/integrations/revenue";
import type { WidgetLayoutItem } from "@/app/api/v1/projects/layout/route";

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
    telemetryApiKey?: string;
    isPublic?: boolean;
    theme?: string;
    customCss?: string | null;
    discordWebhookUrl?: string | null;
    slackWebhookUrl?: string | null;
    telegramBotToken?: string | null;
    telegramChatId?: string | null;
    stripeApiKey?: string | null;
    dodoPaymentsApiKey?: string | null;
    hasStripeKey?: boolean;
    hasDodoKey?: boolean;
  };
  githubStats: GitHubRepoStats | null;
  npmStats: NpmStats | null;
  pypiStats: PyPiStats | null;
  rustStats: RustCrateStats | null;
  goStats?: GoModuleStats | null;
  dockerStats?: DockerRepoStats | null;
  vscodeStats: VsCodeStats | null;
  mcpStats: McpServerStats | null;
  analyticsSummary?: AnalyticsSummary | null;
  revenueStats?: RevenueStats | null;
  errors: ErrorEventItem[];
  initialLayout?: WidgetLayoutItem[];
}

interface DragDropGridProps {
  data: DashboardData;
  isCustomizing: boolean;
  readOnly?: boolean;
  isDemo?: boolean;
}

const WIDGET_ALIAS: Record<string, string> = {
  vscode_installs: "vscode_stats",
  mcp_servers: "mcp_stats",
};

function normalizeWidgetId(raw: string): string {
  return WIDGET_ALIAS[raw] || raw;
}

function defaultSpanFor(id: string): GridSpan {
  if (id === "error_stream" || id === "revenue_stats") {
    return { w: 8, h: 1 };
  }
  return { w: 4, h: 1 };
}

export function DragDropGrid({
  data,
  isCustomizing,
  readOnly = false,
  isDemo = false,
}: DragDropGridProps) {
  const availableWidgets = [
    ...(data.project.githubRepo ? [{ id: "github_stats", title: "GitHub Stats" }] : []),
    ...(data.project.npmPackage ? [{ id: "npm_downloads", title: "npm Downloads" }] : []),
    ...(data.project.pypiPackage ? [{ id: "pypi_downloads", title: "PyPI Downloads" }] : []),
    ...(data.project.rustCrate ? [{ id: "rust_crates", title: "Rust Crates" }] : []),
    ...(data.project.goModule ? [{ id: "go_module", title: "Go Module" }] : []),
    ...(data.project.dockerImage ? [{ id: "docker_container", title: "Docker Hub Container" }] : []),
    ...(data.project.vscodeExtension ? [{ id: "vscode_stats", title: "VS Code & Open VSX" }] : []),
    ...(data.project.mcpServerName ? [{ id: "mcp_stats", title: "MCP Server" }] : []),
    ...(!readOnly && (data.revenueStats || data.project.hasStripeKey || data.project.hasDodoKey || data.project.stripeApiKey || data.project.dodoPaymentsApiKey)
      ? [{ id: "revenue_stats", title: "Revenue & Monetization" }]
      : []),
    { id: "web_analytics", title: "Cookie-Free Web Traffic" },
    { id: "error_stream", title: "Runtime Crashes & Bugs" },
    ...(!readOnly && data.project.telemetryApiKey
      ? [{ id: "telemetry_setup", title: "Package Crash SDK" }]
      : []),
    { id: "bug_report_badge", title: "Public Bug Report Hub" },
  ];

  const availableIds = availableWidgets.map((w) => w.id);

  const buildInitialState = () => {
    const dbLayout = Array.isArray(data.initialLayout) ? data.initialLayout : [];
    const spans: Record<string, GridSpan> = {};
    for (const id of availableIds) spans[id] = defaultSpanFor(id);

    if (dbLayout.length > 0) {
      const sortedDb = [...dbLayout].sort((a, b) => (a.y - b.y) || (a.x - b.x));
      const visible: string[] = [];
      const hidden: string[] = [];

      for (const row of sortedDb) {
        const nid = normalizeWidgetId(row.widgetType);
        if (!availableIds.includes(nid)) continue;
        spans[nid] = {
          w:
            row.w === 1
              ? 4
              : row.w === 2
                ? 8
                : row.w === 3
                  ? 12
                  : Math.max(4, Math.min(12, row.w || 4)),
          h: Math.max(1, Math.min(3, row.h || 1)),
        };
        if (row.isVisible === false) {
          if (!hidden.includes(nid)) hidden.push(nid);
        } else {
          if (!visible.includes(nid)) visible.push(nid);
        }
      }

      // Append any newly enabled ecosystem widgets not yet saved in DB
      for (const id of availableIds) {
        if (!visible.includes(id) && !hidden.includes(id)) {
          visible.push(id);
        }
      }
      return { visible, hidden, spans };
    }

    return { visible: availableIds, hidden: [] as string[], spans };
  };

  const initial = buildInitialState();
  const [items, setItems] = useState<string[]>(initial.visible);
  const [hiddenItems, setHiddenItems] = useState<string[]>(initial.hidden);
  const [spans, setSpans] = useState<Record<string, GridSpan>>(initial.spans);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved">("idle");
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Sync localStorage fallback for demo/offline mode when DB layout is empty
  useEffect(() => {
    if (readOnly || (data.initialLayout && data.initialLayout.length > 0)) return;
    const frame = requestAnimationFrame(() => {
      try {
        const savedLayout = localStorage.getItem(`devpulse_layout_v2_${data.project.id}`);
        if (savedLayout) {
          const parsed = JSON.parse(savedLayout);
          if (Array.isArray(parsed?.items)) {
            const valid = parsed.items.filter((id: string) => availableIds.includes(id));
            const missing = availableIds.filter(
              (id) => !valid.includes(id) && !(parsed.hidden || []).includes(id)
            );
            if (valid.length > 0) setItems([...valid, ...missing]);
          }
          if (Array.isArray(parsed?.hidden)) {
            setHiddenItems(parsed.hidden.filter((id: string) => availableIds.includes(id)));
          }
          if (parsed?.spans && typeof parsed.spans === "object") {
            setSpans((prev) => ({ ...prev, ...parsed.spans }));
          }
        }
      } catch {
        // Ignore storage error
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [data.project.id]);

  const persistLayout = (
    nextItems: string[],
    nextHidden: string[],
    nextSpans: Record<string, GridSpan>
  ) => {
    if (readOnly) return;

    try {
      localStorage.setItem(
        `devpulse_layout_v2_${data.project.id}`,
        JSON.stringify({ items: nextItems, hidden: nextHidden, spans: nextSpans })
      );
    } catch {
      // Ignore localStorage failures
    }

    if (isDemo) return;

    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    setSaveState("saving");
    saveTimerRef.current = setTimeout(async () => {
      try {
        const payloadWidgets: WidgetLayoutItem[] = [
          ...nextItems.map((id, idx) => ({
            widgetType: id,
            title: availableWidgets.find((w) => w.id === id)?.title || id,
            x: (idx * 4) % 12,
            y: idx,
            w: nextSpans[id]?.w || 4,
            h: nextSpans[id]?.h || 1,
            isVisible: true,
          })),
          ...nextHidden.map((id, idx) => ({
            widgetType: id,
            title: availableWidgets.find((w) => w.id === id)?.title || id,
            x: 0,
            y: nextItems.length + idx,
            w: nextSpans[id]?.w || 4,
            h: nextSpans[id]?.h || 1,
            isVisible: false,
          })),
        ];

        const res = await fetch("/api/v1/projects/layout", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            projectId: data.project.id,
            widgets: payloadWidgets,
          }),
        });
        setSaveState(res.ok ? "saved" : "idle");
        setTimeout(() => setSaveState("idle"), 1500);
      } catch {
        setSaveState("idle");
      }
    }, 350);
  };

  const handleResizeCard = (id: string, nextSpan: GridSpan) => {
    setSpans((prev) => {
      const updated = { ...prev, [id]: nextSpan };
      persistLayout(items, hiddenItems, updated);
      return updated;
    });
  };

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      setItems((prevItems) => {
        const oldIndex = prevItems.indexOf(String(active.id));
        const newIndex = prevItems.indexOf(String(over.id));
        const newOrder = arrayMove(prevItems, oldIndex, newIndex);
        persistLayout(newOrder, hiddenItems, spans);
        return newOrder;
      });
    }
  };

  const hideWidget = (id: string) => {
    const nextItems = items.filter((item) => item !== id);
    const nextHidden = hiddenItems.includes(id) ? hiddenItems : [...hiddenItems, id];
    setItems(nextItems);
    setHiddenItems(nextHidden);
    persistLayout(nextItems, nextHidden, spans);
  };

  const restoreWidget = (id: string) => {
    const nextHidden = hiddenItems.filter((item) => item !== id);
    const nextItems = items.includes(id) ? items : [...items, id];
    setHiddenItems(nextHidden);
    setItems(nextItems);
    persistLayout(nextItems, nextHidden, spans);
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
      case "go_module":
        return (
          <GoModuleCard
            stats={data.goStats || null}
            modulePath={data.project.goModule || "Go module"}
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
        return <TelemetrySetupCard apiKey={data.project.telemetryApiKey || ""} />;
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
    <div className="space-y-6">
      {/* Customization Status & Persistence Pill */}
      {isCustomizing && !readOnly && (
        <div className="flex items-center justify-between text-xs text-zinc-400 px-1">
          <span>
            Drag cards via the top-right grip or drag any bottom-right corner handle to resize across 12 columns &times; 3 rows.
          </span>
          <span className="flex items-center gap-1.5 font-mono text-[11px]">
            {saveState === "saving" && (
              <>
                <Save className="w-3.5 h-3.5 text-indigo-400 animate-pulse" />
                <span className="text-indigo-300">Saving layout to Turso...</span>
              </>
            )}
            {saveState === "saved" && (
              <>
                <Check className="w-3.5 h-3.5 text-emerald-400" />
                <span className="text-emerald-400">Layout Synced</span>
              </>
            )}
          </span>
        </div>
      )}

      {/* Hidden Widgets Restore Bar */}
      {isCustomizing && !readOnly && hiddenItems.length > 0 && (
        <div className="p-3.5 rounded-2xl bg-zinc-900 border border-dashed border-zinc-700 flex items-center justify-between gap-3 text-xs">
          <div className="flex items-center gap-2 text-zinc-300">
            <Eye className="w-4 h-4 text-indigo-400" />
            <span className="font-medium">Hidden Widgets:</span>
          </div>
          <div className="flex flex-wrap gap-2">
            {hiddenItems.map((hiddenId) => (
              <button
                key={hiddenId}
                onClick={() => restoreWidget(hiddenId)}
                className="flex items-center gap-1.5 px-2.5 py-1 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-200 border border-zinc-700 transition"
              >
                <Plus className="w-3.5 h-3.5 text-emerald-400" />
                <span className="capitalize">{hiddenId.replace(/_/g, " ")}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Main 12-Column 2D Drag & Corner-Resize Grid */}
      <DndContext
        id="devpulse-dnd-context"
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={handleDragEnd}
      >
        <SortableContext items={items} strategy={rectSortingStrategy}>
          <div className="grid grid-cols-1 md:grid-cols-12 auto-rows-[minmax(190px,auto)] gap-5 grid-flow-dense">
            {items.map((id) => {
              const span = spans[id] || defaultSpanFor(id);
              return (
                <SortableCard
                  key={id}
                  id={id}
                  isCustomizing={isCustomizing}
                  readOnly={readOnly}
                  onHide={hideWidget}
                  w={span.w}
                  h={span.h}
                  onResize={handleResizeCard}
                >
                  {renderWidgetContent(id)}
                </SortableCard>
              );
            })}
          </div>
        </SortableContext>
      </DndContext>
    </div>
  );
}
