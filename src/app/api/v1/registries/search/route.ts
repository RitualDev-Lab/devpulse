import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { PUBLIC_APP_URL } from "@/lib/config/app-url";
import { escapeGoModulePath } from "@/lib/integrations/go";
import { searchNuGetPackages } from "@/lib/integrations/nuget";
import { searchRubyGems } from "@/lib/integrations/rubygems";
import { searchPackagistPackages } from "@/lib/integrations/packagist";
import { searchPubDevPackages } from "@/lib/integrations/pubdev";
import { searchJsrPackages } from "@/lib/integrations/jsr";
import { searchHexPackages } from "@/lib/integrations/hex";
import { searchAnacondaPackages } from "@/lib/integrations/anaconda";
import { searchCranPackages } from "@/lib/integrations/cran";
import { searchHomebrewPackages } from "@/lib/integrations/homebrew";

export type SearchableEcosystem =
  | "npm"
  | "pypi"
  | "crates"
  | "docker"
  | "vscode"
  | "mcp"
  | "go"
  | "nuget"
  | "rubygems"
  | "packagist"
  | "pubdev"
  | "jsr"
  | "hex"
  | "anaconda"
  | "cran"
  | "homebrew";

export interface RegistrySearchResult {
  id: string;
  ecosystem: SearchableEcosystem;
  name: string;
  version?: string | null;
  description?: string | null;
  statsLabel?: string | null;
  url?: string | null;
}

const VALID_ECOSYSTEMS = new Set<SearchableEcosystem>([
  "npm",
  "pypi",
  "crates",
  "docker",
  "vscode",
  "mcp",
  "go",
  "nuget",
  "rubygems",
  "packagist",
  "pubdev",
  "jsr",
  "hex",
  "anaconda",
  "cran",
  "homebrew",
]);

async function fetchJsonSafe<T>(url: string, headers: Record<string, string> = {}): Promise<T | null> {
  try {
    const res = await fetch(url, {
      headers: {
        Accept: "application/json",
        "User-Agent": `DevPulse-HQ/1.0 (${PUBLIC_APP_URL})`,
        ...headers,
      },
      signal: AbortSignal.timeout(4500),
      cache: "no-store",
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const ecoParam = String(req.nextUrl.searchParams.get("ecosystem") || "npm").toLowerCase() as SearchableEcosystem;
  const ecosystem: SearchableEcosystem = VALID_ECOSYSTEMS.has(ecoParam) ? ecoParam : "npm";
  const q = String(req.nextUrl.searchParams.get("q") || "").trim();

  if (q.length < 2) {
    return NextResponse.json({ ecosystem, results: [] as RegistrySearchResult[] });
  }

  const results: RegistrySearchResult[] = [];

  if (ecosystem === "npm") {
    const data = await fetchJsonSafe<{
      objects?: Array<{
        package?: { name?: string; version?: string; description?: string; links?: { npm?: string } };
        score?: { detail?: { popularity?: number } };
      }>;
    }>(`https://registry.npmjs.org/-/v1/search?text=${encodeURIComponent(q)}&size=8`);
    for (const obj of data?.objects || []) {
      const pkg = obj.package;
      if (!pkg?.name) continue;
      results.push({
        id: pkg.name,
        ecosystem: "npm",
        name: pkg.name,
        version: pkg.version || null,
        description: pkg.description || null,
        statsLabel: pkg.version ? `v${pkg.version}` : "npm",
        url: pkg.links?.npm || `https://www.npmjs.com/package/${pkg.name}`,
      });
    }
  } else if (ecosystem === "pypi") {
    const slug = q.toLowerCase().replace(/\s+/g, "-");
    const data = await fetchJsonSafe<{
      info?: { name?: string; version?: string; summary?: string; package_url?: string };
    }>(`https://pypi.org/pypi/${encodeURIComponent(slug)}/json`);
    if (data?.info?.name) {
      results.push({
        id: data.info.name,
        ecosystem: "pypi",
        name: data.info.name,
        version: data.info.version || null,
        description: data.info.summary || null,
        statsLabel: data.info.version ? `v${data.info.version}` : "PyPI",
        url: data.info.package_url || `https://pypi.org/project/${data.info.name}/`,
      });
    }
  } else if (ecosystem === "crates") {
    const data = await fetchJsonSafe<{
      crates?: Array<{
        id?: string;
        name?: string;
        max_version?: string;
        description?: string;
        downloads?: number;
      }>;
    }>(`https://crates.io/api/v1/crates?q=${encodeURIComponent(q)}&per_page=8`);
    for (const c of data?.crates || []) {
      if (!c?.name) continue;
      results.push({
        id: c.name,
        ecosystem: "crates",
        name: c.name,
        version: c.max_version || null,
        description: c.description || null,
        statsLabel:
          typeof c.downloads === "number" ? `${c.downloads.toLocaleString()} dl` : c.max_version || "crates.io",
        url: `https://crates.io/crates/${c.name}`,
      });
    }
  } else if (ecosystem === "docker") {
    const data = await fetchJsonSafe<{
      results?: Array<{
        repo_name?: string;
        short_description?: string;
        star_count?: number;
        pull_count?: number;
        is_official?: boolean;
      }>;
    }>(`https://hub.docker.com/v2/search/repositories/?query=${encodeURIComponent(q)}&page_size=8`);
    for (const r of data?.results || []) {
      if (!r?.repo_name) continue;
      const imageSlug = r.is_official && !r.repo_name.includes("/") ? `library/${r.repo_name}` : r.repo_name;
      results.push({
        id: imageSlug,
        ecosystem: "docker",
        name: imageSlug,
        description: r.short_description || null,
        statsLabel:
          typeof r.star_count === "number" ? `${r.star_count.toLocaleString()} stars` : "Docker Hub",
        url: r.is_official
          ? `https://hub.docker.com/_/${r.repo_name}`
          : `https://hub.docker.com/r/${r.repo_name}`,
      });
    }
  } else if (ecosystem === "vscode") {
    const data = await fetchJsonSafe<{
      extensions?: Array<{
        namespace?: string;
        name?: string;
        displayName?: string;
        version?: string;
        description?: string;
        downloadCount?: number;
      }>;
    }>(`https://open-vsx.org/api/-/search?query=${encodeURIComponent(q)}&size=8`);
    for (const ext of data?.extensions || []) {
      if (!ext?.namespace || !ext?.name) continue;
      const extId = `${ext.namespace}.${ext.name}`;
      results.push({
        id: extId,
        ecosystem: "vscode",
        name: extId,
        version: ext.version || null,
        description: ext.displayName || ext.description || null,
        statsLabel:
          typeof ext.downloadCount === "number"
            ? `${ext.downloadCount.toLocaleString()} installs`
            : ext.version || "VS Code",
        url: `https://open-vsx.org/extension/${ext.namespace}/${ext.name}`,
      });
    }
  } else if (ecosystem === "mcp") {
    const data = await fetchJsonSafe<{
      servers?: Array<{
        qualifiedName?: string;
        displayName?: string;
        description?: string;
        useCount?: number;
      }>;
    }>(`https://registry.smithery.ai/servers?q=${encodeURIComponent(q)}&pageSize=8`);
    for (const srv of data?.servers || []) {
      if (!srv?.qualifiedName) continue;
      results.push({
        id: srv.qualifiedName,
        ecosystem: "mcp",
        name: srv.qualifiedName,
        description: srv.displayName || srv.description || null,
        statsLabel:
          typeof srv.useCount === "number" ? `${srv.useCount.toLocaleString()} uses` : "Smithery MCP",
        url: `https://smithery.ai/server/${srv.qualifiedName}`,
      });
    }
  } else if (ecosystem === "go" && q.includes(".")) {
    const cleanMod = q.replace(/^https?:\/\//i, "").trim();
    const data = await fetchJsonSafe<{ Version?: string; Time?: string }>(
      `https://proxy.golang.org/${escapeGoModulePath(cleanMod)}/@latest`
    );
    if (data?.Version) {
      results.push({
        id: cleanMod,
        ecosystem: "go",
        name: cleanMod,
        version: data.Version,
        description: "Verified Go module on proxy.golang.org",
        statsLabel: data.Version,
        url: `https://pkg.go.dev/${cleanMod}`,
      });
    }
  } else if (ecosystem === "nuget") {
    const items = await searchNuGetPackages(q);
    for (const item of items) {
      results.push({
        id: item.id,
        ecosystem: "nuget",
        name: item.id,
        version: item.version || null,
        description: item.description || null,
        statsLabel: `${item.totalDownloads.toLocaleString()} dl`,
        url: `https://www.nuget.org/packages/${encodeURIComponent(item.id)}`,
      });
    }
  } else if (ecosystem === "rubygems") {
    const items = await searchRubyGems(q);
    for (const item of items) {
      results.push({
        id: item.name,
        ecosystem: "rubygems",
        name: item.name,
        version: item.version || null,
        description: item.info || null,
        statsLabel: `${item.downloads.toLocaleString()} dl`,
        url: `https://rubygems.org/gems/${encodeURIComponent(item.name)}`,
      });
    }
  } else if (ecosystem === "packagist") {
    const items = await searchPackagistPackages(q);
    for (const item of items) {
      results.push({
        id: item.name,
        ecosystem: "packagist",
        name: item.name,
        description: item.description || null,
        statsLabel: `${item.downloads.toLocaleString()} dl`,
        url: item.url || `https://packagist.org/packages/${item.name}`,
      });
    }
  } else if (ecosystem === "pubdev") {
    const items = await searchPubDevPackages(q);
    for (const item of items) {
      results.push({
        id: item.name,
        ecosystem: "pubdev",
        name: item.name,
        description: "Flutter / Dart package on pub.dev",
        statsLabel: "pub.dev",
        url: `https://pub.dev/packages/${encodeURIComponent(item.name)}`,
      });
    }
  } else if (ecosystem === "jsr") {
    const items = await searchJsrPackages(q);
    for (const item of items) {
      results.push({
        id: item.name,
        ecosystem: "jsr",
        name: item.name,
        version: item.latestVersion || null,
        description: item.description || null,
        statsLabel: typeof item.score === "number" ? `score ${item.score}%` : "JSR",
        url: `https://jsr.io/${item.name}`,
      });
    }
  } else if (ecosystem === "hex") {
    const items = await searchHexPackages(q);
    for (const item of items) {
      results.push({
        id: item.name,
        ecosystem: "hex",
        name: item.name,
        version: item.latestVersion || null,
        description: item.description || null,
        statsLabel: `${item.allDownloads.toLocaleString()} dl`,
        url: `https://hex.pm/packages/${encodeURIComponent(item.name)}`,
      });
    }
  } else if (ecosystem === "anaconda") {
    const items = await searchAnacondaPackages(q);
    for (const item of items) {
      results.push({
        id: item.identifier,
        ecosystem: "anaconda",
        name: item.identifier,
        description: item.summary || null,
        statsLabel: item.versionsCount ? `${item.versionsCount} builds` : "Anaconda",
        url: `https://anaconda.org/${item.identifier}`,
      });
    }
  } else if (ecosystem === "cran") {
    const items = await searchCranPackages(q);
    for (const item of items) {
      results.push({
        id: item.name,
        ecosystem: "cran",
        name: item.name,
        version: item.version || null,
        description: item.title || null,
        statsLabel: item.version ? `v${item.version}` : "CRAN",
        url: `https://cran.r-project.org/package=${encodeURIComponent(item.name)}`,
      });
    }
  } else if (ecosystem === "homebrew") {
    const items = await searchHomebrewPackages(q);
    for (const item of items) {
      results.push({
        id: item.name,
        ecosystem: "homebrew",
        name: item.name,
        version: item.version || null,
        description: item.description || null,
        statsLabel:
          typeof item.installs30d === "number"
            ? `${item.installs30d.toLocaleString()}/30d`
            : "Homebrew",
        url:
          item.kind === "cask"
            ? `https://formulae.brew.sh/cask/${encodeURIComponent(item.name.replace(/^cask\//, ""))}`
            : `https://formulae.brew.sh/formula/${encodeURIComponent(item.name)}`,
      });
    }
  }

  return NextResponse.json({ ecosystem, results });
}
