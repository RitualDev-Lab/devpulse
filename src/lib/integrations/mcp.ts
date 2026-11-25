/**
 * Model Context Protocol (MCP) Server Intelligence Service
 * Queries public MCP registries (MCPShelf, Smithery, Glama) and optionally inspects
 * GitHub repository manifests (mcp.json, smithery.yaml, glama.json).
 * Zero mocked or fabricated metrics.
 */

export interface McpServerStats {
  serverName: string;
  displayName: string;
  description?: string | null;
  protocolVersion: string | null;
  toolsCount: number | null;
  resourcesCount: number | null;
  promptsCount: number | null;
  transport: "stdio" | "sse" | "streamable-http" | "unknown";
  registries: {
    mcpshelf: boolean;
    glama: boolean;
    smithery: boolean;
  };
  supportedClients: string[];
  registryUrl?: string | null;
  status: "verified" | "indexed" | "unverified";
}

type JsonRecord = Record<string, unknown>;

async function fetchJsonWithTimeout(url: string, timeoutMs = 4500): Promise<JsonRecord | unknown[] | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: {
        Accept: "application/json",
        "User-Agent": "DevPulse-HQ/1.0 (https://devpulse.ritualdev.in)",
      },
      signal: controller.signal,
      next: { revalidate: 3600 },
    });
    if (!res.ok) return null;
    return (await res.json()) as JsonRecord | unknown[];
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchTextWithTimeout(url: string, timeoutMs = 4500): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": "DevPulse-HQ/1.0 (https://devpulse.ritualdev.in)",
      },
      signal: controller.signal,
      next: { revalidate: 3600 },
    });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchMcpStats(
  serverName: string,
  githubRepo?: string | null
): Promise<McpServerStats | null> {
  const cleanName = serverName.trim();
  if (!cleanName) return null;

  const lowerNeedle = cleanName.toLowerCase();
  const shortName = cleanName.split("/").pop()?.toLowerCase() || lowerNeedle;

  let displayName = cleanName.split("/").pop() || cleanName;
  let description: string | null = null;
  let protocolVersion: string | null = null;
  let toolsCount: number | null = null;
  let resourcesCount: number | null = null;
  let promptsCount: number | null = null;
  let transport: McpServerStats["transport"] = "unknown";
  let registryUrl: string | null = null;
  const supportedClients: Set<string> = new Set();

  let mcpshelfFound = false;
  let smitheryFound = false;
  let glamaFound = false;

  const [mcpshelfData, smitheryData, glamaData] = await Promise.all([
    fetchJsonWithTimeout("https://mcp.ritualdev.in/data.json"),
    fetchJsonWithTimeout(
      `https://registry.smithery.ai/servers?q=${encodeURIComponent(cleanName)}&pageSize=5`
    ),
    fetchJsonWithTimeout(
      `https://glama.ai/api/mcp/v1/servers?query=${encodeURIComponent(shortName)}`
    ),
  ]);

  const mcpRecord = mcpshelfData && !Array.isArray(mcpshelfData) ? mcpshelfData : null;
  const mcpList: JsonRecord[] = Array.isArray(mcpshelfData)
    ? (mcpshelfData as JsonRecord[])
    : Array.isArray(mcpRecord?.servers)
      ? (mcpRecord.servers as JsonRecord[])
      : [];

  const mcpShelfMatch = mcpList.find((item) => {
    const id = String(item?.id || item?.name || "").toLowerCase();
    const repoObj = item?.repository as JsonRecord | undefined;
    const repo = String(repoObj?.url || item?.repo || item?.github || "").toLowerCase();
    return (
      id === lowerNeedle ||
      id.endsWith(`/${shortName}`) ||
      (githubRepo && repo.includes(githubRepo.toLowerCase())) ||
      repo.includes(lowerNeedle)
    );
  });

  if (mcpShelfMatch) {
    mcpshelfFound = true;
    displayName = String(mcpShelfMatch.title || mcpShelfMatch.name || displayName);
    description = (mcpShelfMatch.description as string) || description;
    registryUrl = (mcpShelfMatch.url as string) || "https://mcp.ritualdev.in";
    if (Array.isArray(mcpShelfMatch.tools)) toolsCount = mcpShelfMatch.tools.length;
    if (Array.isArray(mcpShelfMatch.resources)) resourcesCount = mcpShelfMatch.resources.length;
    if (Array.isArray(mcpShelfMatch.prompts)) promptsCount = mcpShelfMatch.prompts.length;
    if (
      mcpShelfMatch.transport === "sse" ||
      mcpShelfMatch.transport === "streamable-http" ||
      mcpShelfMatch.transport === "stdio"
    ) {
      transport = mcpShelfMatch.transport;
    }
  }

  const smitheryRecord = smitheryData && !Array.isArray(smitheryData) ? smitheryData : null;
  const smitheryServers: JsonRecord[] = Array.isArray(smitheryRecord?.servers)
    ? (smitheryRecord.servers as JsonRecord[])
    : [];
  const smitheryMatch = smitheryServers.find((srv) => {
    const qName = String(srv?.qualifiedName || srv?.name || "").toLowerCase();
    const dName = String(srv?.displayName || "").toLowerCase();
    return qName === lowerNeedle || qName.includes(shortName) || dName === shortName;
  });

  if (smitheryMatch) {
    smitheryFound = true;
    displayName = String(smitheryMatch.displayName || displayName);
    description = description || (smitheryMatch.description as string) || null;
    if (!registryUrl && smitheryMatch.qualifiedName) {
      registryUrl = `https://smithery.ai/server/${String(smitheryMatch.qualifiedName)}`;
    }
    if (toolsCount === null && Array.isArray(smitheryMatch.tools)) {
      toolsCount = smitheryMatch.tools.length;
    }
    if (smitheryMatch.remote === true && transport === "unknown") {
      transport = "streamable-http";
    } else if (transport === "unknown") {
      transport = "stdio";
    }
  }

  const glamaRecord = glamaData && !Array.isArray(glamaData) ? glamaData : null;
  const glamaServers: JsonRecord[] = Array.isArray(glamaRecord?.servers)
    ? (glamaRecord.servers as JsonRecord[])
    : Array.isArray(glamaData)
      ? (glamaData as JsonRecord[])
      : [];
  const glamaMatch = glamaServers.find((srv) => {
    const slug = String(srv?.slug || srv?.name || srv?.id || "").toLowerCase();
    const repoObj = srv?.repository as JsonRecord | undefined;
    const repo = String(repoObj?.url || "").toLowerCase();
    return (
      slug === lowerNeedle ||
      slug.includes(shortName) ||
      (githubRepo && repo.includes(githubRepo.toLowerCase()))
    );
  });

  if (glamaMatch) {
    glamaFound = true;
    displayName = String(glamaMatch.name || displayName);
    description = description || (glamaMatch.description as string) || null;
    if (toolsCount === null && Array.isArray(glamaMatch.tools)) {
      toolsCount = glamaMatch.tools.length;
    }
    if (!registryUrl && glamaMatch.url) {
      registryUrl = String(glamaMatch.url);
    }
  }

  if (githubRepo && githubRepo.includes("/")) {
    const [owner, repo] = githubRepo.trim().split("/");
    const [mcpJsonRaw, smitheryYamlRaw, glamaJsonRaw] = await Promise.all([
      fetchTextWithTimeout(`https://raw.githubusercontent.com/${owner}/${repo}/HEAD/mcp.json`),
      fetchTextWithTimeout(`https://raw.githubusercontent.com/${owner}/${repo}/HEAD/smithery.yaml`),
      fetchTextWithTimeout(`https://raw.githubusercontent.com/${owner}/${repo}/HEAD/glama.json`),
    ]);

    if (mcpJsonRaw) {
      try {
        const parsed = JSON.parse(mcpJsonRaw) as JsonRecord;
        if (parsed.version || parsed.protocolVersion) {
          protocolVersion = String(parsed.protocolVersion || parsed.version);
        }
        if (Array.isArray(parsed.tools)) toolsCount = parsed.tools.length;
        if (Array.isArray(parsed.resources)) resourcesCount = parsed.resources.length;
        if (Array.isArray(parsed.prompts)) promptsCount = parsed.prompts.length;
        if (
          parsed.transport === "stdio" ||
          parsed.transport === "sse" ||
          parsed.transport === "streamable-http"
        ) {
          transport = parsed.transport;
        }
        if (parsed.mcpServers) {
          supportedClients.add("Claude Desktop");
          supportedClients.add("Cursor");
        }
      } catch {
        // Invalid mcp.json
      }
    }

    if (smitheryYamlRaw) {
      if (transport === "unknown") {
        transport =
          smitheryYamlRaw.includes("type: http") || smitheryYamlRaw.includes("streamable")
            ? "streamable-http"
            : "stdio";
      }
      supportedClients.add("Smithery CLI");
    }

    if (glamaJsonRaw) {
      try {
        const gj = JSON.parse(glamaJsonRaw) as JsonRecord;
        if (Array.isArray(gj.maintainers) && gj.maintainers.length > 0 && glamaFound) {
          supportedClients.add("Glama");
        }
      } catch {
        // Ignore invalid glama.json
      }
    }
  }

  const anyIndexed = mcpshelfFound || smitheryFound || glamaFound;
  if (anyIndexed && supportedClients.size === 0) {
    supportedClients.add("MCP Stdio/HTTP");
  }

  return {
    serverName: cleanName,
    displayName,
    description,
    protocolVersion,
    toolsCount,
    resourcesCount,
    promptsCount,
    transport,
    registries: {
      mcpshelf: mcpshelfFound,
      glama: glamaFound,
      smithery: smitheryFound,
    },
    supportedClients: Array.from(supportedClients),
    registryUrl,
    status:
      mcpshelfFound && (smitheryFound || glamaFound)
        ? "verified"
        : anyIndexed
          ? "indexed"
          : "unverified",
  };
}
