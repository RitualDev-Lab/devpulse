import { PUBLIC_APP_URL } from "@/lib/config/app-url";
/**
 * Go Modules Registry Service
 * Queries https://proxy.golang.org version list and @latest metadata. Zero tokens needed.
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

export function escapeGoModulePath(modulePath: string): string {
  return modulePath.trim().replace(/[A-Z]/g, (ch) => `!${ch.toLowerCase()}`);
}

export async function fetchGoModuleStats(modulePath: string): Promise<GoModuleStats | null> {
  try {
    const cleanPath = modulePath.trim();
    if (!cleanPath || !cleanPath.includes(".")) return null;

    const escaped = escapeGoModulePath(cleanPath);
    const headers = {
      "User-Agent": `DevPulse-HQ/1.0 (${PUBLIC_APP_URL})`,
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
        const latestJson = (await latestRes.json()) as { Version?: string; Time?: string };
        latestVersion = String(latestJson?.Version || "");
        publishedAt = latestJson?.Time || undefined;
      } catch {
        // Ignore malformed JSON
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
