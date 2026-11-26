import { PUBLIC_APP_URL } from "@/lib/config/app-url";

export interface MavenArtifactStats {
  coordinate: string; // groupId:artifactId
  groupId: string;
  artifactId: string;
  latestVersion: string;
  versionCount: number;
  packaging: string;
  updatedAt?: string;
}

export interface MavenSearchItem {
  coordinate: string;
  latestVersion: string;
  packaging: string;
  versionCount: number;
}

const HEADERS = {
  Accept: "application/json",
  "User-Agent": `DevPulse-HQ/1.0 (${PUBLIC_APP_URL})`,
};

export function parseMavenCoordinate(raw: string): { groupId: string; artifactId: string } | null {
  const clean = raw.trim();
  const sep = clean.includes(":") ? ":" : clean.includes("/") ? "/" : null;
  if (!sep) return null;
  const parts = clean.split(sep).map((s) => s.trim()).filter(Boolean);
  if (parts.length !== 2) return null;
  return { groupId: parts[0], artifactId: parts[1] };
}

export async function fetchMavenStats(coordinate: string): Promise<MavenArtifactStats | null> {
  try {
    const parsed = parseMavenCoordinate(coordinate);
    if (!parsed) return null;

    const query = `g:${parsed.groupId} AND a:${parsed.artifactId}`;
    const url = `https://search.maven.org/solrsearch/select?q=${encodeURIComponent(query)}&rows=5&wt=json`;
    const res = await fetch(url, {
      headers: HEADERS,
      signal: AbortSignal.timeout(4500),
      cache: "no-store",
    }).catch(() => null);
    if (!res || !res.ok) return null;

    const json = await res.json();
    const doc = json?.response?.docs?.[0];
    if (!doc?.g || !doc?.a) return null;

    return {
      coordinate: `${doc.g}:${doc.a}`,
      groupId: String(doc.g),
      artifactId: String(doc.a),
      latestVersion: String(doc.latestVersion || "0.0.0"),
      versionCount: Number(doc.versionCount || 1),
      packaging: String(doc.p || "jar"),
      updatedAt: typeof doc.timestamp === "number" ? new Date(doc.timestamp).toISOString() : undefined,
    };
  } catch {
    return null;
  }
}

export async function searchMavenArtifacts(query: string): Promise<MavenSearchItem[]> {
  try {
    const parsed = parseMavenCoordinate(query);
    const solrQuery = parsed
      ? `g:${parsed.groupId} AND a:${parsed.artifactId}`
      : query.trim();
    const url = `https://search.maven.org/solrsearch/select?q=${encodeURIComponent(solrQuery)}&rows=8&wt=json`;
    const res = await fetch(url, {
      headers: HEADERS,
      signal: AbortSignal.timeout(4500),
      cache: "no-store",
    }).catch(() => null);
    if (!res || !res.ok) return [];

    const json = await res.json();
    const docs: any[] = Array.isArray(json?.response?.docs) ? json.response.docs : [];
    return docs
      .filter((d) => d?.g && d?.a)
      .map((d) => ({
        coordinate: `${d.g}:${d.a}`,
        latestVersion: String(d.latestVersion || ""),
        packaging: String(d.p || "jar"),
        versionCount: Number(d.versionCount || 0),
      }));
  } catch {
    return [];
  }
}
