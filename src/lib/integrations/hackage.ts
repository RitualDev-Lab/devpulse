import { PUBLIC_APP_URL } from "@/lib/config/app-url";

export interface HackagePackageStats {
  packageName: string;
  latestVersion: string;
  normalVersions: string[];
  recentDownloads?: number | null;
}

export interface HackageSearchItem {
  name: string;
  latestVersion?: string;
}

const HEADERS = {
  Accept: "application/json",
  "User-Agent": `DevPulse-HQ/1.0 (${PUBLIC_APP_URL})`,
};

export async function fetchHackageStats(packageName: string): Promise<HackagePackageStats | null> {
  try {
    const clean = packageName.trim();
    if (!clean) return null;

    const prefRes = await fetch(
      `https://hackage.haskell.org/package/${encodeURIComponent(clean)}/preferred`,
      { headers: HEADERS, signal: AbortSignal.timeout(4500), cache: "no-store" }
    ).catch(() => null);
    if (!prefRes || !prefRes.ok) return null;

    const pref = await prefRes.json();
    const normalVersions: string[] = Array.isArray(pref?.["normal-version"])
      ? pref["normal-version"].map(String)
      : [];
    if (normalVersions.length === 0) return null;

    // Best-effort download count from Hackage package page HTML ("Recent downloads: N")
    let recentDownloads: number | null = null;
    try {
      const pageRes = await fetch(`https://hackage.haskell.org/package/${encodeURIComponent(clean)}`, {
        headers: { Accept: "text/html", "User-Agent": HEADERS["User-Agent"] },
        signal: AbortSignal.timeout(3500),
        cache: "no-store",
      }).catch(() => null);
      if (pageRes && pageRes.ok) {
        const html = await pageRes.text();
        const dlMatch = html.match(/Downloads<\/th>\s*<td[^>]*>\s*([0-9,]+)\s+recent/i);
        if (dlMatch?.[1]) {
          recentDownloads = Number(dlMatch[1].replace(/,/g, ""));
        }
      }
    } catch {
      recentDownloads = null;
    }

    return {
      packageName: clean,
      latestVersion: normalVersions[0],
      normalVersions,
      recentDownloads,
    };
  } catch {
    return null;
  }
}

export async function searchHackagePackages(query: string): Promise<HackageSearchItem[]> {
  try {
    const res = await fetch(
      `https://hackage.haskell.org/packages/search?terms=${encodeURIComponent(query)}`,
      { headers: HEADERS, signal: AbortSignal.timeout(4500), cache: "no-store" }
    ).catch(() => null);
    if (!res || !res.ok) return [];
    const list = await res.json();
    if (!Array.isArray(list)) return [];
    return list
      .slice(0, 8)
      .filter((p: any) => p?.name)
      .map((p: any) => ({ name: String(p.name) }));
  } catch {
    return [];
  }
}
