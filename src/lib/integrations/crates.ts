/**
 * Rust Crates.io Service
 * Interacts with public crates.io API (https://crates.io/api/v1/crates/{crate})
 * Fetches:
 * - Real-time downloads & 90-day velocity history
 * - Reverse dependencies (ecosystem adoption & dependency health)
 * - Version release metadata
 * Requires ZERO private tokens.
 */

export interface RustCrateStats {
  crateName: string;
  totalDownloads: number;
  recentDownloads: number; // 90-day download count
  maxVersion: string;
  reverseDependencies: number;
  dailyHistory: Array<{ date: string; downloads: number }>;
  categories: string[];
  description?: string;
  homepage?: string;
  repository?: string;
  documentation?: string;
  updatedAt?: string;
}

export async function fetchRustCrateStats(crateName: string): Promise<RustCrateStats | null> {
  try {
    const cleanName = encodeURIComponent(crateName.trim().toLowerCase());
    const headers = {
      "User-Agent": "DevPulse-HQ/1.0 (https://devpulse.ritualdev.in; contact: dev@ritualdev.in)",
      Accept: "application/json",
    };

    // Respect crates.io <=1 req/sec crawler policy via sequential/cached requests
    const crateRes = await fetch(`https://crates.io/api/v1/crates/${cleanName}`, {
      headers,
      next: { revalidate: 3600 },
    }).catch(() => null);
    if (!crateRes || !crateRes.ok) {
      return null;
    }

    const revRes = await fetch(`https://crates.io/api/v1/crates/${cleanName}/reverse_dependencies`, {
      headers,
      next: { revalidate: 7200 },
    }).catch(() => null);

    const dlRes = await fetch(`https://crates.io/api/v1/crates/${cleanName}/downloads`, {
      headers,
      next: { revalidate: 3600 },
    }).catch(() => null);

    const crateJson = await crateRes.json();
    const c = crateJson.crate;
    if (!c) return null;

    // Parse reverse dependencies
    let reverseDependencies = 0;
    if (revRes && revRes.ok) {
      try {
        const revJson = await revRes.json();
        reverseDependencies = revJson.meta?.total || (Array.isArray(revJson.dependencies) ? revJson.dependencies.length : 0);
      } catch {
        reverseDependencies = 0;
      }
    }

    // Parse download history (aggregate daily downloads from versions)
    const dailyMap: Record<string, number> = {};
    if (dlRes && dlRes.ok) {
      try {
        const dlJson = await dlRes.json();
        if (Array.isArray(dlJson.version_downloads)) {
          for (const item of dlJson.version_downloads) {
            if (item.date && item.downloads) {
              dailyMap[item.date] = (dailyMap[item.date] || 0) + item.downloads;
            }
          }
        }
      } catch {
        // ignore
      }
    }

    const dailyHistory = Object.entries(dailyMap)
      .map(([date, downloads]) => ({ date, downloads }))
      .sort((a, b) => a.date.localeCompare(b.date))
      .slice(-30);

    return {
      crateName: c.name || crateName,
      totalDownloads: c.downloads || 0,
      recentDownloads: c.recent_downloads || 0,
      maxVersion: c.max_version || c.default_version || "0.1.0",
      reverseDependencies,
      dailyHistory,
      categories: Array.isArray(c.categories) ? c.categories : [],
      description: c.description || "",
      homepage: c.homepage || undefined,
      repository: c.repository || undefined,
      documentation: c.documentation || `https://docs.rs/${cleanName}`,
      updatedAt: c.updated_at || undefined,
    };
  } catch (err) {
    console.warn(`Failed to fetch crate stats for ${crateName}:`, err);
    return null;
  }
}
