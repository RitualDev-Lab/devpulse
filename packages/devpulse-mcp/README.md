# @ritualdev-lab/devpulse-mcp

Official Model Context Protocol (MCP) server for DevPulse — inspect live grouped crashes, OTel traces, uptime P95 latency, feedback, and session/funnel analytics directly inside Claude Code, Cursor, or Antigravity. When a telemetry key is configured, tool calls are checked against the project's MCP allowlist and recorded in its audit analytics.

## Claude Code / Cursor Configuration
```json
{
  "mcpServers": {
    "devpulse": {
      "command": "npx",
      "args": ["@ritualdev-lab/devpulse-mcp"],
      "env": {
        "DEVPULSE_HOST": "https://devpulse.ritualdev.in",
        "DEVPULSE_API_KEY": "dp_live_your_key"
      }
    }
  }
}
```
