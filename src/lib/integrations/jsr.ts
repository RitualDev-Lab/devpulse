import { PUBLIC_APP_URL } from "@/lib/config/app-url";

export interface JsrStats {
  packageName: string; // @scope/name
  scope: string;
  name: string;
  latestVersion: string;
  score: number | null;
  versionCount: number;
  dependencyCount: number;
  runtimeCompat: Record<string, boolean | undefined>;
  description?: string;
}

export interface JsrSearchItem {
  name: string;
  description?: string;
  score?: number | null;
  latestVersion?: string | null;
}

const HEADERS = {
  Accept: "application/json",
  "User-Agent": `DevPulse-HQ/1.0 (${PUBLIC_APP_URL})`,
};

export function parseJsrIdentifier(raw: string): { scope: string; name: string } | null {
  const clean = raw.trim().replace(/^@/, "");
  const parts = clean.split("/");
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  return { scope: parts[0], name: parts[1] };
}

export async function fetchJsrStats(identifier: string): Promise<JsrStats | null> {
  try {
    const parsed = parseJsrIdentifier(identifier);
    if (!parsed) return null;

    const url = `https://api.jsr.io/scopes/${encodeURIComponent(parsed.scope)}/packages/${encodeURIComponent(parsed.name)}`;
    const res = await fetch(url, {
      headers: HEADERS,
      signal: AbortSignal.timeout(4500),
      cache: "no-store",
    }).catch(() => null);
    if (!res || !res.ok) return null;

    const json = await res.json();
    if (!json?.name) return null;

    return {
      packageName: `@${json.scope || parsed.scope}/${json.name}`,
      scope: String(json.scope || parsed.scope),
      name: String(json.name),
      latestVersion: String(json.latestVersion || "0.0.0"),
      score: typeof json.score === "number" ? json.score : null,
      versionCount: Number(json.versionCount || 0),
      dependencyCount: Number(json.dependencyCount || 0),
      runtimeCompat:
        json.runtimeCompat && typeof json.runtimeCompat === "object" ? json.runtimeCompat : {},
      description: json.description ? String(json.description) : undefined,
    };
  } catch {
    return null;
  }
}

export async function searchJsrPackages(query: string): Promise<JsrSearchItem[]> {
  try {
    const res = await fetch(
      `https://api.jsr.io/packages?query=${encodeURIComponent(query)}&limit=8`,
      {
        headers: HEADERS,
        signal: AbortSignal.timeout(4500),
        cache: "no-store",
      }
    ).catch(() => null);
    if (!res || !res.ok) return [];
    const json = await res.json();
    const list: any[] = Array.isArray(json?.items) ? json.items : [];
    return list
      .filter((p) => p?.scope && p?.name)
      .map((p) => ({
        name: `@${p.scope}/${p.name}`,
        description: p.description ? String(p.description) : undefined,
        score: typeof p.score === "number" ? p.score : null,
        latestVersion: p.latestVersion ? String(p.latestVersion) : null,
      }));
  } catch {
    return [];
  }
}
