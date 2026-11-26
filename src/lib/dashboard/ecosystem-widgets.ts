import { STACK_PRESETS, type StackPresetId } from "./presets";

export interface EcosystemWidgetSpec {
  field:
    | "githubRepo"
    | "npmPackage"
    | "pypiPackage"
    | "rustCrate"
    | "goModule"
    | "dockerImage"
    | "vscodeExtension"
    | "mcpServerName";
  widgetId: string;
  title: string;
  snapshotKey: "github" | "npm" | "pypi" | "crates" | "go" | "docker" | "vscode" | "mcp";
}

export const ECOSYSTEM_WIDGET_DEFS: readonly EcosystemWidgetSpec[] = [
  { field: "githubRepo", widgetId: "github_stats", title: "GitHub Repository", snapshotKey: "github" },
  { field: "npmPackage", widgetId: "npm_downloads", title: "npm Registry", snapshotKey: "npm" },
  { field: "pypiPackage", widgetId: "pypi_downloads", title: "PyPI Package", snapshotKey: "pypi" },
  { field: "rustCrate", widgetId: "rust_crates", title: "Rust Crates.io", snapshotKey: "crates" },
  { field: "goModule", widgetId: "go_module", title: "Go Module Proxy", snapshotKey: "go" },
  { field: "dockerImage", widgetId: "docker_container", title: "Docker Hub Container", snapshotKey: "docker" },
  { field: "vscodeExtension", widgetId: "vscode_stats", title: "VS Code Extension", snapshotKey: "vscode" },
  { field: "mcpServerName", widgetId: "mcp_stats", title: "MCP Server Registry", snapshotKey: "mcp" },
];

export type EcosystemFieldsInput = Partial<Record<EcosystemWidgetSpec["field"], string | null | undefined>>;

/**
 * Builds deduplicated default widgets for standalone (no-Git) or repo-backed workspaces,
 * omitting ecosystem-specific preset cards whose backing identifier was not configured.
 */
export function buildEcosystemWidgets(
  fields: EcosystemFieldsInput,
  stackPreset: StackPresetId
): Array<{ id: string; title: string; defaultW: number; defaultH: number }> {
  const widgetMap = new Map<string, { id: string; title: string; defaultW: number; defaultH: number }>();

  for (const spec of ECOSYSTEM_WIDGET_DEFS) {
    const val = fields[spec.field];
    if (typeof val === "string" && val.trim().length > 0) {
      widgetMap.set(spec.widgetId, { id: spec.widgetId, title: spec.title, defaultW: 4, defaultH: 1 });
    }
  }

  const presetDefs = STACK_PRESETS[stackPreset].recommendedWidgets;
  for (const def of presetDefs) {
    const matchingSpec = ECOSYSTEM_WIDGET_DEFS.find((s) => s.widgetId === def.id);
    if (matchingSpec) {
      const val = fields[matchingSpec.field];
      if (!(typeof val === "string" && val.trim().length > 0)) continue;
    }
    if (!widgetMap.has(def.id)) {
      widgetMap.set(def.id, def);
    }
  }

  if (!widgetMap.has("telemetry_setup")) {
    widgetMap.set("telemetry_setup", { id: "telemetry_setup", title: "SDK Integration", defaultW: 4, defaultH: 1 });
  }
  if (!widgetMap.has("bug_report_badge")) {
    widgetMap.set("bug_report_badge", { id: "bug_report_badge", title: "Public Bug Portal", defaultW: 4, defaultH: 1 });
  }

  return Array.from(widgetMap.values());
}
