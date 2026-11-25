import { db } from "@/db";
import { projects, dailyMetrics } from "@/db/schema";
import { fetchNpmStats } from "@/lib/integrations/npm";
import { fetchPyPiStats } from "@/lib/integrations/pypi";
import { fetchGitHubRepoStats } from "@/lib/integrations/github";
import { fetchRustCrateStats } from "@/lib/integrations/crates";
import { fetchGoModuleStats } from "@/lib/integrations/go";
import { fetchDockerRepoStats } from "@/lib/integrations/docker";
import { decryptSecret } from "@/lib/security/crypto";
import { getUserGitHubAccessToken } from "@/lib/security/github-ownership";

export interface SyncResult {
  projectId: string;
  projectName: string;
  syncedSources: string[];
  errors: string[];
}

/**
 * Runs the sync pipeline across all tracked projects.
 * Records snapshots into `dailyMetrics` table for lifetime historical charts.
 */
export async function syncAllProjects(): Promise<SyncResult[]> {
  const allProjects = await db.select().from(projects);
  const results: SyncResult[] = [];
  const todayStr = new Date().toISOString().split("T")[0];

  for (const proj of allProjects) {
    const syncedSources: string[] = [];
    const errors: string[] = [];

    // 1. Sync npm Package Metrics
    if (proj.npmPackage) {
      try {
        const npmStats = await fetchNpmStats(proj.npmPackage);
        if (npmStats) {
          const metricId = `met_npm_${proj.id}_${todayStr}`;
          await db
            .insert(dailyMetrics)
            .values({
              id: metricId,
              projectId: proj.id,
              source: "npm",
              metricType: "downloads",
              date: todayStr,
              value: npmStats.downloadsLastDay,
              metadataJson: JSON.stringify({
                day: npmStats.downloadsLastDay,
                week: npmStats.downloadsLastWeek,
                month: npmStats.downloadsLastMonth,
                version: npmStats.latestVersion,
                license: npmStats.license,
                totalReleases: npmStats.totalReleases,
                daysSinceLastRelease: npmStats.daysSinceLastRelease,
              }),
            })
            .onConflictDoUpdate({
              target: dailyMetrics.id,
              set: {
                value: npmStats.downloadsLastDay,
                metadataJson: JSON.stringify({
                  day: npmStats.downloadsLastDay,
                  week: npmStats.downloadsLastWeek,
                  month: npmStats.downloadsLastMonth,
                  version: npmStats.latestVersion,
                  license: npmStats.license,
                  totalReleases: npmStats.totalReleases,
                  daysSinceLastRelease: npmStats.daysSinceLastRelease,
                }),
              },
            });
          syncedSources.push("npm");
        }
      } catch (err: any) {
        errors.push(`npm: ${err?.message || "Failed to fetch npm stats"}`);
      }
    }

    // 2. Sync PyPI Package Metrics
    if (proj.pypiPackage) {
      try {
        const pypiStats = await fetchPyPiStats(proj.pypiPackage);
        if (pypiStats) {
          const metricId = `met_pypi_${proj.id}_${todayStr}`;
          await db
            .insert(dailyMetrics)
            .values({
              id: metricId,
              projectId: proj.id,
              source: "pypi",
              metricType: "downloads",
              date: todayStr,
              value: pypiStats.downloadsLastDay,
              metadataJson: JSON.stringify({
                day: pypiStats.downloadsLastDay,
                week: pypiStats.downloadsLastWeek,
                month: pypiStats.downloadsLastMonth,
                version: pypiStats.latestVersion,
                totalReleases: pypiStats.totalReleases,
                pythonVersions: pypiStats.pythonVersions,
              }),
            })
            .onConflictDoUpdate({
              target: dailyMetrics.id,
              set: {
                value: pypiStats.downloadsLastDay,
                metadataJson: JSON.stringify({
                  day: pypiStats.downloadsLastDay,
                  week: pypiStats.downloadsLastWeek,
                  month: pypiStats.downloadsLastMonth,
                  version: pypiStats.latestVersion,
                  totalReleases: pypiStats.totalReleases,
                  pythonVersions: pypiStats.pythonVersions,
                }),
              },
            });
          syncedSources.push("pypi");
        }
      } catch (err: any) {
        errors.push(`pypi: ${err?.message || "Failed to fetch PyPI stats"}`);
      }
    }

    // 3. Sync Rust Crates.io Metrics
    if (proj.rustCrate) {
      try {
        const rustStats = await fetchRustCrateStats(proj.rustCrate);
        if (rustStats) {
          const metricId = `met_rust_${proj.id}_${todayStr}`;
          await db
            .insert(dailyMetrics)
            .values({
              id: metricId,
              projectId: proj.id,
              source: "crates",
              metricType: "downloads",
              date: todayStr,
              value: rustStats.totalDownloads,
              metadataJson: JSON.stringify({
                totalDownloads: rustStats.totalDownloads,
                recentDownloads: rustStats.recentDownloads,
                reverseDependencies: rustStats.reverseDependencies,
                maxVersion: rustStats.maxVersion,
              }),
            })
            .onConflictDoUpdate({
              target: dailyMetrics.id,
              set: {
                value: rustStats.totalDownloads,
                metadataJson: JSON.stringify({
                  totalDownloads: rustStats.totalDownloads,
                  recentDownloads: rustStats.recentDownloads,
                  reverseDependencies: rustStats.reverseDependencies,
                  maxVersion: rustStats.maxVersion,
                }),
              },
            });
          syncedSources.push("crates");
        }
      } catch (err: any) {
        errors.push(`crates: ${err?.message || "Failed to fetch Rust crate stats"}`);
      }
    }

    // 4. Sync Docker Hub Container Metrics
    if (proj.dockerImage) {
      try {
        const dockerStats = await fetchDockerRepoStats(proj.dockerImage);
        if (dockerStats) {
          const metricId = `met_docker_${proj.id}_${todayStr}`;
          await db
            .insert(dailyMetrics)
            .values({
              id: metricId,
              projectId: proj.id,
              source: "docker",
              metricType: "pulls",
              date: todayStr,
              value: dockerStats.pullCount,
              metadataJson: JSON.stringify({
                pullCount: dockerStats.pullCount,
                starCount: dockerStats.starCount,
                lastUpdated: dockerStats.lastUpdated,
                tagCount: dockerStats.tags.length,
              }),
            })
            .onConflictDoUpdate({
              target: dailyMetrics.id,
              set: {
                value: dockerStats.pullCount,
                metadataJson: JSON.stringify({
                  pullCount: dockerStats.pullCount,
                  starCount: dockerStats.starCount,
                  lastUpdated: dockerStats.lastUpdated,
                  tagCount: dockerStats.tags.length,
                }),
              },
            });
          syncedSources.push("docker");
        } else {
          errors.push(`docker: fetch returned null for image "${proj.dockerImage}"`);
        }
      } catch (err: any) {
        errors.push(`docker: ${err?.message || "Failed to fetch Docker Hub stats"}`);
      }
    }

    // 5. Sync GitHub Repo Metrics (Stars, Forks, Issues, PR Velocity + Daily Clones & Views)
    if (proj.githubRepo) {
      try {
        const projGhToken = await decryptSecret(proj.githubTokenEncrypted).catch(() => null);
        const userGhToken = projGhToken || (await getUserGitHubAccessToken(proj.userId).catch(() => null));
        const ghStats = await fetchGitHubRepoStats(proj.githubRepo, userGhToken || undefined);
        if (ghStats) {
          const starMetricId = `met_gh_stars_${proj.id}_${todayStr}`;
          await db
            .insert(dailyMetrics)
            .values({
              id: starMetricId,
              projectId: proj.id,
              source: "github",
              metricType: "stars",
              date: todayStr,
              value: ghStats.stars,
              metadataJson: JSON.stringify({
                stars: ghStats.stars,
                forks: ghStats.forks,
                openIssues: ghStats.openIssuesCount,
                openPrs: ghStats.openPrCount,
                prReviewVelocityHours: ghStats.prReviewVelocityHours,
                staleIssues: ghStats.staleIssuesCount,
                freshIssues: ghStats.freshIssuesCount,
                dependabotAlerts: ghStats.dependabotAlertsCount,
                latestRelease: ghStats.latestRelease?.tagName,
              }),
            })
            .onConflictDoUpdate({
              target: dailyMetrics.id,
              set: {
                value: ghStats.stars,
                metadataJson: JSON.stringify({
                  stars: ghStats.stars,
                  forks: ghStats.forks,
                  openIssues: ghStats.openIssuesCount,
                  openPrs: ghStats.openPrCount,
                  prReviewVelocityHours: ghStats.prReviewVelocityHours,
                  staleIssues: ghStats.staleIssuesCount,
                  freshIssues: ghStats.freshIssuesCount,
                  dependabotAlerts: ghStats.dependabotAlertsCount,
                  latestRelease: ghStats.latestRelease?.tagName,
                }),
              },
            });

          // Persist daily GitHub clones & views into dailyMetrics so 14-day traffic never expires
          for (const cDay of ghStats.trafficClones?.daily || []) {
            const cloneId = `met_gh_clones_${proj.id}_${cDay.date}`;
            await db
              .insert(dailyMetrics)
              .values({
                id: cloneId,
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
              });
          }

          for (const vDay of ghStats.trafficViews?.daily || []) {
            const viewId = `met_gh_views_${proj.id}_${vDay.date}`;
            await db
              .insert(dailyMetrics)
              .values({
                id: viewId,
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
              });
          }

          syncedSources.push("github");
        }
      } catch (err: any) {
        errors.push(`github: ${err?.message || "Failed to fetch GitHub stats"}`);
      }
    }

    // 6. Sync Go Module Metrics
    if (proj.goModule) {
      try {
        const goStats = await fetchGoModuleStats(proj.goModule);
        if (goStats) {
          const goMetricId = `met_go_${proj.id}_${todayStr}`;
          await db
            .insert(dailyMetrics)
            .values({
              id: goMetricId,
              projectId: proj.id,
              source: "go",
              metricType: "versions",
              date: todayStr,
              value: goStats.versionCount,
              metadataJson: JSON.stringify({
                latestVersion: goStats.latestVersion,
                versionCount: goStats.versionCount,
                publishedAt: goStats.publishedAt,
              }),
            })
            .onConflictDoUpdate({
              target: dailyMetrics.id,
              set: {
                value: goStats.versionCount,
                metadataJson: JSON.stringify({
                  latestVersion: goStats.latestVersion,
                  versionCount: goStats.versionCount,
                  publishedAt: goStats.publishedAt,
                }),
              },
            });
          syncedSources.push("go");
        }
      } catch (err: any) {
        errors.push(`go: ${err?.message || "Failed to fetch Go module stats"}`);
      }
    }

    results.push({
      projectId: proj.id,
      projectName: proj.name,
      syncedSources,
      errors,
    });
  }

  return results;
}
