import { PUBLIC_APP_URL } from "@/lib/config/app-url";

export interface AnacondaPackageStats {
  identifier: string; // channel/package
  channel: string;
  name: string;
  latestVersion: string;
  totalDownloads: number;
  platforms: string[];
  license?: string;
  summary?: string;
}

export interface AnacondaSearchItem {
  identifier: string;
  summary?: string;
  versionsCount?: number;
}

const HEADERS = {
  Accept: "application/json",
  "User-Agent": `DevPulse-HQ/1.0 (${PUBLIC_APP_URL})`,
};

export function normalizeAnacondaIdentifier(raw: string): { channel: string; name: string } {
  const clean = raw.trim().replace(/^\/+|\/+$/g, "");
  if (clean.includes("/")) {
    const [channel, ...rest] = clean.split("/");
    return { channel: channel || "conda-forge", name: rest.join("/") };
  }
  return { channel: "conda-forge", name: clean };
}

export async function fetchAnacondaStats(identifier: string): Promise<AnacondaPackageStats | null> {
  try {
    const { channel, name } = normalizeAnacondaIdentifier(identifier);
    if (!name) return null;

    const url = `https://api.anaconda.org/package/${encodeURIComponent(channel)}/${encodeURIComponent(name)}`;
    const res = await fetch(url, {
      headers: HEADERS,
      signal: AbortSignal.timeout(4500),
      cache: "no-store",
    }).catch(() => null);
    if (!res || !res.ok) return null;

    const json = await res.json();
    if (!json?.name) return null;

    const files: any[] = Array.isArray(json.files) ? json.files : [];
    let totalDownloads = 0;
    const platformSet = new Set<string>();

    for (const file of files) {
      totalDownloads += Number(file?.ndownloads || 0);
      const subdir = file?.attrs?.subdir;
      if (subdir) platformSet.add(String(subdir));
    }

    return {
      identifier: `${channel}/${json.name}`,
      channel,
      name: String(json.name),
      latestVersion: String(json.latest_version || ""),
      totalDownloads,
      platforms: Array.from(platformSet).slice(0, 12),
      license: json.license ? String(json.license) : undefined,
      summary: json.summary ? String(json.summary) : undefined,
    };
  } catch {
    return null;
  }
}

export async function searchAnacondaPackages(query: string): Promise<AnacondaSearchItem[]> {
  try {
    const res = await fetch(
      `https://api.anaconda.org/search?name=${encodeURIComponent(query)}`,
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
      .filter((p: any) => p?.full_name || (p?.owner && p?.name))
      .map((p: any) => ({
        identifier: String(p.full_name || `${p.owner}/${p.name}`),
        summary: p.summary ? String(p.summary) : undefined,
        versionsCount: Array.isArray(p.versions) ? p.versions.length : undefined,
      }));
  } catch {
    return [];
  }
}
