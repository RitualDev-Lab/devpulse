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
import { VsCodeStatsCard } from "./widgets/VsCodeStatsCard";
import { McpStatsCard } from "./widgets/McpStatsCard";
import { ErrorStreamCard, type ErrorEventItem } from "./widgets/ErrorStreamCard";
import { TelemetrySetupCard } from "./widgets/TelemetrySetupCard";
import { BugReportBadgeCard } from "./widgets/BugReportBadgeCard";
import { Plus, Eye } from "lucide-react";
import type { GitHubRepoStats } from "@/lib/integrations/github";
import type { NpmStats } from "@/lib/integrations/npm";
import type { PyPiStats } from "@/lib/integrations/pypi";
import type { VsCodeStats } from "@/lib/integrations/vscode";
import type { McpServerStats } from "@/lib/integrations/mcp";

export interface DashboardData {
  project: {
    id: string;
    name: string;
    slug: string;
    githubRepo?: string | null;
    npmPackage?: string | null;
    pypiPackage?: string | null;
    vscodeExtension?: string | null;
    mcpServerName?: string | null;
    telemetryApiKey: string;
    discordWebhookUrl?: string | null;
    slackWebhookUrl?: string | null;
    telegramBotToken?: string | null;
    telegramChatId?: string | null;
  };
  githubStats: GitHubRepoStats | null;
  npmStats: NpmStats | null;
  pypiStats: PyPiStats | null;
  vscodeStats: VsCodeStats | null;
  mcpStats: McpServerStats | null;
  errors: ErrorEventItem[];
}

interface DragDropGridProps {
  data: DashboardData;
  isCustomizing: boolean;
}

export function DragDropGrid({ data, isCustomizing }: DragDropGridProps) {
  // Determine available widgets based on what ecosystems exist (Smart Card Filter)
  const initialWidgets = [
    ...(data.project.githubRepo ? [{ id: "github_stats", title: "GitHub Stats", colSpan: 1 as const }] : []),
    ...(data.project.npmPackage ? [{ id: "npm_downloads", title: "npm Downloads", colSpan: 1 as const }] : []),
    ...(data.project.pypiPackage ? [{ id: "pypi_downloads", title: "PyPI Downloads", colSpan: 1 as const }] : []),
    ...(data.project.vscodeExtension ? [{ id: "vscode_stats", title: "VS Code Extension", colSpan: 1 as const }] : []),
    ...(data.project.mcpServerName ? [{ id: "mcp_stats", title: "MCP Server", colSpan: 1 as const }] : []),
    { id: "error_stream", title: "Runtime Crashes & Bugs", colSpan: 2 as const },
    { id: "telemetry_setup", title: "Package Crash SDK", colSpan: 1 as const },
    { id: "bug_report_badge", title: "Public Bug Report Hub", colSpan: 1 as const },
  ];

  const [items, setItems] = useState<string[]>(() => initialWidgets.map((w) => w.id));
  const [hiddenItems, setHiddenItems] = useState<string[]>([]);

  // Load saved order from localStorage
  useEffect(() => {
    try {
      const saved = localStorage.getItem(`devpulse_layout_${data.project.id}`);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) {
          // Keep only valid widget IDs
          const valid = parsed.filter((id) => initialWidgets.some((w) => w.id === id));
          if (valid.length > 0) setItems(valid);
        }
      }
    } catch {
      // Use defaults
    }
  }, [data.project.id]);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 5, // 5px movement required before drag begins
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
      case "error_stream":
        return (
          <ErrorStreamCard
            initialErrors={data.errors}
            projectId={data.project.id}
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

  const getColSpan = (id: string) => {
    if (id === "error_stream") return 2;
    return 1;
  };

  return (
    <div className="space-y-6">
      {/* Hidden Widgets Restore Bar (only shown when customizing) */}
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

      {/* Main Sortable Grid */}
      <DndContext
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
                colSpan={getColSpan(id)}
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
