import { db } from "@/db";
import { dashboardWidgets, projectConnectors, projects, projectSnapshots } from "@/db/schema";
import { and, desc, eq } from "drizzle-orm";
import { decryptSecret } from "@/lib/security/crypto";
import { getUserGitHubAccessToken } from "@/lib/security/github-ownership";
import { ECOSYSTEM_WIDGET_DEFS } from "@/lib/dashboard/ecosystem-widgets";
import { fetchGitRepoStats, resolveProjectGitConfig, type GitRepoStats } from "@/lib/integrations/git-provider";
import type { GitHubRepoStats } from "@/lib/integrations/github";
import { fetchNpmStats, type NpmStats } from "@/lib/integrations/npm";
import { fetchPyPiStats, type PyPiStats } from "@/lib/integrations/pypi";
import { fetchRustCrateStats, type RustCrateStats } from "@/lib/integrations/crates";
import { fetchGoModuleStats, type GoModuleStats } from "@/lib/integrations/go";
import { fetchDockerRepoStats, type DockerRepoStats } from "@/lib/integrations/docker";
import { fetchVsCodeStats, type VsCodeStats } from "@/lib/integrations/vscode";
import { fetchMcpStats, type McpServerStats } from "@/lib/integrations/mcp";
import { fetchRevenueStats, type RevenueStats } from "@/lib/integrations/revenue";
import { fetchNuGetStats } from "@/lib/integrations/nuget";
import { fetchRubyGemStats } from "@/lib/integrations/rubygems";
import { fetchPackagistStats } from "@/lib/integrations/packagist";
import { fetchPubDevStats } from "@/lib/integrations/pubdev";
import { fetchJsrStats } from "@/lib/integrations/jsr";
import { fetchHexStats } from "@/lib/integrations/hex";
import { fetchAnacondaStats } from "@/lib/integrations/anaconda";
import { fetchCranStats } from "@/lib/integrations/cran";
import { fetchHomebrewStats } from "@/lib/integrations/homebrew";
import { fetchMavenStats } from "@/lib/integrations/maven";
import { fetchCppPackageStats } from "@/lib/integrations/cpp";
import { fetchSwiftStats } from "@/lib/integrations/swift";
import { fetchHackageStats } from "@/lib/integrations/hackage";
import { fetchMetaCpanStats } from "@/lib/integrations/metacpan";
import { fetchLuaRocksStats } from "@/lib/integrations/luarocks";
import { fetchJuliaStats } from "@/lib/integrations/julia";
import { fetchDepsDevSummary, type DepsDevAdvisorySummary, type DepsDevSystem } from "@/lib/integrations/deps-dev";
import {
  REGISTRY_ADAPTERS,
  normalizeRegistryProvider,
  securitySummaryKey,
  type ExtraPackageSnapshot,
} from "@/lib/integrations/registry-adapter";

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
  | "revenue"
  | "security"
  | "package_connectors";

export interface ProjectSnapshotBundle {
  githubStats: (GitHubRepoStats & Partial<Pick<GitRepoStats, "provider" | "baseUrl" | "webUrl" | "pipelineStatus">>) | null;
  npmStats: NpmStats | null;
  pypiStats: PyPiStats | null;
  rustStats: RustCrateStats | null;
  goStats: GoModuleStats | null;
  dockerStats: DockerRepoStats | null;
  vscodeStats: VsCodeStats | null;
  mcpStats: McpServerStats | null;
  revenueStats: RevenueStats | null;
  packageSecurity: Record<string, DepsDevAdvisorySummary>;
  extraPackages: ExtraPackageSnapshot[];
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
    packageSecurity: {},
    extraPackages: [],
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
    else if (key === "security" && parsed && typeof parsed === "object") {
      bundle.packageSecurity = parsed as Record<string, DepsDevAdvisorySummary>;
    } else if (key === "package_connectors" && Array.isArray(parsed)) {
      bundle.extraPackages = parsed as ExtraPackageSnapshot[];
    }
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
    want("revenue") || want("docker") || want("package_connectors") || want("github")
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

  const [decryptedPaymentConnectors, decryptedDockerToken, decryptedGitConnectorToken] = await Promise.all([
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
    (() => {
      if (!want("github")) return Promise.resolve(null);
      const gitConn = rawConnectors.find((c) => c.category === "git" && c.credentialsEncrypted);
      return gitConn
        ? decryptSecret(gitConn.credentialsEncrypted).catch(() => null)
        : Promise.resolve(null);
    })(),
  ]);

  const resolvedGitConfig = want("github")
    ? resolveProjectGitConfig({
        githubRepo: projectRow.githubRepo,
        githubToken: effectiveGhToken,
        connectors: rawConnectors,
        gitConnectorToken: decryptedGitConnectorToken,
      })
    : null;

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
    want("github") && resolvedGitConfig
      ? cap(fetchGitRepoStats(resolvedGitConfig))
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

  const existingBundle = await readProjectSnapshots(projectRow.id).catch(() => null);
  const existingSecurity = { ...(existingBundle?.packageSecurity || {}) };
  let extraPackages: ExtraPackageSnapshot[] = existingBundle?.extraPackages || [];

  const securityTargets: Array<{ system: DepsDevSystem; name: string }> = [];
  if (want("security") || want("npm")) {
    if (projectRow.npmPackage) securityTargets.push({ system: "NPM", name: projectRow.npmPackage });
  }
  if (want("security") || want("pypi")) {
    if (projectRow.pypiPackage) securityTargets.push({ system: "PYPI", name: projectRow.pypiPackage });
  }
  if (want("security") || want("crates")) {
    if (projectRow.rustCrate) securityTargets.push({ system: "CARGO", name: projectRow.rustCrate });
  }
  if (want("security") || want("go")) {
    if (projectRow.goModule) securityTargets.push({ system: "GO", name: projectRow.goModule });
  }

  const pkgConnectors = want("package_connectors")
    ? rawConnectors
        .map((c) => ({
          row: c,
          provider: normalizeRegistryProvider(c.provider),
          identifier: (c.identifier || "").trim(),
        }))
        .filter(
          (item): item is { row: (typeof rawConnectors)[number]; provider: NonNullable<ReturnType<typeof normalizeRegistryProvider>>; identifier: string } =>
            item.row.category === "package" && Boolean(item.provider) && item.identifier.length > 0
        )
    : [];

  for (const item of pkgConnectors) {
    const sys = REGISTRY_ADAPTERS[item.provider].depsDevSystem;
    if (sys) securityTargets.push({ system: sys, name: item.identifier });
  }

  const dedupedSecurityTargets = Array.from(
    new Map(securityTargets.map((t) => [securitySummaryKey(t.system, t.name), t])).values()
  );

  const [securityResults, fetchedExtraPackages] = await Promise.all([
    dedupedSecurityTargets.length > 0
      ? Promise.all(
          dedupedSecurityTargets.map(async (t) => ({
            key: securitySummaryKey(t.system, t.name),
            summary: await cap(fetchDepsDevSummary(t.system, t.name), 3500),
          }))
        )
      : Promise.resolve([]),
    want("package_connectors")
      ? Promise.all(
          pkgConnectors.slice(0, 12).map(async ({ row, provider, identifier }): Promise<ExtraPackageSnapshot | null> => {
            const meta = REGISTRY_ADAPTERS[provider];
            const url = row.targetUrl || meta.buildUrl(identifier);
            switch (provider) {
              case "npm": {
                const s = await cap(fetchNpmStats(identifier, decryptedNpmToken));
                return { connectorId: row.id, provider, label: row.label, identifier, latestVersion: s?.latestVersion || null, metricLabel: "30d downloads", metricValue: s?.downloadsLastMonth ?? null, url };
              }
              case "pypi": {
                const s = await cap(fetchPyPiStats(identifier));
                return { connectorId: row.id, provider, label: row.label, identifier, latestVersion: s?.latestVersion || null, metricLabel: "30d downloads", metricValue: s?.downloadsLastMonth ?? null, url };
              }
              case "crates": {
                const s = await cap(fetchRustCrateStats(identifier));
                return { connectorId: row.id, provider, label: row.label, identifier, latestVersion: s?.maxVersion || null, metricLabel: "total downloads", metricValue: s?.totalDownloads ?? null, secondaryLabel: "rev deps", secondaryValue: s ? String(s.reverseDependencies) : null, url };
              }
              case "go": {
                const s = await cap(fetchGoModuleStats(identifier));
                return { connectorId: row.id, provider, label: row.label, identifier, latestVersion: s?.latestVersion || null, metricLabel: "versions", metricValue: s?.versionCount ?? null, url };
              }
              case "docker": {
                const s = await cap(fetchDockerRepoStats(identifier, decryptedDockerToken));
                return { connectorId: row.id, provider, label: row.label, identifier, latestVersion: s?.tags?.[0]?.name || null, metricLabel: "pulls", metricValue: s?.pullCount ?? null, url };
              }
              case "vscode": {
                const s = await cap(fetchVsCodeStats(identifier));
                return { connectorId: row.id, provider, label: row.label, identifier, latestVersion: s?.version || null, metricLabel: "installs", metricValue: s?.installs ?? null, url };
              }
              case "mcp": {
                const s = await cap(fetchMcpStats(identifier, projectRow.githubRepo));
                return { connectorId: row.id, provider, label: row.label, identifier, latestVersion: s?.protocolVersion || null, metricLabel: "tools", metricValue: s?.toolsCount ?? null, url };
              }
              case "nuget": {
                const s = await cap(fetchNuGetStats(identifier));
                return {
                  connectorId: row.id,
                  provider,
                  label: row.label,
                  identifier,
                  latestVersion: s?.version || null,
                  metricLabel: "total downloads",
                  metricValue: s?.totalDownloads ?? null,
                  secondaryLabel: s?.verified ? "verified" : "versions",
                  secondaryValue: s ? (s.verified ? "NuGet Verified" : `${s.versionCount} ver`) : null,
                  url,
                };
              }
              case "rubygems": {
                const s = await cap(fetchRubyGemStats(identifier));
                return {
                  connectorId: row.id,
                  provider,
                  label: row.label,
                  identifier,
                  latestVersion: s?.version || null,
                  metricLabel: "total downloads",
                  metricValue: s?.totalDownloads ?? null,
                  secondaryLabel: "rev deps",
                  secondaryValue: s ? `${s.reverseDependencies} gems` : null,
                  url,
                };
              }
              case "packagist": {
                const s = await cap(fetchPackagistStats(identifier));
                return {
                  connectorId: row.id,
                  provider,
                  label: row.label,
                  identifier,
                  latestVersion: s?.latestVersion || null,
                  metricLabel: "monthly installs",
                  metricValue: s?.monthlyDownloads ?? null,
                  secondaryLabel: "total",
                  secondaryValue: s ? `${s.totalDownloads.toLocaleString()} (${s.dependents} deps)` : null,
                  url,
                };
              }
              case "pubdev": {
                const s = await cap(fetchPubDevStats(identifier));
                return {
                  connectorId: row.id,
                  provider,
                  label: row.label,
                  identifier,
                  latestVersion: s?.latestVersion || null,
                  metricLabel: "30d downloads",
                  metricValue: s?.downloadCount30Days ?? null,
                  secondaryLabel: "pub score",
                  secondaryValue: s ? `${s.grantedPoints}/${s.maxPoints} pts • ${s.likeCount} likes` : null,
                  url,
                };
              }
              case "jsr": {
                const s = await cap(fetchJsrStats(identifier));
                const runtimes = s
                  ? Object.entries(s.runtimeCompat)
                      .filter(([, ok]) => Boolean(ok))
                      .map(([rt]) => rt)
                      .slice(0, 4)
                  : [];
                return {
                  connectorId: row.id,
                  provider,
                  label: row.label,
                  identifier,
                  latestVersion: s?.latestVersion || null,
                  metricLabel: "JSR score %",
                  metricValue: s?.score ?? null,
                  secondaryLabel: "runtimes",
                  secondaryValue: runtimes.length > 0 ? runtimes.join(", ") : null,
                  url,
                };
              }
              case "hex": {
                const s = await cap(fetchHexStats(identifier));
                return {
                  connectorId: row.id,
                  provider,
                  label: row.label,
                  identifier,
                  latestVersion: s?.latestVersion || null,
                  metricLabel: "recent downloads",
                  metricValue: s?.recentDownloads ?? null,
                  secondaryLabel: "all-time",
                  secondaryValue: s ? s.allDownloads.toLocaleString() : null,
                  url,
                };
              }
              case "anaconda": {
                const s = await cap(fetchAnacondaStats(identifier));
                return {
                  connectorId: row.id,
                  provider,
                  label: row.label,
                  identifier,
                  latestVersion: s?.latestVersion || null,
                  metricLabel: "total downloads",
                  metricValue: s?.totalDownloads ?? null,
                  secondaryLabel: "platforms",
                  secondaryValue: s?.platforms.slice(0, 3).join(", ") || null,
                  url,
                };
              }
              case "cran": {
                const s = await cap(fetchCranStats(identifier));
                return {
                  connectorId: row.id,
                  provider,
                  label: row.label,
                  identifier,
                  latestVersion: s?.version || null,
                  metricLabel: "30d downloads",
                  metricValue: s?.downloadsLastMonth ?? null,
                  dailyHistory: s?.dailyHistory,
                  url,
                };
              }
              case "homebrew": {
                const s = await cap(fetchHomebrewStats(identifier));
                return {
                  connectorId: row.id,
                  provider,
                  label: row.label,
                  identifier,
                  latestVersion: s?.version || null,
                  metricLabel: "30d installs",
                  metricValue: s?.installs30d ?? null,
                  secondaryLabel: "365d installs",
                  secondaryValue: s ? `${s.installs90d.toLocaleString()} (90d) • ${s.installs365d.toLocaleString()} (1y)` : null,
                  url,
                };
              }
              case "maven": {
                const s = await cap(fetchMavenStats(identifier));
                return {
                  connectorId: row.id,
                  provider,
                  label: row.label,
                  identifier,
                  latestVersion: s?.latestVersion || null,
                  metricLabel: "releases",
                  metricValue: s?.versionCount ?? null,
                  secondaryLabel: "packaging",
                  secondaryValue: s?.packaging || null,
                  url,
                };
              }
              case "cpp": {
                const s = await cap(fetchCppPackageStats(identifier));
                return {
                  connectorId: row.id,
                  provider,
                  label: row.label,
                  identifier,
                  latestVersion: s?.latestVersion || null,
                  metricLabel: "versions",
                  metricValue: s?.versionCount ?? null,
                  secondaryLabel: s?.registry || "triplets",
                  secondaryValue: s ? s.triplets.slice(0, 3).join(", ") : null,
                  url,
                };
              }
              case "swift": {
                const s = await cap(fetchSwiftStats(identifier));
                return {
                  connectorId: row.id,
                  provider,
                  label: row.label,
                  identifier,
                  latestVersion: s?.latestVersion || null,
                  metricLabel: "platforms",
                  metricValue: s ? s.platforms.length : null,
                  secondaryLabel: s?.source === "spm" ? "Swift / SPM" : "CocoaPods",
                  secondaryValue: s?.platforms.slice(0, 4).join(", ") || null,
                  url,
                };
              }
              case "hackage": {
                const s = await cap(fetchHackageStats(identifier));
                return {
                  connectorId: row.id,
                  provider,
                  label: row.label,
                  identifier,
                  latestVersion: s?.latestVersion || null,
                  metricLabel: s?.recentDownloads != null ? "recent downloads" : "versions",
                  metricValue: s ? (s.recentDownloads ?? s.normalVersions.length) : null,
                  url,
                };
              }
              case "metacpan": {
                const s = await cap(fetchMetaCpanStats(identifier));
                return {
                  connectorId: row.id,
                  provider,
                  label: row.label,
                  identifier,
                  latestVersion: s?.version || null,
                  metricLabel: "CPAN ++",
                  metricValue: s?.favorites ?? null,
                  secondaryLabel: "license",
                  secondaryValue: s?.license?.[0] || null,
                  url,
                };
              }
              case "luarocks": {
                const s = await cap(fetchLuaRocksStats(identifier));
                return {
                  connectorId: row.id,
                  provider,
                  label: row.label,
                  identifier,
                  latestVersion: s?.version || null,
                  metricLabel: "downloads",
                  metricValue: s?.downloads ?? null,
                  url,
                };
              }
              case "julia": {
                const s = await cap(fetchJuliaStats(identifier));
                return {
                  connectorId: row.id,
                  provider,
                  label: row.label,
                  identifier,
                  latestVersion: s?.latestVersion || null,
                  metricLabel: "releases",
                  metricValue: s?.versionCount ?? null,
                  url,
                };
              }
            }
          })
        )
      : Promise.resolve(null),
  ]);

  for (const res of securityResults) {
    if (res.summary) {
      existingSecurity[res.key] = res.summary;
    }
  }

  if (fetchedExtraPackages) {
    extraPackages = fetchedExtraPackages
      .filter((x): x is ExtraPackageSnapshot => Boolean(x))
      .map((item) => {
        const sys = REGISTRY_ADAPTERS[item.provider].depsDevSystem;
        return {
          ...item,
          security: sys ? existingSecurity[securitySummaryKey(sys, item.identifier)] || null : null,
        };
      });
  }

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
    Object.keys(existingSecurity).length > 0
      ? upsertSnapshot(projectRow.id, "security", existingSecurity)
      : Promise.resolve(),
    want("package_connectors")
      ? upsertSnapshot(projectRow.id, "package_connectors", extraPackages)
      : Promise.resolve(),
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
  if (Object.keys(existingSecurity).length > 0) presentKeys.add("security");
  if (extraPackages.length > 0) presentKeys.add("package_connectors");

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
    packageSecurity: existingSecurity,
    extraPackages,
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
