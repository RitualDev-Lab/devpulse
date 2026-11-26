import { PUBLIC_APP_URL } from "@/lib/config/app-url";

export interface PackagistStats {
  packageName: string; // vendor/package
  latestVersion: string;
  totalDownloads: number;
  monthlyDownloads: number;
  dailyDownloads: number;
  dependents: number;
  favers: number;
  description?: string;
}

export interface PackagistSearchItem {
  name: string;
  description?: string;
  downloads: number;
  favers: number;
  url?: string;
}

const HEADERS = {
  Accept: "application/json",
  "User-Agent": `DevPulse-HQ/1.0 (${PUBLIC_APP_URL})`,
};

export async function fetchPackagistStats(packageName: string): Promise<PackagistStats | null> {
  try {
    const clean = packageName.trim().replace(/^\/+|\/+$/g, "");
    const parts = clean.split("/");
    if (parts.length !== 2 || !parts[0] || !parts[1]) return null;

    const url = `https://packagist.org/packages/${encodeURIComponent(parts[0])}/${encodeURIComponent(parts[1])}.json`;
    const res = await fetch(url, {
      headers: HEADERS,
      signal: AbortSignal.timeout(4500),
      cache: "no-store",
    }).catch(() => null);
    if (!res || !res.ok) return null;

    const json = await res.json();
    const pkg = json?.package;
    if (!pkg?.name) return null;

    const versionsObj = pkg.versions && typeof pkg.versions === "object" ? pkg.versions : {};
    const versionKeys = Object.keys(versionsObj).filter((v) => !v.startsWith("dev-"));
    const latestVersion = versionKeys[0] || Object.keys(versionsObj)[0] || "dev-main";

    return {
      packageName: String(pkg.name),
      latestVersion: String(latestVersion).replace(/^v/i, ""),
      totalDownloads: Number(pkg.downloads?.total || 0),
      monthlyDownloads: Number(pkg.downloads?.monthly || 0),
      dailyDownloads: Number(pkg.downloads?.daily || 0),
      dependents: Number(pkg.dependents || 0),
      favers: Number(pkg.favers || 0),
      description: pkg.description ? String(pkg.description) : undefined,
    };
  } catch {
    return null;
  }
}

export async function searchPackagistPackages(query: string): Promise<PackagistSearchItem[]> {
  try {
    const res = await fetch(
      `https://packagist.org/search.json?q=${encodeURIComponent(query)}&per_page=8`,
      {
        headers: HEADERS,
        signal: AbortSignal.timeout(4500),
        cache: "no-store",
      }
    ).catch(() => null);
    if (!res || !res.ok) return [];
    const json = await res.json();
    const list: any[] = Array.isArray(json?.results) ? json.results : [];
    return list
      .filter((p) => p?.name)
      .map((p) => ({
        name: String(p.name),
        description: p.description ? String(p.description) : undefined,
        downloads: Number(p.downloads || 0),
        favers: Number(p.favers || 0),
        url: p.url ? String(p.url) : `https://packagist.org/packages/${p.name}`,
      }));
  } catch {
    return [];
  }
}
