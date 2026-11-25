/**
 * npm / JavaScript Ecosystem Service (npm, pnpm, Bun)
 * Interacts with public npm APIs (api.npmjs.org and registry.npmjs.org)
 * Ingests:
 * - 30-day download velocity
 * - Version release cadence & history
 * - License and dependency counts
 * Requires ZERO private tokens.
 */

export interface NpmStats {
  packageName: string;
  downloadsLastDay: number;
  downloadsLastWeek: number;
  downloadsLastMonth: number;
  dailyHistory: Array<{ date: string; downloads: number }>;
  latestVersion?: string;
  license?: string;
  totalReleases: number;
  latestReleaseDate?: string;
  daysSinceLastRelease?: number;
  dependenciesCount: number;
  description?: string;
}

export async function fetchNpmStats(
  packageName: string,
  npmToken?: string | null
): Promise<NpmStats | null> {
  try {
    const cleanName = packageName.trim();
    const encodedPkg = cleanName.startsWith("@")
      ? `@${encodeURIComponent(cleanName.slice(1)).replace(/%2F/i, "/")}`
      : encodeURIComponent(cleanName);

    const registryHeaders: Record<string, string> = {
      Accept: "application/json",
    };
    if (npmToken) {
      registryHeaders.Authorization = `Bearer ${npmToken}`;
    }

    // 1. Fetch range for the last 30 days
    const rangeRes = await fetch(`https://api.npmjs.org/downloads/range/last-month/${encodedPkg}`, {
      headers: registryHeaders,
      next: { revalidate: 3600 },
    }).catch(() => null);

    let dailyHistory: Array<{ date: string; downloads: number }> = [];
    let downloadsLastMonth = 0;

    if (rangeRes && rangeRes.ok) {
      const data = await rangeRes.json();
      if (Array.isArray(data.downloads)) {
        dailyHistory = data.downloads.map((d: { day: string; downloads: number }) => ({
          date: d.day,
          downloads: d.downloads,
        }));
        downloadsLastMonth = dailyHistory.reduce((acc, curr) => acc + curr.downloads, 0);
      }
    }

    // 2. Fetch point stats for last week and last day
    const [weekRes, dayRes, metaRes] = await Promise.all([
      fetch(`https://api.npmjs.org/downloads/point/last-week/${encodedPkg}`, {
        headers: registryHeaders,
        next: { revalidate: 3600 },
      }).catch(() => null),
      fetch(`https://api.npmjs.org/downloads/point/last-day/${encodedPkg}`, {
        headers: registryHeaders,
        next: { revalidate: 3600 },
      }).catch(() => null),
      fetch(`https://registry.npmjs.org/${encodedPkg}`, {
        headers: registryHeaders,
        next: { revalidate: 86400 },
      }).catch(() => null),
    ]);

    const weekData = weekRes && weekRes.ok ? await weekRes.json() : { downloads: 0 };
    const dayData = dayRes && dayRes.ok ? await dayRes.json() : { downloads: 0 };

    // 3. Fetch package metadata (latest version, license, release cadence, dependencies)
    let latestVersion = "";
    let description = "";
    let license = "MIT";
    let totalReleases = 0;
    let latestReleaseDate = "";
    let daysSinceLastRelease = 0;
    let dependenciesCount = 0;

    if (metaRes && metaRes.ok) {
      try {
        const meta = await metaRes.json();
        latestVersion = meta["dist-tags"]?.latest || "";
        description = meta.description || "";
        license = meta.license || (typeof meta.license === "object" ? meta.license.type : "MIT");

        // Release cadence calculation
        const times = Object.entries(meta.time || {}).filter(
          ([k]) => k !== "created" && k !== "modified"
        );
        totalReleases = times.length;

        if (latestVersion && meta.time && meta.time[latestVersion]) {
          latestReleaseDate = meta.time[latestVersion];
          const releaseMs = new Date(latestReleaseDate).getTime();
          if (!isNaN(releaseMs)) {
            daysSinceLastRelease = Math.max(0, Math.floor((Date.now() - releaseMs) / (1000 * 60 * 60 * 24)));
          }
        }

        // Dependency counts
        const versionObj = meta.versions?.[latestVersion];
        if (versionObj?.dependencies) {
          dependenciesCount = Object.keys(versionObj.dependencies).length;
        }
      } catch {
        // Non-fatal
      }
    }

    return {
      packageName,
      downloadsLastDay: dayData.downloads || 0,
      downloadsLastWeek: weekData.downloads || 0,
      downloadsLastMonth: downloadsLastMonth || weekData.downloads * 4,
      dailyHistory,
      latestVersion,
      license,
      totalReleases,
      latestReleaseDate,
      daysSinceLastRelease,
      dependenciesCount,
      description,
    };
  } catch (err) {
    console.error(`Error fetching npm stats for ${packageName}:`, err);
    return null;
  }
}

/**
 * Discover packages belonging to an npm org (uses npm Read Token when private/org).
 */
export async function fetchNpmOrgPackages(
  orgName: string,
  npmToken?: string | null
): Promise<string[]> {
  try {
    const cleanOrg = orgName.trim().replace(/^@/, "");
    if (!cleanOrg) return [];
    const headers: Record<string, string> = { Accept: "application/json" };
    if (npmToken) headers.Authorization = `Bearer ${npmToken}`;
    const res = await fetch(`https://registry.npmjs.org/-/org/${encodeURIComponent(cleanOrg)}/package`, {
      headers,
      next: { revalidate: 1800 },
    }).catch(() => null);
    if (!res?.ok) return [];
    const json = (await res.json()) as Record<string, string>;
    return Object.keys(json || {}).slice(0, 50);
  } catch {
    return [];
  }
}
