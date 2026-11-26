import { PUBLIC_APP_URL } from "@/lib/config/app-url";

export interface JuliaPackageStats {
  name: string;
  uuid: string;
  latestVersion: string;
  versionCount: number;
  repoUrl?: string;
}

export interface JuliaSearchItem {
  name: string;
  latestVersion?: string;
}

const HEADERS = {
  "User-Agent": `DevPulse-HQ/1.0 (${PUBLIC_APP_URL})`,
};

export async function fetchJuliaStats(packageName: string): Promise<JuliaPackageStats | null> {
  try {
    const clean = packageName.trim().replace(/\.jl$/i, "");
    if (!clean) return null;
    const initial = clean[0].toUpperCase();
    const baseUrl = `https://raw.githubusercontent.com/JuliaRegistries/General/master/${encodeURIComponent(initial)}/${encodeURIComponent(clean)}`;

    const [pkgRes, verRes] = await Promise.all([
      fetch(`${baseUrl}/Package.toml`, { headers: HEADERS, signal: AbortSignal.timeout(4500), cache: "no-store" }).catch(() => null),
      fetch(`${baseUrl}/Versions.toml`, { headers: HEADERS, signal: AbortSignal.timeout(4500), cache: "no-store" }).catch(() => null),
    ]);

    if (!pkgRes || !pkgRes.ok) return null;
    const pkgToml = await pkgRes.text();
    const uuidMatch = pkgToml.match(/^\s*uuid\s*=\s*"([^"]+)"/m);
    const repoMatch = pkgToml.match(/^\s*repo\s*=\s*"([^"]+)"/m);
    const nameMatch = pkgToml.match(/^\s*name\s*=\s*"([^"]+)"/m);
    if (!uuidMatch?.[1]) return null;

    let versions: string[] = [];
    if (verRes && verRes.ok) {
      const verToml = await verRes.text();
      versions = Array.from(verToml.matchAll(/^\[["']?([0-9]+\.[0-9]+\.[0-9]+[^"'\]]*)["']?\]/gm)).map((m) => m[1]);
    }

    return {
      name: nameMatch?.[1] || clean,
      uuid: uuidMatch[1],
      latestVersion: versions[versions.length - 1] || "0.1.0",
      versionCount: versions.length,
      repoUrl: repoMatch?.[1],
    };
  } catch {
    return null;
  }
}

export async function searchJuliaPackages(query: string): Promise<JuliaSearchItem[]> {
  const exact = await fetchJuliaStats(query);
  return exact ? [{ name: exact.name, latestVersion: exact.latestVersion }] : [];
}
