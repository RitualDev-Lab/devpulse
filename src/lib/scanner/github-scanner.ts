import { escapeGoModulePath } from "@/lib/integrations/go";

/**
 * 1-Click "Import from GitHub" Scanner
 * Auto-inspects repository root files and verifies package registries before linking:
 * - npm packages (package.json, skipping private: true and unpublished packages)
 * - PyPI packages (pyproject.toml, setup.py)
 * - Rust crates (Cargo.toml, skipping publish = false and unpublished crates)
 * - Go modules (go.mod)
 * - MCP servers (mcp.json)
 * - VS Code extensions (package.json engines.vscode)
 * - Docker containers (verified against Docker Hub)
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

/**
 * Scan a GitHub repository by owner/repo
 */
export async function scanGitHubRepository(
  repoFullName: string,
  userToken?: string
): Promise<ScannedRepoResult> {
  const cleanRepo = repoFullName.trim().replace(/^https?:\/\/github\.com\//, "");
  const [owner, repo] = cleanRepo.split("/");

  if (!owner || !repo) {
    throw new Error(`Invalid repository format: "${repoFullName}". Expected "owner/repo".`);
  }

  const headers = getAuthHeader(userToken);

  // 1. Fetch Repository Metadata
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

  // 2. Fetch Root Directory Contents
  const contentsRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/contents`, {
    headers,
    cache: "no-store",
  });

  const rootItems: Array<{ name: string; path: string; type: string }> = contentsRes.ok
    ? await contentsRes.json()
    : [];

  const fileMap = new Map<string, string>();
  if (Array.isArray(rootItems)) {
    for (const item of rootItems) {
      fileMap.set(item.name.toLowerCase(), item.name);
    }
  }

  const detected: ScannedRepoResult["detectedEcosystems"] = {};
  const summary: string[] = [];

  // Helper to fetch file content decoded from base64
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

  // 3. Inspect package.json (npm + VS Code), skipping private apps & unpublished packages
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
        // invalid JSON, ignore
      }
    }
  }

  // 4. Inspect pyproject.toml or setup.py (PyPI)
  let candidatePypi: string | null = null;
  let pypiPrivate = false;
  if (fileMap.has("pyproject.toml")) {
    const rawPyproject = await fetchFileText(fileMap.get("pyproject.toml")!);
    if (rawPyproject) {
      if (/Private\s*::\s*Do Not Upload/i.test(rawPyproject)) pypiPrivate = true;
      const nameMatch = rawPyproject.match(/^\s*name\s*=\s*["']([^"']+)["']/m);
      if (nameMatch && nameMatch[1]) candidatePypi = nameMatch[1].trim();
    }
  } else if (fileMap.has("setup.py")) {
    const rawSetup = await fetchFileText(fileMap.get("setup.py")!);
    if (rawSetup) {
      if (/Private\s*::\s*Do Not Upload/i.test(rawSetup)) pypiPrivate = true;
      const nameMatch = rawSetup.match(/name\s*=\s*["']([^"']+)["']/);
      if (nameMatch && nameMatch[1]) candidatePypi = nameMatch[1].trim();
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

  // 5. Inspect Cargo.toml (Rust crates.io)
  if (fileMap.has("cargo.toml")) {
    const rawCargo = await fetchFileText(fileMap.get("cargo.toml")!);
    const publishDisabled = rawCargo ? /^\s*publish\s*=\s*false\b/m.test(rawCargo) : false;
    let crateName = repo;
    if (rawCargo) {
      const nameMatch = rawCargo.match(/^\s*name\s*=\s*["']([^"']+)["']/m);
      if (nameMatch && nameMatch[1]) {
        crateName = nameMatch[1].trim();
      }
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

  // 6. Inspect go.mod (Go Module)
  if (fileMap.has("go.mod")) {
    const rawGoMod = await fetchFileText(fileMap.get("go.mod")!);
    let modName = `github.com/${owner}/${repo}`;
    if (rawGoMod) {
      const modMatch = rawGoMod.match(/^\s*module\s+([^\s\n]+)/m);
      if (modMatch && modMatch[1]) {
        modName = modMatch[1].trim();
      }
    }
    const existsOnGoProxy = modName.includes(".")
      ? await registryResourceExists(`https://proxy.golang.org/${escapeGoModulePath(modName)}/@latest`)
      : false;
    if (existsOnGoProxy) {
      detected.goModule = modName;
      summary.push(`Detected Go module: "${modName}" (from go.mod)`);
    }
  }

  // 7. Inspect mcp.json (Model Context Protocol Server)
  if (fileMap.has("mcp.json")) {
    const rawMcp = await fetchFileText(fileMap.get("mcp.json")!);
    let mcpName = `${owner}/${repo}`;
    if (rawMcp) {
      try {
        const parsed = JSON.parse(rawMcp);
        if (parsed.name) mcpName = parsed.name;
      } catch {
        // default to repo
      }
    }
    detected.mcpServerName = mcpName;
    summary.push(`Detected MCP Server: "${mcpName}" (from mcp.json)`);
  }

  // 8. Inspect Dockerfile or docker-compose.yml (Docker Hub Container)
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

  if (summary.length === 0) {
    summary.push("Standard Git repository (no package configs detected in root)");
  }

  return {
    githubRepo: `${owner}/${repo}`,
    name: repoData.name || repo,
    description: repoData.description || "",
    stars: repoData.stargazers_count || 0,
    forks: repoData.forks_count || 0,
    language: repoData.language || "Unknown",
    defaultBranch: repoData.default_branch || "main",
    detectedEcosystems: detected,
    summary,
  };
}
