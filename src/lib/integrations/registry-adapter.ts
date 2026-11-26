import type { DepsDevAdvisorySummary, DepsDevSystem } from "./deps-dev";

export type RegistryProviderId =
  | "npm"
  | "pypi"
  | "crates"
  | "go"
  | "docker"
  | "vscode"
  | "mcp";

export interface RegistryAdapterMeta {
  id: RegistryProviderId;
  label: string;
  projectField:
    | "npmPackage"
    | "pypiPackage"
    | "rustCrate"
    | "goModule"
    | "dockerImage"
    | "vscodeExtension"
    | "mcpServerName";
  depsDevSystem: DepsDevSystem | null;
  buildUrl: (identifier: string) => string;
}

export const REGISTRY_ADAPTERS: Record<RegistryProviderId, RegistryAdapterMeta> = {
  npm: {
    id: "npm",
    label: "npm",
    projectField: "npmPackage",
    depsDevSystem: "NPM",
    buildUrl: (id) => `https://www.npmjs.com/package/${encodeURIComponent(id).replace(/%2F/gi, "/")}`,
  },
  pypi: {
    id: "pypi",
    label: "PyPI",
    projectField: "pypiPackage",
    depsDevSystem: "PYPI",
    buildUrl: (id) => `https://pypi.org/project/${encodeURIComponent(id)}/`,
  },
  crates: {
    id: "crates",
    label: "Crates.io",
    projectField: "rustCrate",
    depsDevSystem: "CARGO",
    buildUrl: (id) => `https://crates.io/crates/${encodeURIComponent(id)}`,
  },
  go: {
    id: "go",
    label: "Go Modules",
    projectField: "goModule",
    depsDevSystem: "GO",
    buildUrl: (id) => `https://pkg.go.dev/${id}`,
  },
  docker: {
    id: "docker",
    label: "Docker Hub",
    projectField: "dockerImage",
    depsDevSystem: null,
    buildUrl: (id) =>
      id.startsWith("library/")
        ? `https://hub.docker.com/_/${id.slice("library/".length)}`
        : `https://hub.docker.com/r/${id}`,
  },
  vscode: {
    id: "vscode",
    label: "VS Code",
    projectField: "vscodeExtension",
    depsDevSystem: null,
    buildUrl: (id) => `https://marketplace.visualstudio.com/items?itemName=${encodeURIComponent(id)}`,
  },
  mcp: {
    id: "mcp",
    label: "MCP Registry",
    projectField: "mcpServerName",
    depsDevSystem: null,
    buildUrl: (id) => `https://smithery.ai/server/${id}`,
  },
};

export interface ExtraPackageSnapshot {
  connectorId: string;
  provider: RegistryProviderId;
  label: string;
  identifier: string;
  latestVersion?: string | null;
  metricLabel: string;
  metricValue: number | null;
  url: string;
  security?: DepsDevAdvisorySummary | null;
}

export function normalizeRegistryProvider(raw?: string | null): RegistryProviderId | null {
  const s = (raw || "").trim().toLowerCase();
  if (s === "npm" || s === "pypi" || s === "crates" || s === "go" || s === "docker" || s === "vscode" || s === "mcp") {
    return s;
  }
  if (s === "crates.io" || s === "rust") return "crates";
  if (s === "golang") return "go";
  if (s === "vs code" || s === "open-vsx") return "vscode";
  return null;
}

export function securitySummaryKey(system: DepsDevSystem, packageName: string): string {
  return `${system}:${packageName.trim().toLowerCase()}`;
}

export function formatRelativeSyncAge(iso?: string | null, nowMs = Date.now()): string {
  if (!iso) return "Not synced yet";
  const parsed = Date.parse(iso);
  if (!Number.isFinite(parsed)) return "Synced";
  const diffSec = Math.max(0, Math.floor((nowMs - parsed) / 1000));
  if (diffSec < 45) return "Synced just now";
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `Synced ${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 48) return `Synced ${diffHr}h ago`;
  return `Synced ${Math.floor(diffHr / 24)}d ago`;
}
