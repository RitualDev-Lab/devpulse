/**
 * npm Registry Service
 * Interacts with public npm APIs (api.npmjs.org and registry.npmjs.org)
 * Requires ZERO private tokens.
 */

export interface NpmStats {
  packageName: string;
  downloadsLastDay: number;
  downloadsLastWeek: number;
  downloadsLastMonth: number;
  dailyHistory: Array<{ date: string; downloads: number }>;
  latestVersion?: string;
  description?: string;
}

export async function fetchNpmStats(packageName: string): Promise<NpmStats | null> {
  try {
    const encodedPkg = encodeURIComponent(packageName);

    // 1. Fetch range for the last 30 days
    const rangeRes = await fetch(`https://api.npmjs.org/downloads/range/last-month/${encodedPkg}`, {
      next: { revalidate: 3600 }, // Cache for 1 hour
    });

    let dailyHistory: Array<{ date: string; downloads: number }> = [];
    let downloadsLastMonth = 0;

    if (rangeRes.ok) {
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
    const weekRes = await fetch(`https://api.npmjs.org/downloads/point/last-week/${encodedPkg}`, {
      next: { revalidate: 3600 },
    });
    const weekData = weekRes.ok ? await weekRes.json() : { downloads: 0 };

    const dayRes = await fetch(`https://api.npmjs.org/downloads/point/last-day/${encodedPkg}`, {
      next: { revalidate: 3600 },
    });
    const dayData = dayRes.ok ? await dayRes.json() : { downloads: 0 };

    // 3. Fetch package metadata (latest version, description)
    let latestVersion = "";
    let description = "";
    try {
      const metaRes = await fetch(`https://registry.npmjs.org/${encodedPkg}`, {
        next: { revalidate: 86400 }, // Cache for 24h
      });
      if (metaRes.ok) {
        const meta = await metaRes.json();
        latestVersion = meta["dist-tags"]?.latest || "";
        description = meta.description || "";
      }
    } catch {
      // Non-fatal if metadata fails
    }

    return {
      packageName,
      downloadsLastDay: dayData.downloads || 0,
      downloadsLastWeek: weekData.downloads || 0,
      downloadsLastMonth: downloadsLastMonth || weekData.downloads * 4,
      dailyHistory,
      latestVersion,
      description,
    };
  } catch (err) {
    console.error(`Error fetching npm stats for ${packageName}:`, err);
    return null;
  }
}
