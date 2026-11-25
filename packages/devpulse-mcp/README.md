# @ritualdev-lab/devpulse-mcp

Official Model Context Protocol (MCP) server for DevPulse — inspect live grouped crashes, OTel traces, uptime P95 latency, and feature requests directly inside Claude Code, Cursor, or Antigravity.

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
