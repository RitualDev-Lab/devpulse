import { db } from "@/db";
import { projects, dailyMetrics } from "@/db/schema";
import { fetchNpmStats } from "@/lib/integrations/npm";
import { fetchPyPiStats } from "@/lib/integrations/pypi";
import { fetchGitHubRepoStats } from "@/lib/integrations/github";
import { fetchRustCrateStats } from "@/lib/integrations/crates";
import { fetchGoModuleStats } from "@/lib/integrations/go";
import { fetchDockerRepoStats } from "@/lib/integrations/docker";
import { fetchVsCodeStats } from "@/lib/integrations/vscode";
import { fetchMcpStats } from "@/lib/integrations/mcp";
import { decryptSecret } from "@/lib/security/crypto";
import { getUserGitHubAccessToken } from "@/lib/security/github-ownership";

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
