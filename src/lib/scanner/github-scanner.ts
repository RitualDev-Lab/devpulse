/**
 * 1-Click "Import from GitHub" Scanner
 * Auto-inspects repository root files to discover and link:
 * - npm packages (package.json)
 * - PyPI packages (pyproject.toml, setup.py)
 * - Rust crates (Cargo.toml)
 * - Go modules (go.mod)
 * - MCP servers (mcp.json)
 * - VS Code extensions (package.json engines.vscode)
 */

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

  // 3. Inspect package.json (npm + VS Code)
  if (fileMap.has("package.json")) {
    const exactName = fileMap.get("package.json")!;
    const rawJson = await fetchFileText(exactName);
    if (rawJson) {
      try {
        const pkg = JSON.parse(rawJson);
        if (pkg.name) {
          detected.npmPackage = pkg.name;
          summary.push(`Detected npm package: "${pkg.name}"`);
        }
        if (pkg.engines && pkg.engines.vscode && pkg.publisher && pkg.name) {
          detected.vscodeExtension = `${pkg.publisher}.${pkg.name}`;
          summary.push(`Detected VS Code extension: "${detected.vscodeExtension}"`);
        }
      } catch {
        // invalid JSON, ignore
      }
    }
  }

  // 4. Inspect pyproject.toml or setup.py (PyPI)
  if (fileMap.has("pyproject.toml")) {
    const rawPyproject = await fetchFileText(fileMap.get("pyproject.toml")!);
    if (rawPyproject) {
      // Look for name = "..." under [project] or [tool.poetry]
      const nameMatch = rawPyproject.match(/^\s*name\s*=\s*["']([^"']+)["']/m);
      if (nameMatch && nameMatch[1]) {
        detected.pypiPackage = nameMatch[1].trim();
        summary.push(`Detected PyPI package: "${detected.pypiPackage}" (from pyproject.toml)`);
      }
    }
  } else if (fileMap.has("setup.py")) {
    const rawSetup = await fetchFileText(fileMap.get("setup.py")!);
    if (rawSetup) {
      const nameMatch = rawSetup.match(/name\s*=\s*["']([^"']+)["']/);
      if (nameMatch && nameMatch[1]) {
        detected.pypiPackage = nameMatch[1].trim();
        summary.push(`Detected PyPI package: "${detected.pypiPackage}" (from setup.py)`);
      }
    }
  }

  // 5. Inspect Cargo.toml (Rust crates.io)
  if (fileMap.has("cargo.toml")) {
    const rawCargo = await fetchFileText(fileMap.get("cargo.toml")!);
    let crateName = repo;
    if (rawCargo) {
      const nameMatch = rawCargo.match(/^\s*name\s*=\s*["']([^"']+)["']/m);
      if (nameMatch && nameMatch[1]) {
        crateName = nameMatch[1].trim();
      }
    }
    detected.rustCrate = crateName;
    summary.push(`Detected Rust crate: "${crateName}" (from Cargo.toml)`);
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
    detected.goModule = modName;
    summary.push(`Detected Go module: "${modName}" (from go.mod)`);
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
