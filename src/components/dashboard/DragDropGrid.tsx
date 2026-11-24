"use client";

import React, { useState, useEffect } from "react";
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
import { Plus, Eye } from "lucide-react";
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
    stripeApiKey?: string | null;
    dodoPaymentsApiKey?: string | null;
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
}

interface DragDropGridProps {
  data: DashboardData;
  isCustomizing: boolean;
}

export function DragDropGrid({ data, isCustomizing }: DragDropGridProps) {
  // Determine available widgets based on what ecosystems exist (Smart Card Filter)
  // If user has only PyPI and no npm, npm tab is omitted!
  const initialWidgets = [
    ...(data.project.githubRepo ? [{ id: "github_stats", title: "GitHub Stats", defaultColSpan: 1 as const }] : []),
    ...(data.project.npmPackage ? [{ id: "npm_downloads", title: "npm Downloads", defaultColSpan: 1 as const }] : []),
    ...(data.project.pypiPackage ? [{ id: "pypi_downloads", title: "PyPI Downloads", defaultColSpan: 1 as const }] : []),
    ...(data.project.rustCrate ? [{ id: "rust_crates", title: "Rust Crates", defaultColSpan: 1 as const }] : []),
    ...(data.project.dockerImage ? [{ id: "docker_container", title: "Docker Hub Container", defaultColSpan: 1 as const }] : []),
    ...(data.project.vscodeExtension ? [{ id: "vscode_stats", title: "VS Code Extension", defaultColSpan: 1 as const }] : []),
    ...(data.project.mcpServerName ? [{ id: "mcp_stats", title: "MCP Server", defaultColSpan: 1 as const }] : []),
    ...(data.revenueStats || data.project.stripeApiKey || data.project.dodoPaymentsApiKey
      ? [{ id: "revenue_stats", title: "Revenue & Monetization", defaultColSpan: 2 as const }]
      : []),
    { id: "web_analytics", title: "Cookie-Free Web Traffic", defaultColSpan: 1 as const },
    { id: "error_stream", title: "Runtime Crashes & Bugs", defaultColSpan: 2 as const },
    { id: "telemetry_setup", title: "Package Crash SDK", defaultColSpan: 1 as const },
    { id: "bug_report_badge", title: "Public Bug Report Hub", defaultColSpan: 1 as const },
  ];

  const [items, setItems] = useState<string[]>(() => initialWidgets.map((w) => w.id));
  const [hiddenItems, setHiddenItems] = useState<string[]>([]);
  const [colSpans, setColSpans] = useState<Record<string, 1 | 2 | 3>>({});

  // Load saved order & resizable card sizes from localStorage
  useEffect(() => {
    try {
      const savedLayout = localStorage.getItem(`devpulse_layout_${data.project.id}`);
      if (savedLayout) {
        const parsed = JSON.parse(savedLayout);
        if (Array.isArray(parsed) && parsed.length > 0) {
          const valid = parsed.filter((id) => initialWidgets.some((w) => w.id === id));
          if (valid.length > 0) setItems(valid);
        }
      }

      const savedSpans = localStorage.getItem(`devpulse_colspans_${data.project.id}`);
      if (savedSpans) {
        const parsedSpans = JSON.parse(savedSpans);
        if (parsedSpans && typeof parsedSpans === "object") {
          setColSpans(parsedSpans);
        }
      }
    } catch {
      // Use defaults
    }
  }, [data.project.id]);

  const handleResizeCard = (id: string, newSpan: 1 | 2 | 3) => {
    setColSpans((prev) => {
      const updated = { ...prev, [id]: newSpan };
      try {
        localStorage.setItem(`devpulse_colspans_${data.project.id}`, JSON.stringify(updated));
      } catch {
        // ignore
      }
      return updated;
    });
  };

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 5,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      setItems((prevItems) => {
        const oldIndex = prevItems.indexOf(String(active.id));
        const newIndex = prevItems.indexOf(String(over.id));
        const newOrder = arrayMove(prevItems, oldIndex, newIndex);
        try {
          localStorage.setItem(
            `devpulse_layout_${data.project.id}`,
            JSON.stringify(newOrder)
          );
        } catch {
          // ignore
        }
        return newOrder;
      });
    }
  };

  const hideWidget = (id: string) => {
    setItems((prev) => prev.filter((item) => item !== id));
    setHiddenItems((prev) => [...prev, id]);
  };

  const restoreWidget = (id: string) => {
    setHiddenItems((prev) => prev.filter((item) => item !== id));
    setItems((prev) => [...prev, id]);
  };

  // Render individual widget by ID
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

  const getEffectiveColSpan = (id: string): 1 | 2 | 3 => {
    if (colSpans[id]) return colSpans[id];
    if (id === "error_stream" || id === "revenue_stats") return 2;
    return 1;
  };

  return (
    <div className="space-y-6">
      {/* Hidden Widgets Restore Bar */}
      {isCustomizing && hiddenItems.length > 0 && (
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
                <span className="capitalize">{hiddenId.replace("_", " ")}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Main Sortable & Resizable Grid */}
      <DndContext
        id="devpulse-dnd-context"
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={handleDragEnd}
      >
        <SortableContext items={items} strategy={rectSortingStrategy}>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {items.map((id) => (
              <SortableCard
                key={id}
                id={id}
                isCustomizing={isCustomizing}
                onHide={hideWidget}
                colSpan={getEffectiveColSpan(id)}
                onResize={handleResizeCard}
              >
                {renderWidgetContent(id)}
              </SortableCard>
            ))}
          </div>
        </SortableContext>
      </DndContext>
    </div>
  );
}
