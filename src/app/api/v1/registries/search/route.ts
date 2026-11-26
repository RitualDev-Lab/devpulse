import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { PUBLIC_APP_URL } from "@/lib/config/app-url";
import { escapeGoModulePath } from "@/lib/integrations/go";

export type SearchableEcosystem =
  | "npm"
  | "pypi"
  | "crates"
  | "docker"
  | "vscode"
  | "mcp"
  | "go";

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
  }

  return NextResponse.json({ ecosystem, results });
}
