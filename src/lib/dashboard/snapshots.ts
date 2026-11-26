import { db } from "@/db";
import { dashboardWidgets, projectConnectors, projects, projectSnapshots } from "@/db/schema";
import { and, desc, eq } from "drizzle-orm";
import { decryptSecret } from "@/lib/security/crypto";
import { getUserGitHubAccessToken } from "@/lib/security/github-ownership";
import { ECOSYSTEM_WIDGET_DEFS } from "@/lib/dashboard/ecosystem-widgets";
import { fetchGitHubRepoStats, type GitHubRepoStats } from "@/lib/integrations/github";
import { fetchNpmStats, type NpmStats } from "@/lib/integrations/npm";
import { fetchPyPiStats, type PyPiStats } from "@/lib/integrations/pypi";
import { fetchRustCrateStats, type RustCrateStats } from "@/lib/integrations/crates";
import { fetchGoModuleStats, type GoModuleStats } from "@/lib/integrations/go";
import { fetchDockerRepoStats, type DockerRepoStats } from "@/lib/integrations/docker";
import { fetchVsCodeStats, type VsCodeStats } from "@/lib/integrations/vscode";
import { fetchMcpStats, type McpServerStats } from "@/lib/integrations/mcp";
import { fetchRevenueStats, type RevenueStats } from "@/lib/integrations/revenue";

export const SNAPSHOT_TTL_MS = 5 * 60 * 1000; // 5 minutes fresh threshold

export type SnapshotKey =
  | "github"
  | "npm"
  | "pypi"
  | "crates"
  | "go"
  | "docker"
  | "vscode"
  | "mcp"
  | "revenue";

export interface ProjectSnapshotBundle {
  githubStats: GitHubRepoStats | null;
  npmStats: NpmStats | null;
  pypiStats: PyPiStats | null;
  rustStats: RustCrateStats | null;
  goStats: GoModuleStats | null;
  dockerStats: DockerRepoStats | null;
  vscodeStats: VsCodeStats | null;
  mcpStats: McpServerStats | null;
  revenueStats: RevenueStats | null;
  snapshotUpdatedAt: string | null;
  isStale: boolean;
  presentKeys: Set<SnapshotKey>;
}

/**
 * Reads pre-fetched widget snapshots directly from Turso (~15ms).
 * Never triggers external HTTP calls.
 */
export async function readProjectSnapshots(projectId: string): Promise<ProjectSnapshotBundle> {
  const rows = await db
    .select()
    .from(projectSnapshots)
    .where(eq(projectSnapshots.projectId, projectId))
    .catch(() => []);

  const bundle: ProjectSnapshotBundle = {
    githubStats: null,
    npmStats: null,
    pypiStats: null,
    rustStats: null,
    goStats: null,
    dockerStats: null,
    vscodeStats: null,
    mcpStats: null,
    revenueStats: null,
    snapshotUpdatedAt: null,
    isStale: true,
    presentKeys: new Set<SnapshotKey>(),
  };

  let latestMs = 0;

  for (const row of rows) {
    let parsed: any = null;
    try {
      parsed = JSON.parse(row.payloadJson);
    } catch {
      continue;
    }

    const updatedMs = Date.parse(row.updatedAt);
    if (Number.isFinite(updatedMs) && updatedMs > latestMs) {
      latestMs = updatedMs;
      bundle.snapshotUpdatedAt = row.updatedAt;
    }

    const key = row.snapshotKey as SnapshotKey;
    bundle.presentKeys.add(key);

    if (key === "github") bundle.githubStats = parsed;
    else if (key === "npm") bundle.npmStats = parsed;
    else if (key === "pypi") bundle.pypiStats = parsed;
    else if (key === "crates") bundle.rustStats = parsed;
    else if (key === "go") bundle.goStats = parsed;
    else if (key === "docker") bundle.dockerStats = parsed;
    else if (key === "vscode") bundle.vscodeStats = parsed;
    else if (key === "mcp") bundle.mcpStats = parsed;
    else if (key === "revenue") bundle.revenueStats = parsed;
  }

  bundle.isStale = latestMs === 0 || Date.now() - latestMs > SNAPSHOT_TTL_MS;
  return bundle;
}

async function upsertSnapshot(projectId: string, key: SnapshotKey, payload: unknown) {
  if (payload === null || payload === undefined) return;
  const nowIso = new Date().toISOString();
  const id = `snap_${projectId}_${key}`;
  const json = JSON.stringify(payload);

  await db
    .insert(projectSnapshots)
    .values({
      id,
      projectId,
      snapshotKey: key,
      payloadJson: json,
      updatedAt: nowIso,
    })
    .onConflictDoUpdate({
      target: projectSnapshots.id,
      set: {
        payloadJson: json,
        updatedAt: nowIso,
      },
    })
    .catch(() => {});
}

/**
 * Fetches upstream provider stats in parallel and persists them into `project_snapshots`.
 * Used by `/api/cron/sync` and background client refresh (`/api/v1/projects/snapshots`).
 */
export async function refreshProjectSnapshots(
  projectRow: typeof projects.$inferSelect,
  options?: { userIdForOAuth?: string | null; keys?: SnapshotKey[] }
): Promise<ProjectSnapshotBundle> {
  const only = options?.keys ? new Set(options.keys) : null;
  const want = (k: SnapshotKey) => !only || only.has(k);

  const [
    userGhToken,
    projectGhToken,
    decryptedNpmToken,
    decryptedStripeKey,
    decryptedDodoKey,
    rawConnectors,
  ] = await Promise.all([
    want("github") && (options?.userIdForOAuth || projectRow.userId)
      ? getUserGitHubAccessToken(options?.userIdForOAuth || projectRow.userId).catch(() => null)
      : Promise.resolve(null),
    want("github") ? decryptSecret(projectRow.githubTokenEncrypted).catch(() => null) : Promise.resolve(null),
    want("npm") ? decryptSecret(projectRow.npmTokenEncrypted).catch(() => null) : Promise.resolve(null),
    want("revenue") ? decryptSecret(projectRow.stripeApiKey).catch(() => null) : Promise.resolve(null),
    want("revenue") ? decryptSecret(projectRow.dodoPaymentsApiKey).catch(() => null) : Promise.resolve(null),
    want("revenue") || want("docker")
      ? db
          .select()
          .from(projectConnectors)
          .where(eq(projectConnectors.projectId, projectRow.id))
          .orderBy(desc(projectConnectors.createdAt))
          .limit(30)
          .catch(() => [])
      : Promise.resolve([]),
  ]);

  const effectiveGhToken = projectGhToken || userGhToken;

  const [decryptedPaymentConnectors, decryptedDockerToken] = await Promise.all([
    want("revenue")
      ? Promise.all(
          rawConnectors
            .filter((c) => c.category === "payment")
            .map(async (c) => ({
              id: c.id,
              provider: c.provider,
              label: c.label,
              targetUrl: c.targetUrl,
              apiKey: await decryptSecret(c.credentialsEncrypted).catch(() => null),
            }))
        )
      : Promise.resolve([]),
    (() => {
      if (!want("docker")) return Promise.resolve(null);
      const dConn = rawConnectors.find(
        (c) => c.category === "package" && c.provider === "docker" && c.credentialsEncrypted
      );
      return dConn
        ? decryptSecret(dConn.credentialsEncrypted).catch(() => null)
        : Promise.resolve(null);
    })(),
  ]);

  const cap = <T>(p: Promise<T | null>, ms = 4500): Promise<T | null> =>
    Promise.race([
      p.catch(() => null),
      new Promise<null>((res) => setTimeout(() => res(null), ms)),
    ]);

  const [
    githubStats,
    npmStats,
    pypiStats,
    rustStats,
    goStats,
    dockerStats,
    vscodeStats,
    mcpStats,
    revenueStats,
  ] = await Promise.all([
    want("github") && projectRow.githubRepo
      ? cap(fetchGitHubRepoStats(projectRow.githubRepo, effectiveGhToken || undefined))
      : Promise.resolve(null),
    want("npm") && projectRow.npmPackage
      ? cap(fetchNpmStats(projectRow.npmPackage, decryptedNpmToken))
      : Promise.resolve(null),
    want("pypi") && projectRow.pypiPackage
      ? cap(fetchPyPiStats(projectRow.pypiPackage))
      : Promise.resolve(null),
    want("crates") && projectRow.rustCrate
      ? cap(fetchRustCrateStats(projectRow.rustCrate))
      : Promise.resolve(null),
    want("go") && projectRow.goModule
      ? cap(fetchGoModuleStats(projectRow.goModule))
      : Promise.resolve(null),
    want("docker") && projectRow.dockerImage
      ? cap(fetchDockerRepoStats(projectRow.dockerImage, decryptedDockerToken))
      : Promise.resolve(null),
    want("vscode") && projectRow.vscodeExtension
      ? cap(fetchVsCodeStats(projectRow.vscodeExtension))
      : Promise.resolve(null),
    want("mcp") && projectRow.mcpServerName
      ? cap(fetchMcpStats(projectRow.mcpServerName, projectRow.githubRepo))
      : Promise.resolve(null),
    want("revenue")
      ? cap(
          fetchRevenueStats({
            stripeKey: decryptedStripeKey,
            dodoKey: decryptedDodoKey,
            dodoEnv: projectRow.dodoPaymentsEnvironment,
            githubSponsorsUsername: projectRow.githubSponsorsUsername,
            modularConnectors: decryptedPaymentConnectors,
          })
        )
      : Promise.resolve(null),
  ]);

  await Promise.all([
    upsertSnapshot(projectRow.id, "github", githubStats),
    upsertSnapshot(projectRow.id, "npm", npmStats),
    upsertSnapshot(projectRow.id, "pypi", pypiStats),
    upsertSnapshot(projectRow.id, "crates", rustStats),
    upsertSnapshot(projectRow.id, "go", goStats),
    upsertSnapshot(projectRow.id, "docker", dockerStats),
    upsertSnapshot(projectRow.id, "vscode", vscodeStats),
    upsertSnapshot(projectRow.id, "mcp", mcpStats),
    upsertSnapshot(projectRow.id, "revenue", revenueStats),
  ]);

  const nowIso = new Date().toISOString();
  const presentKeys = new Set<SnapshotKey>();
  if (githubStats) presentKeys.add("github");
  if (npmStats) presentKeys.add("npm");
  if (pypiStats) presentKeys.add("pypi");
  if (rustStats) presentKeys.add("crates");
  if (goStats) presentKeys.add("go");
  if (dockerStats) presentKeys.add("docker");
  if (vscodeStats) presentKeys.add("vscode");
  if (mcpStats) presentKeys.add("mcp");
  if (revenueStats) presentKeys.add("revenue");

  return {
    githubStats,
    npmStats,
    pypiStats,
    rustStats,
    goStats,
    dockerStats,
    vscodeStats,
    mcpStats,
    revenueStats,
    snapshotUpdatedAt: nowIso,
    isStale: false,
    presentKeys,
  };
}

/**
 * Refreshes snapshots across all tracked projects during `/api/cron/sync`.
 */
export async function refreshAllProjectSnapshots(maxProjects = 25): Promise<{
  refreshed: number;
  projectIds: string[];
}> {
  const rows = await db.select().from(projects).limit(maxProjects);
  const projectIds: string[] = [];

  for (const proj of rows) {
    try {
      await refreshProjectSnapshots(proj);
      projectIds.push(proj.id);
    } catch {
      // Non-blocking cron loop
    }
  }

  return { refreshed: projectIds.length, projectIds };
}

/**
 * Ensures newly linked package/ecosystem identifiers have visible dashboard cards
 * and immediately refreshes their cached `project_snapshots` entries (or deletes
 * stale snapshots for cleared ecosystems) so Git-free package edits render live data.
 */
export async function syncEcosystemWidgetsAndSnapshots(params: {
  projectId: string;
  userIdForOAuth?: string | null;
  changedFields?: Array<(typeof ECOSYSTEM_WIDGET_DEFS)[number]["field"]>;
  skipWidgetCreation?: boolean;
}): Promise<void> {
  const [updatedProject] = await db
    .select()
    .from(projects)
    .where(eq(projects.id, params.projectId))
    .limit(1);
  if (!updatedProject) return;

  const keysToRefresh: SnapshotKey[] = [];

  if (!params.skipWidgetCreation) {
    const existingWidgets = await db
      .select({ widgetType: dashboardWidgets.widgetType, positionY: dashboardWidgets.positionY })
      .from(dashboardWidgets)
      .where(eq(dashboardWidgets.projectId, updatedProject.id))
      .catch(() => []);
    const existingTypes = new Set(existingWidgets.map((w) => w.widgetType));
    let nextY = existingWidgets.reduce((max, w) => Math.max(max, (w.positionY || 0) + 1), 0);

    for (const spec of ECOSYSTEM_WIDGET_DEFS) {
      const value = updatedProject[spec.field];
      const hasValue = typeof value === "string" && value.trim().length > 0;
      if (hasValue && !existingTypes.has(spec.widgetId)) {
        await db
          .insert(dashboardWidgets)
          .values({
            id: `w_${updatedProject.id}_${spec.widgetId}`.slice(0, 128),
            projectId: updatedProject.id,
            widgetType: spec.widgetId,
            title: spec.title,
            positionX: 0,
            positionY: nextY++,
            width: 4,
            height: 1,
            isVisible: true,
          })
          .onConflictDoNothing()
          .catch(() => {});
        existingTypes.add(spec.widgetId);
      }
    }
  }

  const candidateFields = params.changedFields && params.changedFields.length > 0
    ? params.changedFields
    : ECOSYSTEM_WIDGET_DEFS.map((d) => d.field);

  for (const field of candidateFields) {
    const spec = ECOSYSTEM_WIDGET_DEFS.find((d) => d.field === field);
    if (!spec) continue;
    const val = updatedProject[spec.field];
    if (typeof val === "string" && val.trim().length > 0) {
      keysToRefresh.push(spec.snapshotKey);
    } else {
      await db
        .delete(projectSnapshots)
        .where(
          and(
            eq(projectSnapshots.projectId, updatedProject.id),
            eq(projectSnapshots.snapshotKey, spec.snapshotKey)
          )
        )
        .catch(() => {});
    }
  }

  if (keysToRefresh.length > 0) {
    await refreshProjectSnapshots(updatedProject, {
      userIdForOAuth: params.userIdForOAuth || updatedProject.userId,
      keys: keysToRefresh,
    }).catch(() => {});
  }
}
