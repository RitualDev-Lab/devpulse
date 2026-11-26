import { PUBLIC_APP_URL } from "@/lib/config/app-url";

export interface PubDevStats {
  packageName: string;
  latestVersion: string;
  downloadCount30Days: number;
  grantedPoints: number;
  maxPoints: number;
  likeCount: number;
  popularityScore: number;
  tags: string[];
  description?: string;
}

export interface PubDevSearchItem {
  name: string;
}

const HEADERS = {
  Accept: "application/json",
  "User-Agent": `DevPulse-HQ/1.0 (${PUBLIC_APP_URL})`,
};

export async function fetchPubDevStats(packageName: string): Promise<PubDevStats | null> {
  try {
    const clean = packageName.trim();
    if (!clean) return null;
    const encoded = encodeURIComponent(clean);

    const [pkgRes, scoreRes] = await Promise.all([
      fetch(`https://pub.dev/api/packages/${encoded}`, {
        headers: HEADERS,
        signal: AbortSignal.timeout(4500),
        cache: "no-store",
      }).catch(() => null),
      fetch(`https://pub.dev/api/packages/${encoded}/score`, {
        headers: HEADERS,
        signal: AbortSignal.timeout(4500),
        cache: "no-store",
      }).catch(() => null),
    ]);

    if (!pkgRes || !pkgRes.ok) return null;
    const pkg = await pkgRes.json();
    if (!pkg?.name) return null;

    const score = scoreRes && scoreRes.ok ? await scoreRes.json().catch(() => ({})) : {};

    return {
      packageName: String(pkg.name),
      latestVersion: String(pkg.latest?.version || "0.0.0"),
      downloadCount30Days: Number(score.downloadCount30Days || 0),
      grantedPoints: Number(score.grantedPoints || 0),
      maxPoints: Number(score.maxPoints || 160),
      likeCount: Number(score.likeCount || 0),
      popularityScore: Number(score.popularityScore || 0),
      tags: Array.isArray(score.tags) ? score.tags.map(String).slice(0, 12) : [],
      description: pkg.latest?.pubspec?.description
        ? String(pkg.latest.pubspec.description)
        : undefined,
    };
  } catch {
    return null;
  }
}

export async function searchPubDevPackages(query: string): Promise<PubDevSearchItem[]> {
  try {
    const res = await fetch(
      `https://pub.dev/api/search?q=${encodeURIComponent(query)}`,
      {
        headers: HEADERS,
        signal: AbortSignal.timeout(4500),
        cache: "no-store",
      }
    ).catch(() => null);
    if (!res || !res.ok) return [];
    const json = await res.json();
    const list: any[] = Array.isArray(json?.packages) ? json.packages : [];
    return list
      .slice(0, 8)
      .filter((p) => p?.package)
      .map((p) => ({ name: String(p.package) }));
  } catch {
    return [];
  }
}
