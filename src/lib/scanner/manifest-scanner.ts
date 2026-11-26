import { escapeGoModulePath } from "@/lib/integrations/go";
import { REGISTRY_ADAPTERS, type RegistryProviderId } from "@/lib/integrations/registry-adapter";
import {
  defaultGitBaseUrl,
  fetchGitRepoRawFile,
  fetchGitRepoStats,
  listGitRepoRootFiles,
  type GitProviderConfig,
  type GitProviderId,
} from "@/lib/integrations/git-provider";
import { fetchNuGetStats } from "@/lib/integrations/nuget";
import { fetchMavenStats } from "@/lib/integrations/maven";
import { fetchCppPackageStats } from "@/lib/integrations/cpp";
import { fetchSwiftStats } from "@/lib/integrations/swift";
import { fetchHackageStats } from "@/lib/integrations/hackage";
import { fetchLuaRocksStats } from "@/lib/integrations/luarocks";
import { fetchJuliaStats } from "@/lib/integrations/julia";

/**
 * Universal Root Manifest Auto-Scanner
 * Inspects repository root manifests and verifies existence against upstream registries
 * while strictly skipping private or unpublished web/application manifests.
 */

async function registryResourceExists(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, {
      headers: {
        Accept: "application/json",
        "User-Agent": "DevPulse-Scanner/1.0",
      },
      signal: AbortSignal.timeout(2500),
      cache: "no-store",
    });
    return res.ok;
  } catch {
    return false;
  }
}

function encodeNpmPackagePath(packageName: string): string {
  const clean = packageName.trim();
  return clean.startsWith("@")
    ? `@${encodeURIComponent(clean.slice(1)).replace(/%2F/i, "/")}`
    : encodeURIComponent(clean);
}

export interface DetectedConnectorPackage {
  provider: RegistryProviderId;
  identifier: string;
  label: string;
  url: string;
  sourceFile: string;
}

export interface ScannedRepoResult {
  githubRepo: string;
  name: string;
  description: string;
  stars: number;
  forks: number;
  language: string;
  defaultBranch: string;
  detectedEcosystems: {
    npmPackage?: string;
    pypiPackage?: string;
    rustCrate?: string;
    goModule?: string;
    vscodeExtension?: string;
    mcpServerName?: string;
    dockerImage?: string;
  };
  detectedConnectors?: DetectedConnectorPackage[];
  summary: string[];
}

function getAuthHeader(userToken?: string): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github.v3+json",
    "User-Agent": "DevPulse-Scanner/1.0",
  };

  if (userToken) {
    headers.Authorization = `Bearer ${userToken}`;
  } else if (process.env.GITHUB_TOKEN) {
    headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  } else if (process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET) {
    const basic = Buffer.from(
      `${process.env.GITHUB_CLIENT_ID}:${process.env.GITHUB_CLIENT_SECRET}`
    ).toString("base64");
    headers.Authorization = `Basic ${basic}`;
  }

  return headers;
}

export async function scanGitProviderManifests(config: GitProviderConfig): Promise<ScannedRepoResult> {
  if (config.provider === "github") {
    return await scanRepositoryManifests(config.repoSlug, config.token || undefined);
  }

  const baseUrl = defaultGitBaseUrl(config.provider, config.baseUrl);
  const normalizedCfg: GitProviderConfig = { ...config, baseUrl };
  const [repoStats, rootFiles] = await Promise.all([
    fetchGitRepoStats(normalizedCfg),
    listGitRepoRootFiles(normalizedCfg),
  ]);

  if (!repoStats) {
    throw new Error(`Repository "${config.repoSlug}" on ${config.provider} was not found or requires an access token.`);
  }

  return await scanManifestFiles({
    owner: repoStats.owner,
    repo: repoStats.repo,
    repoFullName: repoStats.fullName,
    repoName: repoStats.repo,
    description: repoStats.description,
    stars: repoStats.stars,
    forks: repoStats.forks,
    language: repoStats.provider.toUpperCase(),
    defaultBranch: repoStats.defaultBranch,
    rootFileNames: rootFiles,
    fetchFileText: (fileName) => fetchGitRepoRawFile(normalizedCfg, fileName, repoStats.defaultBranch),
  });
}

export async function scanRepositoryManifests(
  repoFullName: string,
  userToken?: string
): Promise<ScannedRepoResult> {
  const cleanRepo = repoFullName.trim().replace(/^https?:\/\/github\.com\//, "");
  const [owner, repo] = cleanRepo.split("/");

  if (!owner || !repo) {
    throw new Error(`Invalid repository format: "${repoFullName}". Expected "owner/repo".`);
  }

  const headers = getAuthHeader(userToken);

  const repoRes = await fetch(`https://api.github.com/repos/${owner}/${repo}`, {
    headers,
    cache: "no-store",
  });

  if (!repoRes.ok) {
    if (repoRes.status === 404) {
      throw new Error(`Repository "${owner}/${repo}" was not found or is private.`);
    }
    throw new Error(`GitHub API error (${repoRes.status}): ${repoRes.statusText}`);
  }

  const repoData = await repoRes.json();

  const contentsRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/contents`, {
    headers,
    cache: "no-store",
  });

  const rootItems: Array<{ name: string; path: string; type: string }> = contentsRes.ok
    ? await contentsRes.json()
    : [];

  const rootFileNames = Array.isArray(rootItems) ? rootItems.map((i) => i?.name).filter(Boolean) as string[] : [];

  async function fetchFileText(fileName: string): Promise<string | null> {
    try {
      const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/contents/${fileName}`, {
        headers,
        cache: "no-store",
      });
      if (!res.ok) return null;
      const data = await res.json();
      if (data.content && data.encoding === "base64") {
        return Buffer.from(data.content, "base64").toString("utf-8");
      }
      return null;
    } catch {
      return null;
    }
  }

  return await scanManifestFiles({
    owner,
    repo,
    repoFullName: `${owner}/${repo}`,
    repoName: repoData.name || repo,
    description: repoData.description || "",
    stars: repoData.stargazers_count || 0,
    forks: repoData.forks_count || 0,
    language: repoData.language || "Unknown",
    defaultBranch: repoData.default_branch || "main",
    rootFileNames,
    fetchFileText,
  });
}

async function scanManifestFiles(ctx: {
  owner: string;
  repo: string;
  repoFullName: string;
  repoName: string;
  description: string;
  stars: number;
  forks: number;
  language: string;
  defaultBranch: string;
  rootFileNames: string[];
  fetchFileText: (fileName: string) => Promise<string | null>;
}): Promise<ScannedRepoResult> {
  const { owner, repo, fetchFileText } = ctx;
  const fileMap = new Map<string, string>();
  const fileNames: string[] = [];
  for (const name of ctx.rootFileNames) {
    fileMap.set(name.toLowerCase(), name);
    fileNames.push(name);
  }

  const detected: ScannedRepoResult["detectedEcosystems"] = {};
  const detectedConnectors: DetectedConnectorPackage[] = [];
  const summary: string[] = [];

  const findBySuffix = (suffix: string): string | undefined =>
    fileNames.find((n) => n.toLowerCase().endsWith(suffix));

  const pushConnector = (provider: RegistryProviderId, identifier: string, sourceFile: string) => {
    if (
      detectedConnectors.some(
        (c) => c.provider === provider && c.identifier.toLowerCase() === identifier.toLowerCase()
      )
    ) {
      return;
    }
    const meta = REGISTRY_ADAPTERS[provider];
    detectedConnectors.push({
      provider,
      identifier,
      label: `${meta.label}: ${identifier}`,
      url: meta.buildUrl(identifier),
      sourceFile,
    });
    summary.push(`Detected ${meta.label} package: "${identifier}" (from ${sourceFile})`);
  };

  // 1. package.json (npm + VS Code)
  if (fileMap.has("package.json")) {
    const exactName = fileMap.get("package.json")!;
    const rawJson = await fetchFileText(exactName);
    if (rawJson) {
      try {
        const pkg = JSON.parse(rawJson);
        const pkgName = typeof pkg.name === "string" ? pkg.name.trim() : "";
        if (pkg.engines && pkg.engines.vscode && pkg.publisher && pkgName && pkg.private !== true) {
          detected.vscodeExtension = `${pkg.publisher}.${pkgName}`;
          summary.push(`Detected VS Code extension: "${detected.vscodeExtension}"`);
        }
        if (pkgName) {
          if (pkg.private === true) {
            summary.push(`Skipped private package.json ("${pkgName}")`);
          } else {
            const existsOnNpm = await registryResourceExists(
              `https://registry.npmjs.org/${encodeNpmPackagePath(pkgName)}`
            );
            if (existsOnNpm) {
              detected.npmPackage = pkgName;
              summary.push(`Detected npm package: "${pkgName}"`);
            } else {
              summary.push(`Skipped unpublished package.json ("${pkgName}" not found on npm)`);
            }
          }
        }
      } catch {
        // invalid JSON
      }
    }
  }

  // 2. pyproject.toml / setup.py (PyPI)
  let candidatePypi: string | null = null;
  let pypiPrivate = false;
  if (fileMap.has("pyproject.toml")) {
    const rawPyproject = await fetchFileText(fileMap.get("pyproject.toml")!);
    if (rawPyproject) {
      if (/Private\s*::\s*Do Not Upload/i.test(rawPyproject)) pypiPrivate = true;
      const nameMatch = rawPyproject.match(/^\s*name\s*=\s*["']([^"']+)["']/m);
      if (nameMatch?.[1]) candidatePypi = nameMatch[1].trim();
    }
  } else if (fileMap.has("setup.py")) {
    const rawSetup = await fetchFileText(fileMap.get("setup.py")!);
    if (rawSetup) {
      if (/Private\s*::\s*Do Not Upload/i.test(rawSetup)) pypiPrivate = true;
      const nameMatch = rawSetup.match(/name\s*=\s*["']([^"']+)["']/);
      if (nameMatch?.[1]) candidatePypi = nameMatch[1].trim();
    }
  }
  if (candidatePypi && !pypiPrivate) {
    const existsOnPyPi = await registryResourceExists(
      `https://pypi.org/pypi/${encodeURIComponent(candidatePypi.toLowerCase())}/json`
    );
    if (existsOnPyPi) {
      detected.pypiPackage = candidatePypi;
      summary.push(`Detected PyPI package: "${candidatePypi}"`);
    }
  }

  // 3. Cargo.toml (Rust crates.io)
  if (fileMap.has("cargo.toml")) {
    const rawCargo = await fetchFileText(fileMap.get("cargo.toml")!);
    const publishDisabled = rawCargo ? /^\s*publish\s*=\s*false\b/m.test(rawCargo) : false;
    let crateName = repo;
    if (rawCargo) {
      const nameMatch = rawCargo.match(/^\s*name\s*=\s*["']([^"']+)["']/m);
      if (nameMatch?.[1]) crateName = nameMatch[1].trim();
    }
    if (!publishDisabled && crateName) {
      const existsOnCrates = await registryResourceExists(
        `https://crates.io/api/v1/crates/${encodeURIComponent(crateName.toLowerCase())}`
      );
      if (existsOnCrates) {
        detected.rustCrate = crateName;
        summary.push(`Detected Rust crate: "${crateName}" (from Cargo.toml)`);
      }
    }
  }

  // 4. go.mod (Go Modules)
  if (fileMap.has("go.mod")) {
    const rawGoMod = await fetchFileText(fileMap.get("go.mod")!);
    let modName = `github.com/${owner}/${repo}`;
    if (rawGoMod) {
      const modMatch = rawGoMod.match(/^\s*module\s+([^\s\n]+)/m);
      if (modMatch?.[1]) modName = modMatch[1].trim();
    }
    const existsOnGoProxy = modName.includes(".")
      ? await registryResourceExists(`https://proxy.golang.org/${escapeGoModulePath(modName)}/@latest`)
      : false;
    if (existsOnGoProxy) {
      detected.goModule = modName;
      summary.push(`Detected Go module: "${modName}" (from go.mod)`);
    }
  }

  // 5. mcp.json
  if (fileMap.has("mcp.json")) {
    const rawMcp = await fetchFileText(fileMap.get("mcp.json")!);
    let mcpName = `${owner}/${repo}`;
    if (rawMcp) {
      try {
        const parsed = JSON.parse(rawMcp);
        if (parsed.name) mcpName = parsed.name;
      } catch {
        // default
      }
    }
    detected.mcpServerName = mcpName;
    summary.push(`Detected MCP Server: "${mcpName}" (from mcp.json)`);
  }

  // 6. Dockerfile / docker-compose.yml
  if (fileMap.has("dockerfile") || fileMap.has("docker-compose.yml") || fileMap.has("docker-compose.yaml")) {
    const defaultDockerImage = `${owner.toLowerCase()}/${repo.toLowerCase()}`;
    const existsOnDockerHub = await registryResourceExists(
      `https://hub.docker.com/v2/repositories/${defaultDockerImage}`
    );
    if (existsOnDockerHub) {
      detected.dockerImage = defaultDockerImage;
      summary.push(`Detected Docker container: "${defaultDockerImage}" (from Dockerfile)`);
    }
  }

  // 7. composer.json -> Packagist (skip project apps & private)
  if (fileMap.has("composer.json")) {
    const raw = await fetchFileText(fileMap.get("composer.json")!);
    if (raw) {
      try {
        const pkg = JSON.parse(raw);
        const name = typeof pkg.name === "string" ? pkg.name.trim() : "";
        if (name && name.includes("/") && pkg.private !== true && pkg.type !== "project") {
          const [v, p] = name.split("/");
          if (await registryResourceExists(`https://packagist.org/packages/${encodeURIComponent(v)}/${encodeURIComponent(p)}.json`)) {
            pushConnector("packagist", name, "composer.json");
          }
        }
      } catch {
        // ignore invalid JSON
      }
    }
  }

  // 8. *.csproj / paket.dependencies -> NuGet
  const csprojFile = findBySuffix(".csproj");
  if (csprojFile) {
    const raw = await fetchFileText(csprojFile);
    if (raw && !/<IsPackable>\s*false\s*<\/IsPackable>/i.test(raw)) {
      const idMatch = raw.match(/<PackageId>\s*([^<\s]+)\s*<\/PackageId>/i) ||
        raw.match(/<AssemblyName>\s*([^<\s]+)\s*<\/AssemblyName>/i);
      const candidate = (idMatch?.[1] || csprojFile.replace(/\.csproj$/i, "")).trim();
      if (candidate && (await fetchNuGetStats(candidate))) {
        pushConnector("nuget", candidate, csprojFile);
      }
    }
  }

  // 9. pom.xml / build.gradle(.kts) / build.sbt -> Maven Central
  if (fileMap.has("pom.xml")) {
    const raw = await fetchFileText(fileMap.get("pom.xml")!);
    if (raw) {
      const withoutParent = raw.replace(/<parent>[\s\S]*?<\/parent>/i, "");
      const g = withoutParent.match(/<groupId>\s*([^<\s]+)\s*<\/groupId>/i)?.[1]?.trim();
      const a = withoutParent.match(/<artifactId>\s*([^<\s]+)\s*<\/artifactId>/i)?.[1]?.trim();
      if (g && a && !g.includes("${") && !a.includes("${")) {
        const coord = `${g}:${a}`;
        if (await fetchMavenStats(coord)) pushConnector("maven", coord, "pom.xml");
      }
    }
  } else if (fileMap.has("build.sbt")) {
    const raw = await fetchFileText(fileMap.get("build.sbt")!);
    if (raw) {
      const org = raw.match(/organization\s*:=\s*"([^"]+)"/)?.[1]?.trim();
      const name = raw.match(/\bname\s*:=\s*"([^"]+)"/)?.[1]?.trim();
      if (org && name) {
        const coord = `${org}:${name}`;
        if (await fetchMavenStats(coord)) pushConnector("maven", coord, "build.sbt");
      }
    }
  }

  // 10. pubspec.yaml -> pub.dev (skip publish_to: none apps)
  if (fileMap.has("pubspec.yaml")) {
    const raw = await fetchFileText(fileMap.get("pubspec.yaml")!);
    if (raw && !/^\s*publish_to\s*:\s*['"]?none['"]?/m.test(raw)) {
      const pkgName = raw.match(/^\s*name\s*:\s*([A-Za-z0-9_]+)/m)?.[1]?.trim();
      if (pkgName && (await registryResourceExists(`https://pub.dev/api/packages/${encodeURIComponent(pkgName)}`))) {
        pushConnector("pubdev", pkgName, "pubspec.yaml");
      }
    }
  }

  // 11. *.gemspec -> RubyGems
  const gemspecFile = findBySuffix(".gemspec");
  if (gemspecFile) {
    const raw = await fetchFileText(gemspecFile);
    const gemName = raw?.match(/\.name\s*=\s*["']([^"']+)["']/)?.[1]?.trim() || gemspecFile.replace(/\.gemspec$/i, "");
    if (gemName && (await registryResourceExists(`https://rubygems.org/api/v1/gems/${encodeURIComponent(gemName)}.json`))) {
      pushConnector("rubygems", gemName, gemspecFile);
    }
  }

  // 12. mix.exs -> Hex.pm
  if (fileMap.has("mix.exs")) {
    const raw = await fetchFileText(fileMap.get("mix.exs")!);
    if (raw && /\bpackage\s*:/i.test(raw)) {
      const appName = raw.match(/\bapp\s*:\s*:([a-z0-9_]+)/i)?.[1]?.trim();
      if (appName && (await registryResourceExists(`https://hex.pm/api/packages/${encodeURIComponent(appName)}`))) {
        pushConnector("hex", appName, "mix.exs");
      }
    }
  }

  // 13. jsr.json / deno.json -> JSR
  const jsrFile = fileMap.get("jsr.json") || fileMap.get("deno.json");
  if (jsrFile) {
    const raw = await fetchFileText(jsrFile);
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        const name = typeof parsed.name === "string" ? parsed.name.trim() : "";
        if (name.startsWith("@") && name.includes("/") && parsed.exports && parsed.private !== true) {
          const [scope, pkg] = name.slice(1).split("/");
          if (scope && pkg && (await registryResourceExists(`https://api.jsr.io/scopes/${encodeURIComponent(scope)}/packages/${encodeURIComponent(pkg)}`))) {
            pushConnector("jsr", name, jsrFile);
          }
        }
      } catch {
        // ignore invalid JSON
      }
    }
  }

  // 14. Package.swift / *.podspec -> Swift / CocoaPods
  const podspecFile = findBySuffix(".podspec");
  if (podspecFile) {
    const raw = await fetchFileText(podspecFile);
    const podName = raw?.match(/\.name\s*=\s*["']([^"']+)["']/)?.[1]?.trim() || podspecFile.replace(/\.podspec$/i, "");
    if (podName && (await fetchSwiftStats(podName))) {
      pushConnector("swift", podName, podspecFile);
    }
  } else if (fileMap.has("package.swift")) {
    const slug = `${owner}/${repo}`;
    if (await fetchSwiftStats(slug)) {
      pushConnector("swift", slug, "Package.swift");
    }
  }

  // 15. conanfile.py / vcpkg.json -> C / C++
  if (fileMap.has("conanfile.py")) {
    const raw = await fetchFileText(fileMap.get("conanfile.py")!);
    const name = raw?.match(/^\s*name\s*=\s*["']([^"']+)["']/m)?.[1]?.trim();
    if (name && (await fetchCppPackageStats(`conan:${name}`))) {
      pushConnector("cpp", `conan:${name}`, "conanfile.py");
    }
  } else if (fileMap.has("vcpkg.json")) {
    const raw = await fetchFileText(fileMap.get("vcpkg.json")!);
    try {
      const parsed = raw ? JSON.parse(raw) : null;
      const name = typeof parsed?.name === "string" ? parsed.name.trim() : "";
      if (name && (await fetchCppPackageStats(`vcpkg:${name}`))) {
        pushConnector("cpp", `vcpkg:${name}`, "vcpkg.json");
      }
    } catch {
      // ignore
    }
  }

  // 16. DESCRIPTION (CRAN), *.cabal (Hackage), *.rockspec (LuaRocks), Project.toml (Julia)
  if (fileMap.has("description")) {
    const raw = await fetchFileText(fileMap.get("description")!);
    const rPkg = raw?.match(/^\s*Package\s*:\s*([A-Za-z0-9.]+)/m)?.[1]?.trim();
    if (rPkg && (await registryResourceExists(`https://crandb.r-pkg.org/${encodeURIComponent(rPkg)}`))) {
      pushConnector("cran", rPkg, "DESCRIPTION");
    }
  }

  const cabalFile = findBySuffix(".cabal");
  if (cabalFile) {
    const raw = await fetchFileText(cabalFile);
    const pkgName = raw?.match(/^\s*name\s*:\s*([A-Za-z0-9-]+)/mi)?.[1]?.trim();
    if (pkgName && (await fetchHackageStats(pkgName))) {
      pushConnector("hackage", pkgName, cabalFile);
    }
  }

  const rockspecFile = findBySuffix(".rockspec");
  if (rockspecFile) {
    const raw = await fetchFileText(rockspecFile);
    const pkgName = raw?.match(/^\s*package\s*=\s*["']([^"']+)["']/mi)?.[1]?.trim();
    if (pkgName && (await fetchLuaRocksStats(pkgName))) {
      pushConnector("luarocks", pkgName, rockspecFile);
    }
  }

  if (fileMap.has("project.toml")) {
    const raw = await fetchFileText(fileMap.get("project.toml")!);
    const name = raw?.match(/^\s*name\s*=\s*["']([^"']+)["']/m)?.[1]?.trim();
    const hasUuid = Boolean(raw && /^\s*uuid\s*=/m.test(raw));
    if (name && hasUuid && (await fetchJuliaStats(name))) {
      pushConnector("julia", name, "Project.toml");
    }
  }

  if (summary.length === 0) {
    summary.push("Standard Git repository (no package configs detected in root)");
  }

  return {
    githubRepo: ctx.repoFullName,
    name: ctx.repoName,
    description: ctx.description,
    stars: ctx.stars,
    forks: ctx.forks,
    language: ctx.language,
    defaultBranch: ctx.defaultBranch,
    detectedEcosystems: detected,
    detectedConnectors,
    summary,
  };
}

export const scanGitHubRepository = scanRepositoryManifests;
