import { PUBLIC_APP_URL } from "@/lib/config/app-url";
/**
 * Python Ecosystem (PyPI) Service
 * Interacts with public PyPI APIs (pypistats.org and pypi.org)
 * Ingests:
 * - Real-time downloads & non-mirror downloads
 * - Python minor version distribution (3.12, 3.11, etc.)
 * - Operating system distribution (Linux, Darwin, Windows)
 * - Release history & version count
 * Requires ZERO private tokens.
 */

export interface PythonVersionShare {
  version: string;
  downloads: number;
  percentage: number;
}

export interface PyPiStats {
  packageName: string;
  downloadsLastDay: number;
  downloadsLastWeek: number;
  downloadsLastMonth: number;
  dailyHistory: Array<{ date: string; downloads: number }>;
  pythonVersions: PythonVersionShare[];
  systems: Array<{ system: string; downloads: number }>;
  latestVersion?: string;
  totalReleases: number;
  description?: string;
}

export async function fetchPyPiStats(packageName: string): Promise<PyPiStats | null> {
  try {
    const cleanPkg = encodeURIComponent(packageName.toLowerCase().trim());
    const headers = {
      "User-Agent": `DevPulse-HQ/1.0 (${PUBLIC_APP_URL})`,
      Accept: "application/json",
    };

    // Parallel fetch: Recent, Overall, Python Minor versions, System, and PyPI JSON
    const [recentRes, overallRes, pyMinorRes, systemRes, metaRes] = await Promise.all([
      fetch(`https://pypistats.org/api/packages/${cleanPkg}/recent`, {
        headers,
        next: { revalidate: 3600 },
      }).catch(() => null),
      fetch(`https://pypistats.org/api/packages/${cleanPkg}/overall`, {
        headers,
        next: { revalidate: 3600 },
      }).catch(() => null),
      fetch(`https://pypistats.org/api/packages/${cleanPkg}/python_minor`, {
        headers,
        next: { revalidate: 7200 },
      }).catch(() => null),
      fetch(`https://pypistats.org/api/packages/${cleanPkg}/system`, {
        headers,
        next: { revalidate: 7200 },
      }).catch(() => null),
      fetch(`https://pypi.org/pypi/${cleanPkg}/json`, {
        headers,
        next: { revalidate: 86400 },
      }).catch(() => null),
    ]);

    let downloadsLastDay = 0;
    let downloadsLastWeek = 0;
    let downloadsLastMonth = 0;

    if (recentRes && recentRes.ok) {
      try {
        const recentJson = await recentRes.json();
        downloadsLastDay = recentJson.data?.last_day || 0;
        downloadsLastWeek = recentJson.data?.last_week || 0;
        downloadsLastMonth = recentJson.data?.last_month || 0;
      } catch {
        // ignore
      }
    }

    // 2. Fetch overall time-series history (without_mirrors)
    let dailyHistory: Array<{ date: string; downloads: number }> = [];
    if (overallRes && overallRes.ok) {
      try {
        const overallJson = await overallRes.json();
        if (Array.isArray(overallJson.data)) {
          const withoutMirrors = overallJson.data.filter(
            (d: { category: string }) => d.category === "without_mirrors"
          );
          const targetData = withoutMirrors.length > 0 ? withoutMirrors : overallJson.data;

          dailyHistory = targetData.slice(-30).map((d: { date: string; downloads: number }) => ({
            date: d.date,
            downloads: d.downloads,
          }));

          // Fallback if /recent endpoint was lagged or unpopulated
          if (downloadsLastDay === 0 && dailyHistory.length > 0) {
            downloadsLastDay = dailyHistory[dailyHistory.length - 1].downloads;
            downloadsLastWeek = dailyHistory.slice(-7).reduce((acc, curr) => acc + curr.downloads, 0);
            downloadsLastMonth = dailyHistory.reduce((acc, curr) => acc + curr.downloads, 0);
          }
        }
      } catch {
        // ignore
      }
    }

    // 3. Python Version Distribution
    const pythonVersions: PythonVersionShare[] = [];
    if (pyMinorRes && pyMinorRes.ok) {
      try {
        const pyMinorJson = await pyMinorRes.json();
        if (Array.isArray(pyMinorJson.data)) {
          const versionMap: Record<string, number> = {};
          let totalVersionDl = 0;

          // Aggregate latest date's downloads by category/version
          for (const item of pyMinorJson.data) {
            const ver = item.category || "other";
            if (ver !== "null") {
              versionMap[ver] = (versionMap[ver] || 0) + (item.downloads || 0);
              totalVersionDl += item.downloads || 0;
            }
          }

          const sorted = Object.entries(versionMap).sort((a, b) => b[1] - a[1]);
          for (const [ver, count] of sorted.slice(0, 5)) {
            const pct = totalVersionDl > 0 ? Math.round((count / totalVersionDl) * 100) : 0;
            pythonVersions.push({
              version: ver,
              downloads: count,
              percentage: pct,
            });
          }
        }
      } catch {
        // ignore
      }
    }

    // 4. Operating System Distribution
    const systems: Array<{ system: string; downloads: number }> = [];
    if (systemRes && systemRes.ok) {
      try {
        const sysJson = await systemRes.json();
        if (Array.isArray(sysJson.data)) {
          const sysMap: Record<string, number> = {};
          for (const item of sysJson.data) {
            const s = item.category || "other";
            if (s !== "null") {
              sysMap[s] = (sysMap[s] || 0) + (item.downloads || 0);
            }
          }
          for (const [system, count] of Object.entries(sysMap).sort((a, b) => b[1] - a[1]).slice(0, 4)) {
            systems.push({ system, downloads: count });
          }
        }
      } catch {
        // ignore
      }
    }

    // 5. Official PyPI Metadata (Releases count, version, description)
    let latestVersion = "";
    let description = "";
    let totalReleases = 0;

    if (metaRes && metaRes.ok) {
      try {
        const meta = await metaRes.json();
        latestVersion = meta.info?.version || "";
        description = meta.info?.summary || "";
        if (meta.releases && typeof meta.releases === "object") {
          totalReleases = Object.keys(meta.releases).length;
        }
      } catch {
        // ignore
      }
    }

    return {
      packageName,
      downloadsLastDay,
      downloadsLastWeek,
      downloadsLastMonth,
      dailyHistory,
      pythonVersions,
      systems,
      latestVersion,
      totalReleases,
      description,
    };
  } catch (err) {
    console.error(`Error fetching PyPI stats for ${packageName}:`, err);
    return null;
  }
}
