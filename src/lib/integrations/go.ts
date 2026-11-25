/**
 * Go Modules Registry Service
 * Interacts with public Go Module Proxy (https://proxy.golang.org)
 * Queries version list and latest release metadata. Zero tokens needed.
 */

export interface GoModuleStats {
  modulePath: string;
  latestVersion: string;
  publishedAt?: string;
  versionCount: number;
  recentVersions: string[];
  pkgGoDevUrl: string;
  proxyUrl: string;
}

/**
 * Escapes uppercase ASCII letters per Go module proxy protocol (`A` -> `!a`).
 */
export function escapeGoModulePath(modulePath: string): string {
  return modulePath
    .trim()
    .replace(/[A-Z]/g, (ch) => `!${ch.toLowerCase()}`);
}

export async function fetchGoModuleStats(modulePath: string): Promise<GoModuleStats | null> {
  try {
    const cleanPath = modulePath.trim();
    if (!cleanPath || !cleanPath.includes(".")) return null;

    const escaped = escapeGoModulePath(cleanPath);
    const headers = {
      "User-Agent": "DevPulse-HQ/1.0 (https://devpulse.ritualdev.in)",
    };

    const [latestRes, listRes] = await Promise.all([
      fetch(`https://proxy.golang.org/${escaped}/@latest`, {
        headers,
        next: { revalidate: 3600 },
      }).catch(() => null),
      fetch(`https://proxy.golang.org/${escaped}/@v/list`, {
        headers,
        next: { revalidate: 3600 },
      }).catch(() => null),
    ]);

    if ((!latestRes || !latestRes.ok) && (!listRes || !listRes.ok)) {
      return null;
    }

    let latestVersion = "";
    let publishedAt: string | undefined;

    if (latestRes && latestRes.ok) {
      try {
        const latestJson = await latestRes.json();
        latestVersion = String(latestJson?.Version || "");
        publishedAt = latestJson?.Time || undefined;
      } catch {
        // Ignore malformed @latest JSON
      }
    }

    let versions: string[] = [];
    if (listRes && listRes.ok) {
      try {
        const rawList = await listRes.text();
        versions = rawList
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter(Boolean);
      } catch {
        versions = [];
      }
    }

    if (!latestVersion && versions.length > 0) {
      latestVersion = versions[versions.length - 1];
    }

    if (!latestVersion) return null;

    return {
      modulePath: cleanPath,
      latestVersion,
      publishedAt,
      versionCount: Math.max(versions.length, 1),
      recentVersions: versions.slice(-6).reverse(),
      pkgGoDevUrl: `https://pkg.go.dev/${cleanPath}`,
      proxyUrl: `https://proxy.golang.org/${escaped}/@latest`,
    };
  } catch (err) {
    console.warn(`Error fetching Go module stats for ${modulePath}:`, err);
    return null;
  }
}
