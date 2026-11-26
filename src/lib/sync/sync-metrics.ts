import { db } from "@/db";
import { projects, dailyMetrics, projectConnectors } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { refreshDailyDeltas } from "@/lib/sync/refresh-daily-deltas";
import { fetchNpmStats } from "@/lib/integrations/npm";
import { fetchPyPiStats } from "@/lib/integrations/pypi";
import { fetchGitHubRepoStats } from "@/lib/integrations/github";
import { fetchRustCrateStats } from "@/lib/integrations/crates";
import { fetchGoModuleStats } from "@/lib/integrations/go";
import { fetchDockerRepoStats } from "@/lib/integrations/docker";
import { fetchVsCodeStats } from "@/lib/integrations/vscode";
import { fetchMcpStats } from "@/lib/integrations/mcp";
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
import { normalizeRegistryProvider, REGISTRY_ADAPTERS } from "@/lib/integrations/registry-adapter";
import { decryptSecret } from "@/lib/security/crypto";
import { getUserGitHubAccessToken } from "@/lib/security/github-ownership";
import { fetchDepsDevSummary, type DepsDevSystem } from "@/lib/integrations/deps-dev";
import { resolveDecryptedWebhookConfig, dispatchCrashAlerts } from "@/lib/alerts/webhook";
import { PUBLIC_APP_URL } from "@/lib/config/app-url";

export interface SyncResult {
  projectId: string;
  projectName: string;
  syncedSources: string[];
  errors: string[];
}

const PROJECT_BATCH_CONCURRENCY = 4;

async function syncSingleProject(
  proj: typeof projects.$inferSelect,
  todayStr: string
): Promise<SyncResult> {
  const syncedSources: string[] = [];
  const errors: string[] = [];

  const tasks: Array<Promise<void>> = [];

  // 1. npm
  if (proj.npmPackage) {
    tasks.push(
      (async () => {
        try {
          const npmToken = await decryptSecret(proj.npmTokenEncrypted).catch(() => null);
          const npmStats = await fetchNpmStats(proj.npmPackage!, npmToken);
          if (!npmStats) return;
          const metricId = `met_npm_${proj.id}_${todayStr}`;
          const meta = JSON.stringify({
            day: npmStats.downloadsLastDay,
            week: npmStats.downloadsLastWeek,
            month: npmStats.downloadsLastMonth,
            version: npmStats.latestVersion,
            license: npmStats.license,
            totalReleases: npmStats.totalReleases,
            daysSinceLastRelease: npmStats.daysSinceLastRelease,
          });
          await db
            .insert(dailyMetrics)
            .values({
              id: metricId,
              projectId: proj.id,
              source: "npm",
              metricType: "downloads",
              date: todayStr,
              value: npmStats.downloadsLastDay,
              metadataJson: meta,
            })
            .onConflictDoUpdate({
              target: dailyMetrics.id,
              set: { value: npmStats.downloadsLastDay, metadataJson: meta },
            });
          syncedSources.push("npm");
        } catch (err: any) {
          errors.push(`npm: ${err?.message || "Failed to fetch npm stats"}`);
        }
      })()
    );
  }

  // 2. PyPI
  if (proj.pypiPackage) {
    tasks.push(
      (async () => {
        try {
          const pypiStats = await fetchPyPiStats(proj.pypiPackage!);
          if (!pypiStats) return;
          const metricId = `met_pypi_${proj.id}_${todayStr}`;
          const meta = JSON.stringify({
            day: pypiStats.downloadsLastDay,
            week: pypiStats.downloadsLastWeek,
            month: pypiStats.downloadsLastMonth,
            version: pypiStats.latestVersion,
            totalReleases: pypiStats.totalReleases,
            pythonVersions: pypiStats.pythonVersions,
          });
          await db
            .insert(dailyMetrics)
            .values({
              id: metricId,
              projectId: proj.id,
              source: "pypi",
              metricType: "downloads",
              date: todayStr,
              value: pypiStats.downloadsLastDay,
              metadataJson: meta,
            })
            .onConflictDoUpdate({
              target: dailyMetrics.id,
              set: { value: pypiStats.downloadsLastDay, metadataJson: meta },
            });
          syncedSources.push("pypi");
        } catch (err: any) {
          errors.push(`pypi: ${err?.message || "Failed to fetch PyPI stats"}`);
        }
      })()
    );
  }

  // 3. Rust Crates.io
  if (proj.rustCrate) {
    tasks.push(
      (async () => {
        try {
          const rustStats = await fetchRustCrateStats(proj.rustCrate!);
          if (!rustStats) return;
          const metricId = `met_rust_${proj.id}_${todayStr}`;
          const meta = JSON.stringify({
            totalDownloads: rustStats.totalDownloads,
            recentDownloads: rustStats.recentDownloads,
            reverseDependencies: rustStats.reverseDependencies,
            maxVersion: rustStats.maxVersion,
          });
          await db
            .insert(dailyMetrics)
            .values({
              id: metricId,
              projectId: proj.id,
              source: "crates",
              metricType: "downloads",
              date: todayStr,
              value: rustStats.totalDownloads,
              metadataJson: meta,
            })
            .onConflictDoUpdate({
              target: dailyMetrics.id,
              set: { value: rustStats.totalDownloads, metadataJson: meta },
            });
          syncedSources.push("crates");
        } catch (err: any) {
          errors.push(`crates: ${err?.message || "Failed to fetch Rust crate stats"}`);
        }
      })()
    );
  }

  // 4. Docker Hub
  if (proj.dockerImage) {
    tasks.push(
      (async () => {
        try {
          const dockerStats = await fetchDockerRepoStats(proj.dockerImage!);
          if (!dockerStats) {
            errors.push(`docker: fetch returned null for image "${proj.dockerImage}"`);
            return;
          }
          const metricId = `met_docker_${proj.id}_${todayStr}`;
          const meta = JSON.stringify({
            pullCount: dockerStats.pullCount,
            starCount: dockerStats.starCount,
            lastUpdated: dockerStats.lastUpdated,
            tagCount: dockerStats.tags.length,
          });
          await db
            .insert(dailyMetrics)
            .values({
              id: metricId,
              projectId: proj.id,
              source: "docker",
              metricType: "pulls",
              date: todayStr,
              value: dockerStats.pullCount,
              metadataJson: meta,
            })
            .onConflictDoUpdate({
              target: dailyMetrics.id,
              set: { value: dockerStats.pullCount, metadataJson: meta },
            });
          syncedSources.push("docker");
        } catch (err: any) {
          errors.push(`docker: ${err?.message || "Failed to fetch Docker Hub stats"}`);
        }
      })()
    );
  }

  // 5. GitHub
  if (proj.githubRepo) {
    tasks.push(
      (async () => {
        try {
          const projGhToken = await decryptSecret(proj.githubTokenEncrypted).catch(() => null);
          const userGhToken =
            projGhToken || (await getUserGitHubAccessToken(proj.userId).catch(() => null));
          const ghStats = await fetchGitHubRepoStats(proj.githubRepo!, userGhToken || undefined);
          if (!ghStats) return;

          const starMetricId = `met_gh_stars_${proj.id}_${todayStr}`;
          const meta = JSON.stringify({
            stars: ghStats.stars,
            forks: ghStats.forks,
            openIssues: ghStats.openIssuesCount,
            openPrs: ghStats.openPrCount,
            prReviewVelocityHours: ghStats.prReviewVelocityHours,
            staleIssues: ghStats.staleIssuesCount,
            freshIssues: ghStats.freshIssuesCount,
            dependabotAlerts: ghStats.dependabotAlertsCount,
            latestRelease: ghStats.latestRelease?.tagName,
          });
          await db
            .insert(dailyMetrics)
            .values({
              id: starMetricId,
              projectId: proj.id,
              source: "github",
              metricType: "stars",
              date: todayStr,
              value: ghStats.stars,
              metadataJson: meta,
            })
            .onConflictDoUpdate({
              target: dailyMetrics.id,
              set: { value: ghStats.stars, metadataJson: meta },
            });

          await Promise.all([
            ...(ghStats.trafficClones?.daily || []).map((cDay) =>
              db
                .insert(dailyMetrics)
                .values({
                  id: `met_gh_clones_${proj.id}_${cDay.date}`,
                  projectId: proj.id,
                  source: "github",
                  metricType: "clones",
                  date: cDay.date,
                  value: cDay.count,
                  metadataJson: JSON.stringify({ uniques: cDay.uniques }),
                })
                .onConflictDoUpdate({
                  target: dailyMetrics.id,
                  set: { value: cDay.count, metadataJson: JSON.stringify({ uniques: cDay.uniques }) },
                })
            ),
            ...(ghStats.trafficViews?.daily || []).map((vDay) =>
              db
                .insert(dailyMetrics)
                .values({
                  id: `met_gh_views_${proj.id}_${vDay.date}`,
                  projectId: proj.id,
                  source: "github",
                  metricType: "views",
                  date: vDay.date,
                  value: vDay.count,
                  metadataJson: JSON.stringify({ uniques: vDay.uniques }),
                })
                .onConflictDoUpdate({
                  target: dailyMetrics.id,
                  set: { value: vDay.count, metadataJson: JSON.stringify({ uniques: vDay.uniques }) },
                })
            ),
          ]);

          syncedSources.push("github");
        } catch (err: any) {
          errors.push(`github: ${err?.message || "Failed to fetch GitHub stats"}`);
        }
      })()
    );
  }

  // 6. Go Module
  if (proj.goModule) {
    tasks.push(
      (async () => {
        try {
          const goStats = await fetchGoModuleStats(proj.goModule!);
          if (!goStats) return;
          const goMetricId = `met_go_${proj.id}_${todayStr}`;
          const meta = JSON.stringify({
            latestVersion: goStats.latestVersion,
            versionCount: goStats.versionCount,
            publishedAt: goStats.publishedAt,
          });
          await db
            .insert(dailyMetrics)
            .values({
              id: goMetricId,
              projectId: proj.id,
              source: "go",
              metricType: "versions",
              date: todayStr,
              value: goStats.versionCount,
              metadataJson: meta,
            })
            .onConflictDoUpdate({
              target: dailyMetrics.id,
              set: { value: goStats.versionCount, metadataJson: meta },
            });
          syncedSources.push("go");
        } catch (err: any) {
          errors.push(`go: ${err?.message || "Failed to fetch Go module stats"}`);
        }
      })()
    );
  }

  // 7. VS Code Marketplace
  if (proj.vscodeExtension) {
    tasks.push(
      (async () => {
        try {
          const vsStats = await fetchVsCodeStats(proj.vscodeExtension!);
          if (!vsStats) return;
          const vsMetricId = `met_vscode_${proj.id}_${todayStr}`;
          const meta = JSON.stringify({
            installs: vsStats.installs,
            vsMarketplaceInstalls: vsStats.vsMarketplaceInstalls,
            openVsxInstalls: vsStats.openVsxInstalls,
            averageRating: vsStats.averageRating,
            reviewCount: vsStats.reviewCount,
            version: vsStats.version,
          });
          await db
            .insert(dailyMetrics)
            .values({
              id: vsMetricId,
              projectId: proj.id,
              source: "vscode",
              metricType: "installs",
              date: todayStr,
              value: vsStats.installs,
              metadataJson: meta,
            })
            .onConflictDoUpdate({
              target: dailyMetrics.id,
              set: { value: vsStats.installs, metadataJson: meta },
            });
          syncedSources.push("vscode");
        } catch (err: any) {
          errors.push(`vscode: ${err?.message || "Failed to fetch VS Code stats"}`);
        }
      })()
    );
  }

  // 8. MCP Server Registry
  if (proj.mcpServerName) {
    tasks.push(
      (async () => {
        try {
          const mcpStats = await fetchMcpStats(proj.mcpServerName!, proj.githubRepo);
          if (!mcpStats) return;
          const mcpMetricId = `met_mcp_${proj.id}_${todayStr}`;
          const registryHits =
            Number(mcpStats.registries.mcpshelf) +
            Number(mcpStats.registries.glama) +
            Number(mcpStats.registries.smithery);
          const meta = JSON.stringify({
            serverName: mcpStats.serverName,
            displayName: mcpStats.displayName,
            protocolVersion: mcpStats.protocolVersion,
            transport: mcpStats.transport,
            toolsCount: mcpStats.toolsCount,
            status: mcpStats.status,
            registries: mcpStats.registries,
          });
          await db
            .insert(dailyMetrics)
            .values({
              id: mcpMetricId,
              projectId: proj.id,
              source: "mcp",
              metricType: "installs",
              date: todayStr,
              value: mcpStats.toolsCount ?? registryHits,
              metadataJson: meta,
            })
            .onConflictDoUpdate({
              target: dailyMetrics.id,
              set: { value: mcpStats.toolsCount ?? registryHits, metadataJson: meta },
            });
          syncedSources.push("mcp");
        } catch (err: any) {
          errors.push(`mcp: ${err?.message || "Failed to fetch MCP stats"}`);
        }
      })()
    );
  }

  await Promise.allSettled(tasks);

  // Sync Tier-1 & monorepo package connectors into daily_metrics
  const extraPkgSecurityTargets: Array<{ system: DepsDevSystem; pkg: string; label: string }> = [];
  try {
    const pkgConns = await db
      .select()
      .from(projectConnectors)
      .where(and(eq(projectConnectors.projectId, proj.id), eq(projectConnectors.category, "package")))
      .limit(15);

    const tier1Tasks = pkgConns.map(async (conn) => {
      const provider = normalizeRegistryProvider(conn.provider);
      const id = (conn.identifier || "").trim();
      if (!provider || !id) return;

      const sys = REGISTRY_ADAPTERS[provider].depsDevSystem;
      if (sys) {
        extraPkgSecurityTargets.push({ system: sys, pkg: id, label: REGISTRY_ADAPTERS[provider].label });
      }

      const upsertPoint = async (
        source: typeof dailyMetrics.$inferInsert["source"],
        metricType: typeof dailyMetrics.$inferInsert["metricType"],
        date: string,
        value: number,
        metaObj: Record<string, unknown>
      ) => {
        const safeId = `met_${source}_${conn.id}_${date}`.slice(0, 128);
        const metadataJson = JSON.stringify({ connectorId: conn.id, identifier: id, ...metaObj });
        await db
          .insert(dailyMetrics)
          .values({ id: safeId, projectId: proj.id, source, metricType, date, value, metadataJson })
          .onConflictDoUpdate({ target: dailyMetrics.id, set: { value, metadataJson } });
      };

      switch (provider) {
        case "nuget": {
          const s = await fetchNuGetStats(id);
          if (s) {
            await upsertPoint("nuget", "downloads", todayStr, s.totalDownloads, { version: s.version, verified: s.verified });
            syncedSources.push(`nuget:${id}`);
          }
          break;
        }
        case "rubygems": {
          const s = await fetchRubyGemStats(id);
          if (s) {
            await upsertPoint("rubygems", "downloads", todayStr, s.totalDownloads, { version: s.version, revDeps: s.reverseDependencies });
            syncedSources.push(`rubygems:${id}`);
          }
          break;
        }
        case "packagist": {
          const s = await fetchPackagistStats(id);
          if (s) {
            await upsertPoint("packagist", "downloads", todayStr, s.dailyDownloads || s.monthlyDownloads, { total: s.totalDownloads, monthly: s.monthlyDownloads, version: s.latestVersion });
            syncedSources.push(`packagist:${id}`);
          }
          break;
        }
        case "pubdev": {
          const s = await fetchPubDevStats(id);
          if (s) {
            await upsertPoint("pubdev", "downloads", todayStr, s.downloadCount30Days, { points: s.grantedPoints, likes: s.likeCount, version: s.latestVersion });
            syncedSources.push(`pubdev:${id}`);
          }
          break;
        }
        case "jsr": {
          const s = await fetchJsrStats(id);
          if (s) {
            await upsertPoint("jsr", "versions", todayStr, s.versionCount, { score: s.score, version: s.latestVersion });
            syncedSources.push(`jsr:${id}`);
          }
          break;
        }
        case "hex": {
          const s = await fetchHexStats(id);
          if (s) {
            await upsertPoint("hex", "downloads", todayStr, s.dayDownloads || s.recentDownloads, { all: s.allDownloads, version: s.latestVersion });
            syncedSources.push(`hex:${id}`);
          }
          break;
        }
        case "anaconda": {
          const s = await fetchAnacondaStats(id);
          if (s) {
            await upsertPoint("anaconda", "downloads", todayStr, s.totalDownloads, { version: s.latestVersion, channel: s.channel });
            syncedSources.push(`anaconda:${id}`);
          }
          break;
        }
        case "cran": {
          const s = await fetchCranStats(id);
          if (s) {
            await Promise.all(
              (s.dailyHistory.length > 0 ? s.dailyHistory : [{ date: todayStr, downloads: s.downloadsLastMonth }]).map((pt) =>
                upsertPoint("cran", "downloads", pt.date, pt.downloads, { version: s.version, downloadsLastMonth: s.downloadsLastMonth })
              )
            );
            syncedSources.push(`cran:${id}`);
          }
          break;
        }
        case "homebrew": {
          const s = await fetchHomebrewStats(id);
          if (s) {
            await upsertPoint("homebrew", "installs", todayStr, s.installs30d, { installs90d: s.installs90d, installs365d: s.installs365d, version: s.version });
            syncedSources.push(`homebrew:${id}`);
          }
          break;
        }
        case "maven": {
          const s = await fetchMavenStats(id);
          if (s) {
            await upsertPoint("maven", "versions", todayStr, s.versionCount, { version: s.latestVersion, packaging: s.packaging });
            syncedSources.push(`maven:${id}`);
          }
          break;
        }
        case "cpp": {
          const s = await fetchCppPackageStats(id);
          if (s) {
            await upsertPoint("cpp", "versions", todayStr, s.versionCount, { version: s.latestVersion, registry: s.registry, triplets: s.triplets });
            syncedSources.push(`cpp:${id}`);
          }
          break;
        }
        case "swift": {
          const s = await fetchSwiftStats(id);
          if (s) {
            await upsertPoint("swift", "versions", todayStr, Math.max(1, s.swiftVersions.length), { version: s.latestVersion, platforms: s.platforms });
            syncedSources.push(`swift:${id}`);
          }
          break;
        }
        case "hackage": {
          const s = await fetchHackageStats(id);
          if (s) {
            await upsertPoint("hackage", "downloads", todayStr, s.recentDownloads ?? s.normalVersions.length, { version: s.latestVersion, recentDownloads: s.recentDownloads });
            syncedSources.push(`hackage:${id}`);
          }
          break;
        }
        case "metacpan": {
          const s = await fetchMetaCpanStats(id);
          if (s) {
            await upsertPoint("metacpan", "stars", todayStr, s.favorites, { version: s.version, license: s.license });
            syncedSources.push(`metacpan:${id}`);
          }
          break;
        }
        case "luarocks": {
          const s = await fetchLuaRocksStats(id);
          if (s) {
            await upsertPoint("luarocks", "downloads", todayStr, s.downloads ?? 0, { version: s.version });
            syncedSources.push(`luarocks:${id}`);
          }
          break;
        }
        case "julia": {
          const s = await fetchJuliaStats(id);
          if (s) {
            await upsertPoint("julia", "versions", todayStr, s.versionCount, { version: s.latestVersion, uuid: s.uuid });
            syncedSources.push(`julia:${id}`);
          }
          break;
        }
        default:
          break;
      }
    });

    await Promise.allSettled(tier1Tasks);
  } catch (err: any) {
    errors.push(`tier1 connectors: ${err?.message || "Sync failed"}`);
  }

  // Check deps.dev for newly discovered security advisories across linked packages
  const securityChecks: Array<{ system: DepsDevSystem; pkg: string; label: string }> = [
    ...extraPkgSecurityTargets,
  ];
  if (proj.npmPackage) securityChecks.push({ system: "NPM", pkg: proj.npmPackage, label: "npm" });
  if (proj.pypiPackage) securityChecks.push({ system: "PYPI", pkg: proj.pypiPackage, label: "PyPI" });
  if (proj.rustCrate) securityChecks.push({ system: "CARGO", pkg: proj.rustCrate, label: "Crates.io" });
  if (proj.goModule) securityChecks.push({ system: "GO", pkg: proj.goModule, label: "Go" });

  if (securityChecks.length > 0) {
    try {
      const summaries = await Promise.all(
        securityChecks.map(async (item) => ({
          ...item,
          summary: await fetchDepsDevSummary(item.system, item.pkg).catch(() => null),
        }))
      );
      const flagged = summaries.filter((s) => s.summary && s.summary.advisoryCount > 0);
      if (flagged.length > 0) {
        const webhookCfg = await resolveDecryptedWebhookConfig(proj).catch(() => null);
        if (webhookCfg) {
          const details = flagged
            .map((f) => `${f.pkg} (${f.label}): ${f.summary!.advisoryCount} CVE advisory(ies)`)
            .join("; ");
          await dispatchCrashAlerts(webhookCfg, {
            projectName: proj.name,
            projectSlug: proj.slug,
            errorName: "SecurityAdvisoryCVE",
            message: `deps.dev flagged security advisories during sync: ${details}`,
            runtime: "security-scanner",
            version: flagged[0].summary?.defaultVersion || "latest",
            dashboardUrl: `${PUBLIC_APP_URL}/dashboard/packages?project=${encodeURIComponent(proj.slug)}`,
          }).catch(() => {});
        }
        syncedSources.push("security");
      }
    } catch {
      // Non-blocking security advisory check
    }
  }

  try {
    await refreshDailyDeltas(proj.id);
  } catch {
    errors.push("daily deltas: refresh failed");
  }

  return {
    projectId: proj.id,
    projectName: proj.name,
    syncedSources,
    errors,
  };
}

/**
 * Syncs multi-registry metrics across projects using bounded concurrency & optional cursor pagination
 * so Cloudflare Workers wall-clock and subrequest quotas are respected cleanly.
 */
export async function syncAllProjects(options?: {
  offset?: number;
  limit?: number;
}): Promise<SyncResult[]> {
  const offset = Math.max(0, Number(options?.offset || 0));
  const limit = Math.min(50, Math.max(1, Number(options?.limit || 20)));

  const batchProjects = await db.select().from(projects).limit(limit).offset(offset);
  const results: SyncResult[] = [];
  const todayStr = new Date().toISOString().split("T")[0];

  for (let i = 0; i < batchProjects.length; i += PROJECT_BATCH_CONCURRENCY) {
    const chunk = batchProjects.slice(i, i + PROJECT_BATCH_CONCURRENCY);
    const settled = await Promise.allSettled(
      chunk.map((proj) => syncSingleProject(proj, todayStr))
    );
    for (let j = 0; j < settled.length; j++) {
      const outcome = settled[j];
      if (outcome.status === "fulfilled") {
        results.push(outcome.value);
      } else {
        results.push({
          projectId: chunk[j].id,
          projectName: chunk[j].name,
          syncedSources: [],
          errors: [String(outcome.reason || "Unexpected sync error")],
        });
      }
    }
  }

  return results;
}
