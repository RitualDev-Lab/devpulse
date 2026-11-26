import type { DepsDevAdvisorySummary } from "@/lib/integrations/deps-dev";
import type { ExtraPackageSnapshot } from "@/lib/integrations/registry-adapter";

export type CveSeverity = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";

export interface SbomVulnerability {
  id: string;
  packageName: string;
  ecosystem: string;
  version: string | null;
  severity: CveSeverity;
  summary: string;
  fixedVersion: string | null;
  referenceUrl: string;
}

export interface SbomPackageEntry {
  ecosystem: string;
  packageName: string;
  version: string | null;
  license: string;
  spdxCompliant: boolean;
  advisoryCount: number;
  scorecardOverall: number | null;
  sourceRepo: string | null;
  vulnerabilities: SbomVulnerability[];
}

export interface SbomInventoryReport {
  generatedAt: string;
  totalPackages: number;
  totalVulnerabilities: number;
  severityCounts: Record<CveSeverity, number>;
  spdxApprovedCount: number;
  packages: SbomPackageEntry[];
}

const APPROVED_SPDX_LICENSES = new Set([
  "MIT",
  "Apache-2.0",
  "BSD-2-Clause",
  "BSD-3-Clause",
  "ISC",
  "MPL-2.0",
  "0BSD",
  "Unlicense",
  "BlueOak-1.0.0",
  "Python-2.0",
  "PSF-2.0",
]);

export function isSpdxApprovedLicense(license?: string | null): boolean {
  if (!license) return false;
  const clean = license.trim();
  if (!clean || clean === "UNKNOWN") return false;
  return clean.split(/\s+(?:OR|AND|\/)\s+/i).some((part) => APPROVED_SPDX_LICENSES.has(part.trim()));
}

function mapEcosystemToOsv(eco: string): string | null {
  switch (eco.toLowerCase()) {
    case "npm":
    case "jsr":
      return "npm";
    case "pypi":
    case "anaconda":
      return "PyPI";
    case "crates":
    case "cargo":
      return "crates.io";
    case "go":
      return "Go";
    case "nuget":
      return "NuGet";
    case "rubygems":
      return "RubyGems";
    case "packagist":
      return "Packagist";
    case "pubdev":
      return "Pub";
    case "hex":
      return "Hex";
    case "maven":
      return "Maven";
    case "cran":
      return "CRAN";
    case "hackage":
      return "Hackage";
    default:
      return null;
  }
}

export function normalizeOsvSeverity(vuln: {
  database_specific?: { severity?: string };
  severity?: Array<{ score?: string }>;
}): CveSeverity {
  const raw = (vuln.database_specific?.severity || "").toUpperCase();
  if (raw === "CRITICAL" || raw === "HIGH" || raw === "MEDIUM" || raw === "LOW") {
    return raw;
  }
  if (raw === "MODERATE") return "MEDIUM";
  const cvss = vuln.severity?.[0]?.score || "";
  const numeric = Number.parseFloat(cvss);
  if (Number.isFinite(numeric)) {
    if (numeric >= 9.0) return "CRITICAL";
    if (numeric >= 7.0) return "HIGH";
    if (numeric >= 4.0) return "MEDIUM";
  }
  return "LOW";
}

async function queryOsvVulnerabilities(
  items: Array<{ ecosystem: string; packageName: string; version: string | null }>
): Promise<Map<string, SbomVulnerability[]>> {
  const result = new Map<string, SbomVulnerability[]>();
  const queryable = items
    .map((item, idx) => ({
      idx,
      item,
      osvEco: mapEcosystemToOsv(item.ecosystem),
    }))
    .filter((entry): entry is { idx: number; item: (typeof items)[number]; osvEco: string } => Boolean(entry.osvEco));

  if (queryable.length === 0) return result;

  try {
    const res = await fetch("https://api.osv.dev/v1/querybatch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        queries: queryable.map((q) => ({
          package: { name: q.item.packageName, ecosystem: q.osvEco },
          ...(q.item.version ? { version: q.item.version.replace(/^v/i, "") } : {}),
        })),
      }),
    });

    if (!res.ok) return result;
    const data = (await res.json()) as {
      results?: Array<{
        vulns?: Array<{
          id?: string;
          summary?: string;
          details?: string;
          database_specific?: { severity?: string };
          severity?: Array<{ score?: string }>;
          affected?: Array<{ ranges?: Array<{ events?: Array<{ fixed?: string }> }> }>;
        }>;
      }>;
    };

    const batches = data.results || [];
    for (let i = 0; i < queryable.length; i++) {
      const target = queryable[i];
      const vulns = (batches[i]?.vulns || []).slice(0, 12).map((v): SbomVulnerability => {
        const fixedVersion =
          v.affected
            ?.flatMap((a) => a.ranges || [])
            .flatMap((r) => r.events || [])
            .find((ev) => ev.fixed)?.fixed || null;
        const id = v.id || "OSV-UNKNOWN";
        return {
          id,
          packageName: target.item.packageName,
          ecosystem: target.item.ecosystem,
          version: target.item.version,
          severity: normalizeOsvSeverity(v),
          summary: (v.summary || v.details || `Security advisory ${id}`).slice(0, 220),
          fixedVersion,
          referenceUrl: `https://osv.dev/vulnerability/${encodeURIComponent(id)}`,
        };
      });
      result.set(`${target.item.ecosystem}:${target.item.packageName}`, vulns);
    }
  } catch {
    // Gracefully fall back to deps.dev advisory counts if OSV.dev is unreachable
  }

  return result;
}

export async function buildProjectSbomReport(input: {
  project: {
    npmPackage?: string | null;
    pypiPackage?: string | null;
    rustCrate?: string | null;
    goModule?: string | null;
  };
  npmStats?: { latestVersion?: string | null; license?: string | null } | null;
  pypiStats?: { latestVersion?: string | null; license?: string | null } | null;
  rustStats?: { maxVersion?: string | null; license?: string | null } | null;
  goStats?: { latestVersion?: string | null; license?: string | null } | null;
  packageSecurity?: Record<string, DepsDevAdvisorySummary>;
  extraPackages?: ExtraPackageSnapshot[];
  skipRemoteOsv?: boolean;
}): Promise<SbomInventoryReport> {
  const candidates: Array<{
    ecosystem: string;
    packageName: string;
    version: string | null;
    license: string | null;
    secKey: string;
  }> = [];

  if (input.project.npmPackage) {
    candidates.push({
      ecosystem: "npm",
      packageName: input.project.npmPackage,
      version: input.npmStats?.latestVersion || null,
      license: input.npmStats?.license || null,
      secKey: `npm:${input.project.npmPackage}`,
    });
  }
  if (input.project.pypiPackage) {
    candidates.push({
      ecosystem: "pypi",
      packageName: input.project.pypiPackage,
      version: input.pypiStats?.latestVersion || null,
      license: input.pypiStats?.license || null,
      secKey: `pypi:${input.project.pypiPackage}`,
    });
  }
  if (input.project.rustCrate) {
    candidates.push({
      ecosystem: "crates",
      packageName: input.project.rustCrate,
      version: input.rustStats?.maxVersion || null,
      license: input.rustStats?.license || null,
      secKey: `crates:${input.project.rustCrate}`,
    });
  }
  if (input.project.goModule) {
    candidates.push({
      ecosystem: "go",
      packageName: input.project.goModule,
      version: input.goStats?.latestVersion || null,
      license: input.goStats?.license || null,
      secKey: `go:${input.project.goModule}`,
    });
  }

  const seen = new Set(candidates.map((c) => `${c.ecosystem}:${c.packageName}`));
  for (const extra of input.extraPackages || []) {
    const key = `${extra.provider}:${extra.identifier}`;
    if (seen.has(key)) continue;
    seen.add(key);
    candidates.push({
      ecosystem: extra.provider,
      packageName: extra.identifier,
      version: extra.latestVersion || null,
      license: extra.security?.licenses?.[0] || null,
      secKey: key,
    });
  }

  const osvMap = input.skipRemoteOsv
    ? new Map<string, SbomVulnerability[]>()
    : await queryOsvVulnerabilities(
        candidates.map((c) => ({
          ecosystem: c.ecosystem,
          packageName: c.packageName,
          version: c.version,
        }))
      );

  const severityCounts: Record<CveSeverity, number> = {
    CRITICAL: 0,
    HIGH: 0,
    MEDIUM: 0,
    LOW: 0,
  };

  const packages: SbomPackageEntry[] = candidates.map((c) => {
    const depsDev = input.packageSecurity?.[c.secKey];
    const resolvedLicense = depsDev?.licenses?.[0] || c.license || "UNKNOWN";
    const key = `${c.ecosystem}:${c.packageName}`;
    const vulns = osvMap.get(key) || [];
    for (const v of vulns) {
      severityCounts[v.severity]++;
    }
    return {
      ecosystem: c.ecosystem,
      packageName: c.packageName,
      version: c.version || depsDev?.defaultVersion || null,
      license: resolvedLicense,
      spdxCompliant: isSpdxApprovedLicense(resolvedLicense),
      advisoryCount: Math.max(vulns.length, depsDev?.advisoryCount || 0),
      scorecardOverall: depsDev?.scorecardOverall ?? null,
      sourceRepo: depsDev?.sourceRepo ?? null,
      vulnerabilities: vulns,
    };
  });

  return {
    generatedAt: new Date().toISOString(),
    totalPackages: packages.length,
    totalVulnerabilities: packages.reduce((sum, p) => sum + p.advisoryCount, 0),
    severityCounts,
    spdxApprovedCount: packages.filter((p) => p.spdxCompliant).length,
    packages,
  };
}

export function buildFixSuggestionUrl(params: {
  githubRepo?: string | null;
  packageName: string;
  ecosystem: string;
  fixedVersion?: string | null;
  advisoryId: string;
}): string | null {
  if (!params.githubRepo) return null;
  const repo = params.githubRepo.replace(/^https?:\/\/github\.com\//i, "").replace(/\.git$/i, "");
  const title = encodeURIComponent(
    `chore(security): upgrade ${params.packageName} (${params.ecosystem}) to fix ${params.advisoryId}`
  );
  const body = encodeURIComponent(
    [
      `DevPulse SBOM Scanner detected advisory \`${params.advisoryId}\` affecting **${params.packageName}** (${params.ecosystem}).`,
      params.fixedVersion ? `\nRecommended safe version: \`${params.fixedVersion}\`` : "",
      `\nReference: https://osv.dev/vulnerability/${params.advisoryId}`,
    ].join("")
  );
  return `https://github.com/${repo}/issues/new?title=${title}&body=${body}`;
}
