import { PUBLIC_APP_URL } from "@/lib/config/app-url";

export interface NuGetPackageStats {
  packageId: string;
  version: string;
  totalDownloads: number;
  verified: boolean;
  owners: string[];
  description?: string;
  projectUrl?: string;
  versionCount: number;
}

export interface NuGetSearchItem {
  id: string;
  version: string;
  description?: string;
  totalDownloads: number;
  verified: boolean;
}

const HEADERS = {
  Accept: "application/json",
  "User-Agent": `DevPulse-HQ/1.0 (${PUBLIC_APP_URL})`,
};

export async function fetchNuGetStats(packageId: string): Promise<NuGetPackageStats | null> {
  try {
    const clean = packageId.trim();
    if (!clean) return null;

    const url = `https://azuresearch-usnc.nuget.org/query?q=${encodeURIComponent(`packageid:${clean}`)}&prerelease=false&take=5`;
    const res = await fetch(url, {
      headers: HEADERS,
      signal: AbortSignal.timeout(4500),
      cache: "no-store",
    }).catch(() => null);
    if (!res || !res.ok) return null;

    const json = await res.json();
    const list: any[] = Array.isArray(json?.data) ? json.data : [];
    const match =
      list.find((d) => String(d.id || "").toLowerCase() === clean.toLowerCase()) || list[0];
    if (!match?.id) return null;

    return {
      packageId: String(match.id),
      version: String(match.version || "0.0.0"),
      totalDownloads: Number(match.totalDownloads || 0),
      verified: Boolean(match.verified),
      owners: Array.isArray(match.owners) ? match.owners.map(String) : [],
      description: match.description ? String(match.description) : undefined,
      projectUrl: match.projectUrl ? String(match.projectUrl) : undefined,
      versionCount: Array.isArray(match.versions) ? match.versions.length : 1,
    };
  } catch {
    return null;
  }
}

export async function searchNuGetPackages(query: string): Promise<NuGetSearchItem[]> {
  try {
    const url = `https://azuresearch-usnc.nuget.org/query?q=${encodeURIComponent(query)}&prerelease=false&take=8`;
    const res = await fetch(url, {
      headers: HEADERS,
      signal: AbortSignal.timeout(4500),
      cache: "no-store",
    }).catch(() => null);
    if (!res || !res.ok) return [];
    const json = await res.json();
    const list: any[] = Array.isArray(json?.data) ? json.data : [];
    return list
      .filter((d) => d?.id)
      .map((d) => ({
        id: String(d.id),
        version: String(d.version || ""),
        description: d.description ? String(d.description) : undefined,
        totalDownloads: Number(d.totalDownloads || 0),
        verified: Boolean(d.verified),
      }));
  } catch {
    return [];
  }
}
