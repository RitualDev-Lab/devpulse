import { PUBLIC_APP_URL } from "@/lib/config/app-url";

export interface SwiftPackageStats {
  identifier: string; // owner/repo (SPM) or CocoaPods pod name
  source: "spm" | "cocoapods";
  name: string;
  latestVersion: string;
  swiftVersions: string[];
  platforms: string[];
  description?: string;
}

export interface SwiftSearchItem {
  identifier: string;
  source: "spm" | "cocoapods";
  name: string;
  latestVersion?: string;
}

const HEADERS = {
  Accept: "application/json",
  "User-Agent": `DevPulse-HQ/1.0 (${PUBLIC_APP_URL})`,
};

async function fetchSpmPackage(ownerRepo: string): Promise<SwiftPackageStats | null> {
  const parts = ownerRepo.replace(/^https?:\/\/(swiftpackageindex\.com|github\.com)\//i, "").split("/").filter(Boolean);
  if (parts.length < 2) return null;
  const slug = `${parts[0]}/${parts[1]}`;

  const [swiftRes, platRes] = await Promise.all([
    fetch(`https://swiftpackageindex.com/api/packages/${encodeURIComponent(parts[0])}/${encodeURIComponent(parts[1])}/badge?type=swift-versions`, {
      headers: HEADERS,
      signal: AbortSignal.timeout(4500),
      cache: "no-store",
    }).catch(() => null),
    fetch(`https://swiftpackageindex.com/api/packages/${encodeURIComponent(parts[0])}/${encodeURIComponent(parts[1])}/badge?type=platforms`, {
      headers: HEADERS,
      signal: AbortSignal.timeout(4500),
      cache: "no-store",
    }).catch(() => null),
  ]);

  if ((!swiftRes || !swiftRes.ok) && (!platRes || !platRes.ok)) return null;
  const swiftJson = swiftRes && swiftRes.ok ? await swiftRes.json().catch(() => ({})) : {};
  const platJson = platRes && platRes.ok ? await platRes.json().catch(() => ({})) : {};

  const swiftVersions = String(swiftJson?.message || "")
    .split(/[|,]/)
    .map((s) => s.trim())
    .filter(Boolean);
  const platforms = String(platJson?.message || "")
    .split(/[|,]/)
    .map((s) => s.trim())
    .filter(Boolean);

  if (swiftVersions.length === 0 && platforms.length === 0) return null;

  return {
    identifier: slug,
    source: "spm",
    name: parts[1],
    latestVersion: swiftVersions[0] ? `Swift ${swiftVersions[0]}` : "SPM",
    swiftVersions,
    platforms,
  };
}

async function fetchCocoaPodStats(podName: string): Promise<SwiftPackageStats | null> {
  const res = await fetch(`https://trunk.cocoapods.org/api/v1/pods/${encodeURIComponent(podName)}`, {
    headers: HEADERS,
    signal: AbortSignal.timeout(4500),
    cache: "no-store",
  }).catch(() => null);
  if (!res || !res.ok) return null;
  const json = await res.json().catch(() => null);
  const versions: any[] = Array.isArray(json?.versions) ? json.versions : [];
  if (versions.length === 0) return null;

  const latest = versions[versions.length - 1];
  const latestSpec = await fetch(
    `https://trunk.cocoapods.org/api/v1/pods/${encodeURIComponent(podName)}/specs/${encodeURIComponent(String(latest.name))}`,
    { headers: HEADERS, signal: AbortSignal.timeout(4000), cache: "no-store" }
  )
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null);

  const platformsObj = latestSpec?.platforms && typeof latestSpec.platforms === "object" ? latestSpec.platforms : {};
  return {
    identifier: podName,
    source: "cocoapods",
    name: podName,
    latestVersion: String(latest.name || "0.0.0"),
    swiftVersions: latestSpec?.swift_versions
      ? (Array.isArray(latestSpec.swift_versions) ? latestSpec.swift_versions.map(String) : [String(latestSpec.swift_versions)])
      : [],
    platforms: Object.keys(platformsObj),
    description: latestSpec?.summary ? String(latestSpec.summary) : undefined,
  };
}

export async function fetchSwiftStats(identifier: string): Promise<SwiftPackageStats | null> {
  try {
    const clean = identifier.trim();
    if (!clean) return null;
    if (clean.includes("/")) return await fetchSpmPackage(clean);
    return await fetchCocoaPodStats(clean);
  } catch {
    return null;
  }
}

export async function searchSwiftPackages(query: string): Promise<SwiftSearchItem[]> {
  const clean = query.trim();
  if (clean.length < 2) return [];
  const exact = await fetchSwiftStats(clean);
  if (!exact) return [];
  return [
    {
      identifier: exact.identifier,
      source: exact.source,
      name: exact.name,
      latestVersion: exact.latestVersion,
    },
  ];
}
