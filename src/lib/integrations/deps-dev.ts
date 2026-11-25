export type DepsDevSystem = "NPM" | "PYPI" | "CARGO" | "GO" | "MAVEN" | "NUGET" | "RUBYGEMS";

export interface DepsDevAdvisorySummary {
  system: DepsDevSystem;
  packageName: string;
  defaultVersion: string | null;
  advisoryCount: number;
  licenses: string[];
  scorecardOverall: number | null;
  sourceRepo: string | null;
}

/**
 * Queries Google's free deps.dev v3 Open Source Insights API (zero API key required)
 * for latest version, OSV.dev advisory count, licenses, and OpenSSF Scorecard ratings.
 */
export async function fetchDepsDevSummary(
  system: DepsDevSystem,
  packageName: string
): Promise<DepsDevAdvisorySummary | null> {
  try {
    const clean = packageName.trim();
    if (!clean) return null;

    const pkgUrl = `https://api.deps.dev/v3/systems/${system}/packages/${encodeURIComponent(clean)}`;
    const pkgRes = await fetch(pkgUrl, {
      headers: { Accept: "application/json" },
      next: { revalidate: 21600 },
    }).catch(() => null);

    if (!pkgRes || !pkgRes.ok) return null;
    const pkgJson = (await pkgRes.json()) as {
      versions?: Array<{
        versionKey?: { version?: string };
        isDefault?: boolean;
      }>;
    };

    const versions = pkgJson.versions || [];
    const defaultVer =
      versions.find((v) => v.isDefault)?.versionKey?.version ||
      versions[versions.length - 1]?.versionKey?.version ||
      null;

    if (!defaultVer) {
      return {
        system,
        packageName: clean,
        defaultVersion: null,
        advisoryCount: 0,
        licenses: [],
        scorecardOverall: null,
        sourceRepo: null,
      };
    }

    const verUrl = `https://api.deps.dev/v3/systems/${system}/packages/${encodeURIComponent(
      clean
    )}/versions/${encodeURIComponent(defaultVer)}`;
    const verRes = await fetch(verUrl, {
      headers: { Accept: "application/json" },
      next: { revalidate: 21600 },
    }).catch(() => null);

    let advisoryCount = 0;
    let licenses: string[] = [];
    let sourceRepo: string | null = null;
    let scorecardOverall: number | null = null;

    if (verRes && verRes.ok) {
      const verJson = (await verRes.json()) as {
        advisoryKeys?: Array<{ id?: string }>;
        licenses?: string[];
        links?: Array<{ label?: string; url?: string }>;
        relatedProjects?: Array<{ projectKey?: { id?: string }; relationType?: string }>;
      };
      advisoryCount = Array.isArray(verJson.advisoryKeys) ? verJson.advisoryKeys.length : 0;
      licenses = Array.isArray(verJson.licenses) ? verJson.licenses : [];
      sourceRepo =
        verJson.links?.find((l) => l.label === "SOURCE_REPO")?.url ||
        verJson.relatedProjects?.find((p) => p.relationType === "SOURCE_REPO")?.projectKey?.id ||
        null;

      if (sourceRepo) {
        const projectId = sourceRepo.replace(/^https?:\/\//i, "").replace(/\.git$/i, "");
        const projRes = await fetch(
          `https://api.deps.dev/v3/projects/${encodeURIComponent(projectId)}`,
          { headers: { Accept: "application/json" }, next: { revalidate: 43200 } }
        ).catch(() => null);
        if (projRes && projRes.ok) {
          const projJson = (await projRes.json()) as {
            scorecard?: { overallScore?: number };
          };
          if (typeof projJson.scorecard?.overallScore === "number") {
            scorecardOverall = projJson.scorecard.overallScore;
          }
        }
      }
    }

    return {
      system,
      packageName: clean,
      defaultVersion: defaultVer,
      advisoryCount,
      licenses,
      scorecardOverall,
      sourceRepo,
    };
  } catch {
    return null;
  }
}
