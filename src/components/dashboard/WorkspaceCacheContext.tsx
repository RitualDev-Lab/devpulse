"use client";

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { LoadedWorkspaceReady } from "@/lib/dashboard/load-workspace";
import type { DashboardData } from "./DragDropGrid";

export type WorkspaceInitialData = (
  | LoadedWorkspaceReady["initialData"]
  | DashboardData
) & {
  staleSnapshots?: boolean;
  snapshotUpdatedAt?: string | null;
  connectors?: LoadedWorkspaceReady["initialData"]["connectors"];
  customMetrics?: LoadedWorkspaceReady["initialData"]["customMetrics"];
  sourceMaps?: LoadedWorkspaceReady["initialData"]["sourceMaps"];
  githubHistory?: LoadedWorkspaceReady["initialData"]["githubHistory"];
  packageHistory?: LoadedWorkspaceReady["initialData"]["packageHistory"];
};

interface WorkspaceCacheContextValue {
  cacheByProject: Record<string, WorkspaceInitialData>;
  mergeServerSlice: (projectId: string, slice: WorkspaceInitialData) => void;
  refreshProjectSnapshotsBg: (projectId: string) => void;
}

const WorkspaceCacheContext = createContext<WorkspaceCacheContextValue>({
  cacheByProject: {},
  mergeServerSlice: () => {},
  refreshProjectSnapshotsBg: () => {},
});

const CLIENT_REFRESH_COOLDOWN_MS = 60_000;

/**
 * Merges a newly fetched scoped SSR slice into the client cache without clobbering
 * already-cached widgets that the scoped sub-route intentionally skipped loading.
 */
function mergeWorkspaceSlices(
  prev: WorkspaceInitialData | undefined,
  next: WorkspaceInitialData
): WorkspaceInitialData {
  if (!prev || prev.project?.id !== next.project?.id) {
    return next;
  }

  return {
    ...prev,
    ...next,
    project: {
      ...prev.project,
      ...next.project,
    },
    githubStats: next.githubStats ?? prev.githubStats,
    npmStats: next.npmStats ?? prev.npmStats,
    pypiStats: next.pypiStats ?? prev.pypiStats,
    rustStats: next.rustStats ?? prev.rustStats,
    goStats: next.goStats ?? prev.goStats,
    dockerStats: next.dockerStats ?? prev.dockerStats,
    vscodeStats: next.vscodeStats ?? prev.vscodeStats,
    mcpStats: next.mcpStats ?? prev.mcpStats,
    revenueStats: next.revenueStats ?? prev.revenueStats,
    analyticsSummary:
      next.analyticsSummary && next.analyticsSummary.totalPageviews > 0
        ? next.analyticsSummary
        : prev.analyticsSummary && prev.analyticsSummary.totalPageviews > 0
        ? prev.analyticsSummary
        : next.analyticsSummary ?? prev.analyticsSummary,
    uptimeSummary:
      next.uptimeSummary && next.uptimeSummary.monitors.length > 0
        ? next.uptimeSummary
        : prev.uptimeSummary ?? next.uptimeSummary,
    errors:
      next.errors && next.errors.length > 0
        ? next.errors
        : prev.errors ?? next.errors,
    releases:
      next.releases && next.releases.length > 0
        ? next.releases
        : prev.releases ?? next.releases,
    initialLayout:
      next.initialLayout && next.initialLayout.length > 0
        ? next.initialLayout
        : prev.initialLayout ?? next.initialLayout,
    connectors:
      next.connectors && next.connectors.length > 0
        ? next.connectors
        : prev.connectors ?? next.connectors,
    customMetrics:
      next.customMetrics && next.customMetrics.length > 0
        ? next.customMetrics
        : prev.customMetrics ?? next.customMetrics,
    sourceMaps:
      next.sourceMaps && next.sourceMaps.length > 0
        ? next.sourceMaps
        : prev.sourceMaps ?? next.sourceMaps,
    githubHistory:
      next.githubHistory &&
      (next.githubHistory.starsDaily.length > 0 ||
        next.githubHistory.clonesDaily.length > 0 ||
        next.githubHistory.viewsDaily.length > 0)
        ? next.githubHistory
        : prev.githubHistory ?? next.githubHistory,
    packageHistory:
      next.packageHistory && next.packageHistory.length > 0
        ? next.packageHistory
        : prev.packageHistory ?? next.packageHistory,
  };
}

export function WorkspaceCacheProvider({
  isAuthenticated = false,
  children,
}: {
  isAuthenticated?: boolean;
  children: React.ReactNode;
}) {
  const [cacheByProject, setCacheByProject] = useState<
    Record<string, WorkspaceInitialData>
  >({});
  const lastRefreshRef = useRef<Record<string, number>>({});
  const sessionSyncedRef = useRef(false);

  // Stamp Edge Session Cookie Cache once per browser tab mount if signed in
  useEffect(() => {
    if (!isAuthenticated || sessionSyncedRef.current) return;
    sessionSyncedRef.current = true;
    fetch("/api/auth/session-cache", { method: "POST" }).catch(() => {});
  }, [isAuthenticated]);

  const mergeServerSlice = useCallback(
    (projectId: string, slice: WorkspaceInitialData) => {
      setCacheByProject((prev) => ({
        ...prev,
        [projectId]: mergeWorkspaceSlices(prev[projectId], slice),
      }));
    },
    []
  );

  const refreshProjectSnapshotsBg = useCallback((projectId: string) => {
    if (!projectId) return;
    const now = Date.now();
    const last = lastRefreshRef.current[projectId] || 0;
    if (now - last < CLIENT_REFRESH_COOLDOWN_MS) return;
    lastRefreshRef.current[projectId] = now;

    fetch(`/api/v1/projects/snapshots?projectId=${encodeURIComponent(projectId)}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((fresh) => {
        if (!fresh) return;
        setCacheByProject((prev) => {
          const existing = prev[projectId];
          if (!existing) return prev;
          return {
            ...prev,
            [projectId]: {
              ...existing,
              githubStats: fresh.githubStats ?? existing.githubStats,
              npmStats: fresh.npmStats ?? existing.npmStats,
              pypiStats: fresh.pypiStats ?? existing.pypiStats,
              rustStats: fresh.rustStats ?? existing.rustStats,
              goStats: fresh.goStats ?? existing.goStats,
              dockerStats: fresh.dockerStats ?? existing.dockerStats,
              vscodeStats: fresh.vscodeStats ?? existing.vscodeStats,
              mcpStats: fresh.mcpStats ?? existing.mcpStats,
              revenueStats: fresh.revenueStats ?? existing.revenueStats,
              snapshotUpdatedAt: fresh.snapshotUpdatedAt ?? existing.snapshotUpdatedAt,
              staleSnapshots: false,
            },
          };
        });
      })
      .catch(() => {});
  }, []);

  const value = useMemo(
    () => ({ cacheByProject, mergeServerSlice, refreshProjectSnapshotsBg }),
    [cacheByProject, mergeServerSlice, refreshProjectSnapshotsBg]
  );

  return (
    <WorkspaceCacheContext.Provider value={value}>
      {children}
    </WorkspaceCacheContext.Provider>
  );
}

/**
 * SWR-style hook used by Dashboard views: returns merged cached workspace data immediately
 * and silently triggers background snapshot refresh when `staleSnapshots` is true.
 */
export function useWorkspaceData<T extends WorkspaceInitialData>(
  serverData: T
): T {
  const { cacheByProject, mergeServerSlice, refreshProjectSnapshotsBg } =
    useContext(WorkspaceCacheContext);
  const projectId = serverData.project.id;

  useEffect(() => {
    mergeServerSlice(projectId, serverData);
    if (serverData.staleSnapshots) {
      refreshProjectSnapshotsBg(projectId);
    }
  }, [
    projectId,
    serverData,
    mergeServerSlice,
    refreshProjectSnapshotsBg,
  ]);

  const cached = cacheByProject[projectId];
  return (cached ? mergeWorkspaceSlices(cached, serverData) : serverData) as T;
}
