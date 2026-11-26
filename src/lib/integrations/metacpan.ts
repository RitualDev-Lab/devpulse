import { PUBLIC_APP_URL } from "@/lib/config/app-url";

export interface MetaCpanStats {
  distribution: string;
  version: string;
  abstract?: string;
  license: string[];
  favorites: number;
  releaseDate?: string;
}

export interface MetaCpanSearchItem {
  distribution: string;
  version: string;
  abstract?: string;
}

const HEADERS = {
  Accept: "application/json",
  "User-Agent": `DevPulse-HQ/1.0 (${PUBLIC_APP_URL})`,
};

export function normalizeCpanDistribution(raw: string): string {
  return raw.trim().replace(/::/g, "-");
}

export async function fetchMetaCpanStats(name: string): Promise<MetaCpanStats | null> {
  try {
    const dist = normalizeCpanDistribution(name);
    if (!dist) return null;

    const [relRes, favRes] = await Promise.all([
      fetch(`https://fastapi.metacpan.org/v1/release/${encodeURIComponent(dist)}`, {
        headers: HEADERS,
        signal: AbortSignal.timeout(4500),
        cache: "no-store",
      }).catch(() => null),
      fetch(`https://fastapi.metacpan.org/v1/favorite/_search?q=distribution:${encodeURIComponent(dist)}&size=0`, {
        headers: HEADERS,
        signal: AbortSignal.timeout(3500),
        cache: "no-store",
      }).catch(() => null),
    ]);

    if (!relRes || !relRes.ok) return null;
    const rel = await relRes.json();
    if (!rel?.distribution) return null;

    let favorites = 0;
    if (favRes && favRes.ok) {
      const favJson = await favRes.json().catch(() => null);
      favorites = Number(favJson?.hits?.total?.value ?? favJson?.hits?.total ?? 0);
    }

    return {
      distribution: String(rel.distribution),
      version: String(rel.version || "0.0"),
      abstract: rel.abstract ? String(rel.abstract) : undefined,
      license: Array.isArray(rel.license) ? rel.license.map(String) : rel.license ? [String(rel.license)] : [],
      favorites,
      releaseDate: rel.date ? String(rel.date) : undefined,
    };
  } catch {
    return null;
  }
}

export async function searchMetaCpanPackages(query: string): Promise<MetaCpanSearchItem[]> {
  try {
    const res = await fetch(
      `https://fastapi.metacpan.org/v1/release/_search?q=status:latest+AND+${encodeURIComponent(query)}&size=8`,
      { headers: HEADERS, signal: AbortSignal.timeout(4500), cache: "no-store" }
    ).catch(() => null);
    if (!res || !res.ok) return [];
    const json = await res.json();
    const hits: any[] = Array.isArray(json?.hits?.hits) ? json.hits.hits : [];
    const seen = new Set<string>();
    const out: MetaCpanSearchItem[] = [];
    for (const h of hits) {
      const src = h?._source;
      if (!src?.distribution || seen.has(src.distribution)) continue;
      seen.add(src.distribution);
      out.push({
        distribution: String(src.distribution),
        version: String(src.version || ""),
        abstract: src.abstract ? String(src.abstract) : undefined,
      });
    }
    return out;
  } catch {
    return [];
  }
}
