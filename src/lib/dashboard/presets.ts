import { PUBLIC_APP_URL } from "@/lib/config/app-url";
/**
 * Role-Aware Stack Presets for DevPulse Workspaces
 * Auto-selects optimal dashboard widgets, onboarding defaults, and copy-paste SDK snippets.
 */

export type StackPresetId = "saas" | "package" | "desktop" | "mcp";

export interface StackPresetDefinition {
  id: StackPresetId;
  name: string;
  tagline: string;
  badge: string;
  recommendedWidgets: Array<{ id: string; title: string; defaultW: number; defaultH: number }>;
  snippetTitle: string;
  buildSnippet: (apiKey: string, slug: string) => string;
}

export const STACK_PRESETS: Record<StackPresetId, StackPresetDefinition> = {
  saas: {
    id: "saas",
    name: "SaaS / Next.js Web App",
    tagline: "Web analytics, API uptime probes, revenue MRR & source-mapped crashes",
    badge: "Web + Revenue",
    recommendedWidgets: [
      { id: "web_analytics", title: "Cookie-Free Web Traffic", defaultW: 4, defaultH: 1 },
      { id: "uptime_monitors", title: "Uptime & P95 Latency", defaultW: 4, defaultH: 1 },
      { id: "revenue_stats", title: "Revenue & Monetization", defaultW: 4, defaultH: 1 },
      { id: "error_stream", title: "Sentry Issue Stream", defaultW: 8, defaultH: 1 },
      { id: "release_health", title: "Release Health & Commits", defaultW: 4, defaultH: 1 },
    ],
    snippetTitle: "Next.js / Browser SDK + Pageview Beacon",
    buildSnippet: (apiKey) =>
      `npm i @ritualdev/devpulse\n\nimport { DevPulse } from "@ritualdev/devpulse";\nconst pulse = new DevPulse({ apiKey: "${apiKey}", release: "v1.0.0" });\npulse.trackPageview({ path: window.location.pathname });`,
  },
  package: {
    id: "package",
    name: "npm / PyPI / CLI Package",
    tagline: "Daily registry downloads, GitHub PR/Issue triage, CLI crash telemetry",
    badge: "OSS Package",
    recommendedWidgets: [
      { id: "npm_downloads", title: "npm Downloads", defaultW: 4, defaultH: 1 },
      { id: "github_stats", title: "GitHub Repository", defaultW: 4, defaultH: 1 },
      { id: "release_health", title: "Release Health & Commits", defaultW: 4, defaultH: 1 },
      { id: "error_stream", title: "Sentry Issue Stream", defaultW: 8, defaultH: 1 },
      { id: "telemetry_setup", title: "SDK Integration", defaultW: 4, defaultH: 1 },
    ],
    snippetTitle: "CLI / Node / Python Package Telemetry",
    buildSnippet: (apiKey) =>
      `npm i @ritualdev/devpulse   # or: pip install devpulse-sdk\n\nimport { DevPulse } from "@ritualdev/devpulse";\nconst pulse = new DevPulse({ apiKey: "${apiKey}", runtime: "cli" });\npulse.trackEvent("cli_run", { sourceType: "cli" });`,
  },
  desktop: {
    id: "desktop",
    name: "Desktop / Rust / Electron",
    tagline: "Crates.io downloads, DWARF + .map symbolication, native OS metrics",
    badge: "Native + DWARF",
    recommendedWidgets: [
      { id: "github_stats", title: "GitHub Repository", defaultW: 4, defaultH: 1 },
      { id: "rust_crates", title: "Rust Crates.io", defaultW: 4, defaultH: 1 },
      { id: "release_health", title: "Release Health & Commits", defaultW: 4, defaultH: 1 },
      { id: "error_stream", title: "Sentry Issue Stream", defaultW: 8, defaultH: 1 },
      { id: "uptime_monitors", title: "Uptime & P95 Latency", defaultW: 4, defaultH: 1 },
    ],
    snippetTitle: "Electron / Rust DWARF + Source Maps CI",
    buildSnippet: (apiKey, slug) =>
      `# 1. Track desktop heartbeat:\ncurl -X POST ${PUBLIC_APP_URL}/api/v1/analytics -H "Content-Type: application/json" -d '{"apiKey":"${apiKey}","sourceType":"desktop","eventName":"app_launch","os":"Windows 11"}'\n\n# 2. Upload Rust .dwarf.json / JS .map:\nnpx @ritualdev/pulse upload-sourcemaps --key ${apiKey} --release v1.0.0 --dir ./dist # (${slug})`,
  },
  mcp: {
    id: "mcp",
    name: "AI / MCP Tooling",
    tagline: "MCP Server registry installs, tool latency monitoring & runtime crashes",
    badge: "AI / MCP",
    recommendedWidgets: [
      { id: "mcp_stats", title: "MCP Server Registry", defaultW: 4, defaultH: 1 },
      { id: "github_stats", title: "GitHub Repository", defaultW: 4, defaultH: 1 },
      { id: "uptime_monitors", title: "Uptime & P95 Latency", defaultW: 4, defaultH: 1 },
      { id: "error_stream", title: "Sentry Issue Stream", defaultW: 8, defaultH: 1 },
      { id: "telemetry_setup", title: "SDK Integration", defaultW: 4, defaultH: 1 },
    ],
    snippetTitle: "MCP Tool Call Telemetry & Errors",
    buildSnippet: (apiKey) =>
      `import { DevPulse } from "@ritualdev/devpulse";\nconst pulse = new DevPulse({ apiKey: "${apiKey}", runtime: "mcp-server" });\npulse.captureException(err, { breadcrumbs: [{ category: "mcp.tool", message: "search_docs" }] });`,
  },
};

export function normalizeStackPreset(raw?: string | null): StackPresetId {
  if (raw === "package" || raw === "desktop" || raw === "mcp" || raw === "saas") {
    return raw;
  }
  return "saas";
}
