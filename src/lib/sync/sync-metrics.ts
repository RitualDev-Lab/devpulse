import { db } from "@/db";
import { projects, dailyMetrics } from "@/db/schema";
import { fetchNpmStats } from "@/lib/integrations/npm";
import { fetchPyPiStats } from "@/lib/integrations/pypi";
import { fetchGitHubRepoStats } from "@/lib/integrations/github";

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
                week: npmStats.downloadsLastWeek,
                month: npmStats.downloadsLastMonth,
                version: npmStats.latestVersion,
              }),
            })
            .onConflictDoUpdate({
              target: dailyMetrics.id,
              set: { value: npmStats.downloadsLastDay },
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
                week: pypiStats.downloadsLastWeek,
                month: pypiStats.downloadsLastMonth,
                version: pypiStats.latestVersion,
              }),
            })
            .onConflictDoUpdate({
              target: dailyMetrics.id,
              set: { value: pypiStats.downloadsLastDay },
            });
          syncedSources.push("pypi");
        }
      } catch (err: any) {
        errors.push(`pypi: ${err?.message || "Failed to fetch PyPI stats"}`);
      }
    }

    // 3. Sync GitHub Repo Metrics (Stars, Forks, Issues)
    if (proj.githubRepo) {
      try {
        const ghStats = await fetchGitHubRepoStats(proj.githubRepo);
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
                forks: ghStats.forks,
                openIssues: ghStats.openIssuesCount,
                latestRelease: ghStats.latestRelease?.tagName,
              }),
            })
            .onConflictDoUpdate({
              target: dailyMetrics.id,
              set: { value: ghStats.stars },
            });
          syncedSources.push("github");
        }
      } catch (err: any) {
        errors.push(`github: ${err?.message || "Failed to fetch GitHub stats"}`);
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
