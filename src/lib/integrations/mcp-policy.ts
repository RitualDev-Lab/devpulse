export const DEVPULSE_MCP_TOOLS = ["list_crashes", "list_traces", "check_uptime", "get_feedback", "get_analytics"] as const;
export type DevPulseMcpTool = (typeof DEVPULSE_MCP_TOOLS)[number];

export function parseMcpToolAllowlist(raw: string | null): string[] | null {
  if (raw === null) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return Array.from(new Set(parsed.filter((value): value is string =>
      typeof value === "string" && DEVPULSE_MCP_TOOLS.includes(value as DevPulseMcpTool)
    )));
  } catch {
    return [];
  }
}
