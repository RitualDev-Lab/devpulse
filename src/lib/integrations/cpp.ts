import { PUBLIC_APP_URL } from "@/lib/config/app-url";

export interface CppPackageStats {
  identifier: string; // e.g. conan:fmt or vcpkg:zlib or wrap:sqlite3
  registry: "conan" | "vcpkg" | "wrapdb";
  name: string;
  latestVersion: string;
  versionCount: number;
  triplets: string[];
  description?: string;
}

export interface CppSearchItem {
  identifier: string;
  registry: "conan" | "vcpkg" | "wrapdb";
  name: string;
  description?: string;
}

const GH_HEADERS: Record<string, string> = {
  Accept: "application/vnd.github.v3+json",
  "User-Agent": `DevPulse-HQ/1.0 (${PUBLIC_APP_URL})`,
  ...(process.env.GITHUB_TOKEN ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {}),
};

export function parseCppIdentifier(raw: string): { registry: "conan" | "vcpkg" | "wrapdb" | "auto"; name: string } {
  const clean = raw.trim().toLowerCase();
  if (clean.startsWith("conan:")) return { registry: "conan", name: clean.slice("conan:".length) };
  if (clean.startsWith("vcpkg:")) return { registry: "vcpkg", name: clean.slice("vcpkg:".length) };
  if (clean.startsWith("wrap:") || clean.startsWith("wrapdb:")) {
    return { registry: "wrapdb", name: clean.replace(/^wrap(db)?:/, "") };
  }
  return { registry: "auto", name: clean };
}

async function fetchConanRecipe(name: string): Promise<CppPackageStats | null> {
  const res = await fetch(
    `https://raw.githubusercontent.com/conan-io/conan-center-index/master/recipes/${encodeURIComponent(name)}/config.yml`,
    { headers: { "User-Agent": GH_HEADERS["User-Agent"] }, signal: AbortSignal.timeout(4000), cache: "no-store" }
  ).catch(() => null);
  if (!res || !res.ok) return null;
  const text = await res.text();
  const versionMatches = Array.from(text.matchAll(/^\s{2}["']?([0-9][A-Za-z0-9._-]*)["']?\s*:/gm)).map(
    (m) => m[1]
  );
  if (versionMatches.length === 0) return null;
  return {
    identifier: `conan:${name}`,
    registry: "conan",
    name,
    latestVersion: versionMatches[0],
    versionCount: versionMatches.length,
    triplets: ["linux-x86_64", "windows-msvc", "macos-arm64"],
  };
}

async function fetchVcpkgPort(name: string): Promise<CppPackageStats | null> {
  const res = await fetch(
    `https://raw.githubusercontent.com/microsoft/vcpkg/master/ports/${encodeURIComponent(name)}/vcpkg.json`,
    { headers: { "User-Agent": GH_HEADERS["User-Agent"] }, signal: AbortSignal.timeout(4000), cache: "no-store" }
  ).catch(() => null);
  if (!res || !res.ok) return null;
  const json = await res.json().catch(() => null);
  if (!json?.name) return null;
  const ver = String(json["version-semver"] || json.version || json["version-date"] || json["version-string"] || "latest");
  const supports = json.supports ? String(json.supports).split(/[&,|]+/).map((s: string) => s.trim()).filter(Boolean) : [];
  return {
    identifier: `vcpkg:${json.name}`,
    registry: "vcpkg",
    name: String(json.name),
    latestVersion: ver,
    versionCount: 1,
    triplets: supports.length > 0 ? supports.slice(0, 6) : ["x64-windows", "x64-linux", "arm64-osx"],
    description: typeof json.description === "string" ? json.description : Array.isArray(json.description) ? json.description.join(" ") : undefined,
  };
}

async function fetchMesonWrap(name: string): Promise<CppPackageStats | null> {
  const res = await fetch(
    `https://wrapdb.mesonbuild.com/v2/releases.json`,
    { headers: { Accept: "application/json", "User-Agent": GH_HEADERS["User-Agent"] }, signal: AbortSignal.timeout(4500), cache: "no-store" }
  ).catch(() => null);
  if (!res || !res.ok) return null;
  const json = await res.json().catch(() => null);
  const entry = json?.[name];
  if (!entry || !Array.isArray(entry.versions) || entry.versions.length === 0) return null;
  return {
    identifier: `wrapdb:${name}`,
    registry: "wrapdb",
    name,
    latestVersion: String(entry.versions[0]),
    versionCount: entry.versions.length,
    triplets: Array.isArray(entry.dependency_names) ? entry.dependency_names.slice(0, 5) : ["meson-wrap"],
  };
}

export async function fetchCppPackageStats(rawIdentifier: string): Promise<CppPackageStats | null> {
  try {
    const { registry, name } = parseCppIdentifier(rawIdentifier);
    if (!name) return null;
    if (registry === "conan") return await fetchConanRecipe(name);
    if (registry === "vcpkg") return await fetchVcpkgPort(name);
    if (registry === "wrapdb") return await fetchMesonWrap(name);

    return (await fetchConanRecipe(name)) || (await fetchVcpkgPort(name)) || (await fetchMesonWrap(name));
  } catch {
    return null;
  }
}

export async function searchCppPackages(query: string): Promise<CppSearchItem[]> {
  const clean = query.trim().toLowerCase().replace(/^((conan|vcpkg|wrapdb?):)/, "");
  if (clean.length < 2) return [];

  const [conan, vcpkg] = await Promise.all([
    fetchConanRecipe(clean).catch(() => null),
    fetchVcpkgPort(clean).catch(() => null),
  ]);

  const out: CppSearchItem[] = [];
  if (conan) out.push({ identifier: conan.identifier, registry: "conan", name: conan.name, description: `Conan Center v${conan.latestVersion}` });
  if (vcpkg) out.push({ identifier: vcpkg.identifier, registry: "vcpkg", name: vcpkg.name, description: vcpkg.description || `vcpkg v${vcpkg.latestVersion}` });
  return out;
}
