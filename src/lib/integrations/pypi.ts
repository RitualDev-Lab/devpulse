/**
 * PyPI Service
 * Interacts with public PyPI APIs (pypistats.org and pypi.org)
 * Requires ZERO private tokens.
 */

export interface PyPiStats {
  packageName: string;
  downloadsLastDay: number;
  downloadsLastWeek: number;
  downloadsLastMonth: number;
  dailyHistory: Array<{ date: string; downloads: number }>;
  latestVersion?: string;
  description?: string;
}

export async function fetchPyPiStats(packageName: string): Promise<PyPiStats | null> {
  try {
    const cleanPkg = encodeURIComponent(packageName.toLowerCase().trim());

    // 1. Fetch recent download counts (last_day, last_week, last_month)
    const recentRes = await fetch(`https://pypistats.org/api/packages/${cleanPkg}/recent`, {
      next: { revalidate: 3600 },
    });

    let downloadsLastDay = 0;
    let downloadsLastWeek = 0;
    let downloadsLastMonth = 0;

    if (recentRes.ok) {
      const recentJson = await recentRes.json();
      downloadsLastDay = recentJson.data?.last_day || 0;
      downloadsLastWeek = recentJson.data?.last_week || 0;
      downloadsLastMonth = recentJson.data?.last_month || 0;
    }

    // 2. Fetch overall time-series history
    let dailyHistory: Array<{ date: string; downloads: number }> = [];
    try {
      const overallRes = await fetch(`https://pypistats.org/api/packages/${cleanPkg}/overall`, {
        next: { revalidate: 3600 },
      });
      if (overallRes.ok) {
        const overallJson = await overallRes.json();
        if (Array.isArray(overallJson.data)) {
          // Filter to 'without_mirrors' category if available, otherwise take total
          const withoutMirrors = overallJson.data.filter((d: { category: string }) => d.category === "without_mirrors");
          const targetData = withoutMirrors.length > 0 ? withoutMirrors : overallJson.data;

          // Take last 30 entries
          dailyHistory = targetData.slice(-30).map((d: { date: string; downloads: number }) => ({
            date: d.date,
            downloads: d.downloads,
          }));
        }
      }
    } catch {
      // Historical trends fallback
    }

    // 3. Fetch package metadata from official PyPI JSON endpoint
    let latestVersion = "";
    let description = "";
    try {
      const metaRes = await fetch(`https://pypi.org/pypi/${cleanPkg}/json`, {
        next: { revalidate: 86400 },
      });
      if (metaRes.ok) {
        const meta = await metaRes.json();
        latestVersion = meta.info?.version || "";
        description = meta.info?.summary || "";
      }
    } catch {
      // Non-fatal
    }

    return {
      packageName,
      downloadsLastDay,
      downloadsLastWeek,
      downloadsLastMonth,
      dailyHistory,
      latestVersion,
      description,
    };
  } catch (err) {
    console.error(`Error fetching PyPI stats for ${packageName}:`, err);
    return null;
  }
}
