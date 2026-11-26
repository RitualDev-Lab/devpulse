import { PUBLIC_APP_URL } from "@/lib/config/app-url";

export interface CranPackageStats {
  packageName: string;
  version: string;
  downloadsLastMonth: number;
  dailyHistory: Array<{ date: string; downloads: number }>;
  title?: string;
  license?: string;
}

export interface CranSearchItem {
  name: string;
  version?: string;
  title?: string;
}

const HEADERS = {
  Accept: "application/json",
  "User-Agent": `DevPulse-HQ/1.0 (${PUBLIC_APP_URL})`,
};

export async function fetchCranStats(packageName: string): Promise<CranPackageStats | null> {
  try {
    const clean = packageName.trim();
    if (!clean) return null;
    const encoded = encodeURIComponent(clean);

    const [metaRes, dailyRes] = await Promise.all([
      fetch(`https://crandb.r-pkg.org/${encoded}`, {
        headers: HEADERS,
        signal: AbortSignal.timeout(4500),
        cache: "no-store",
      }).catch(() => null),
      fetch(`https://cranlogs.r-pkg.org/downloads/daily/last-month/${encoded}`, {
        headers: HEADERS,
        signal: AbortSignal.timeout(4500),
        cache: "no-store",
      }).catch(() => null),
    ]);

    if (!metaRes || !metaRes.ok) return null;
    const meta = await metaRes.json();
    if (!meta?.Package) return null;

    let dailyHistory: Array<{ date: string; downloads: number }> = [];
    let downloadsLastMonth = 0;
    if (dailyRes && dailyRes.ok) {
      try {
        const dlArr = await dailyRes.json();
        const points = Array.isArray(dlArr) ? dlArr[0]?.downloads : [];
        if (Array.isArray(points)) {
          dailyHistory = points.map((d: any) => {
            const val = Number(d.downloads || 0);
            downloadsLastMonth += val;
            return { date: String(d.day || ""), downloads: val };
          });
        }
      } catch {
        dailyHistory = [];
      }
    }

    return {
      packageName: String(meta.Package),
      version: String(meta.Version || "0.0.0"),
      downloadsLastMonth,
      dailyHistory: dailyHistory.slice(-30),
      title: meta.Title ? String(meta.Title) : undefined,
      license: meta.License ? String(meta.License) : undefined,
    };
  } catch {
    return null;
  }
}

export async function searchCranPackages(query: string): Promise<CranSearchItem[]> {
  try {
    const res = await fetch(
      `https://search.r-pkg.org/package/_search?q=${encodeURIComponent(query)}&size=8`,
      {
        headers: HEADERS,
        signal: AbortSignal.timeout(4000),
        cache: "no-store",
      }
    ).catch(() => null);

    if (res && res.ok) {
      const json = await res.json();
      const hits: any[] = Array.isArray(json?.hits?.hits) ? json.hits.hits : [];
      const mapped = hits
        .filter((h) => h?._source?.Package)
        .map((h) => ({
          name: String(h._source.Package),
          version: h._source.Version ? String(h._source.Version) : undefined,
          title: h._source.Title ? String(h._source.Title) : undefined,
        }));
      if (mapped.length > 0) return mapped;
    }

    // Fallback exact lookup on crandb
    const exact = await fetchCranStats(query);
    return exact ? [{ name: exact.packageName, version: exact.version, title: exact.title }] : [];
  } catch {
    return [];
  }
}
