import { PUBLIC_APP_URL } from "@/lib/config/app-url";

export interface RubyGemStats {
  name: string;
  version: string;
  totalDownloads: number;
  versionDownloads: number;
  reverseDependencies: number;
  authors?: string;
  info?: string;
  licenses: string[];
  homepageUri?: string;
}

export interface RubyGemSearchItem {
  name: string;
  version: string;
  downloads: number;
  info?: string;
}

const HEADERS = {
  Accept: "application/json",
  "User-Agent": `DevPulse-HQ/1.0 (${PUBLIC_APP_URL})`,
};

export async function fetchRubyGemStats(gemName: string): Promise<RubyGemStats | null> {
  try {
    const clean = gemName.trim();
    if (!clean) return null;
    const encoded = encodeURIComponent(clean);

    const [gemRes, revRes] = await Promise.all([
      fetch(`https://rubygems.org/api/v1/gems/${encoded}.json`, {
        headers: HEADERS,
        signal: AbortSignal.timeout(4500),
        cache: "no-store",
      }).catch(() => null),
      fetch(`https://rubygems.org/api/v1/gems/${encoded}/reverse_dependencies.json`, {
        headers: HEADERS,
        signal: AbortSignal.timeout(4500),
        cache: "no-store",
      }).catch(() => null),
    ]);

    if (!gemRes || !gemRes.ok) return null;
    const gem = await gemRes.json();
    if (!gem?.name) return null;

    let reverseDependencies = 0;
    if (revRes && revRes.ok) {
      try {
        const revJson = await revRes.json();
        if (Array.isArray(revJson)) reverseDependencies = revJson.length;
      } catch {
        reverseDependencies = 0;
      }
    }

    return {
      name: String(gem.name),
      version: String(gem.version || "0.0.0"),
      totalDownloads: Number(gem.downloads || 0),
      versionDownloads: Number(gem.version_downloads || 0),
      reverseDependencies,
      authors: gem.authors ? String(gem.authors) : undefined,
      info: gem.info ? String(gem.info) : undefined,
      licenses: Array.isArray(gem.licenses) ? gem.licenses.map(String) : [],
      homepageUri: gem.homepage_uri || gem.project_uri || undefined,
    };
  } catch {
    return null;
  }
}

export async function searchRubyGems(query: string): Promise<RubyGemSearchItem[]> {
  try {
    const res = await fetch(
      `https://rubygems.org/api/v1/search.json?query=${encodeURIComponent(query)}`,
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
      .filter((g: any) => g?.name)
      .map((g: any) => ({
        name: String(g.name),
        version: String(g.version || ""),
        downloads: Number(g.downloads || 0),
        info: g.info ? String(g.info) : undefined,
      }));
  } catch {
    return [];
  }
}
