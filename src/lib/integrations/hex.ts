import { PUBLIC_APP_URL } from "@/lib/config/app-url";

export interface HexPackageStats {
  name: string;
  latestVersion: string;
  allDownloads: number;
  recentDownloads: number;
  weekDownloads: number;
  dayDownloads: number;
  releaseCount: number;
  licenses: string[];
  docsUrl?: string;
  description?: string;
}

export interface HexSearchItem {
  name: string;
  latestVersion: string;
  allDownloads: number;
  description?: string;
}

const HEADERS = {
  Accept: "application/json",
  "User-Agent": `DevPulse-HQ/1.0 (${PUBLIC_APP_URL})`,
};

export async function fetchHexStats(packageName: string): Promise<HexPackageStats | null> {
  try {
    const clean = packageName.trim().toLowerCase();
    if (!clean) return null;

    const res = await fetch(`https://hex.pm/api/packages/${encodeURIComponent(clean)}`, {
      headers: HEADERS,
      signal: AbortSignal.timeout(4500),
      cache: "no-store",
    }).catch(() => null);
    if (!res || !res.ok) return null;

    const json = await res.json();
    if (!json?.name) return null;

    const releases: any[] = Array.isArray(json.releases) ? json.releases : [];
    const latestVersion = String(
      json.latest_stable_version || json.latest_version || releases[0]?.version || "0.0.0"
    );

    return {
      name: String(json.name),
      latestVersion,
      allDownloads: Number(json.downloads?.all || 0),
      recentDownloads: Number(json.downloads?.recent || 0),
      weekDownloads: Number(json.downloads?.week || 0),
      dayDownloads: Number(json.downloads?.day || 0),
      releaseCount: releases.length,
      licenses: Array.isArray(json.meta?.licenses) ? json.meta.licenses.map(String) : [],
      docsUrl: json.docs_html_url ? String(json.docs_html_url) : undefined,
      description: json.meta?.description ? String(json.meta.description) : undefined,
    };
  } catch {
    return null;
  }
}

export async function searchHexPackages(query: string): Promise<HexSearchItem[]> {
  try {
    const res = await fetch(
      `https://hex.pm/api/packages?search=${encodeURIComponent(query)}&sort=downloads`,
      {
        headers: HEADERS,
        signal: AbortSignal.timeout(4500),
        cache: "no-store",
      }
    ).catch(() => null);
    if (!res || !res.ok) return [];
    const list = await res.json();
    if (!Array.isArray(list)) return [];
    return list
      .slice(0, 8)
      .filter((p: any) => p?.name)
      .map((p: any) => ({
        name: String(p.name),
        latestVersion: String(p.latest_stable_version || p.latest_version || ""),
        allDownloads: Number(p.downloads?.all || 0),
        description: p.meta?.description ? String(p.meta.description) : undefined,
      }));
  } catch {
    return [];
  }
}
