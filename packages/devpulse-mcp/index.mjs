#!/usr/bin/env node
/**
 * @ritualdev-lab/devpulse-mcp
 * Zero-dependency JSON-RPC 2.0 stdio MCP server exposing DevPulse observability tools.
 */

const HOST = (process.env.DEVPULSE_HOST || "https://devpulse.ritualdev.in").replace(/\/$/, "");
const API_KEY = process.env.DEVPULSE_API_KEY || "";

const TOOLS = [
  {
    name: "list_crashes",
    description: "List recent grouped crash issues and business MRR impact for the active DevPulse project.",
    inputSchema: {
      type: "object",
      properties: {
        status: { type: "string", enum: ["all", "unresolved", "resolved", "ignored"] },
        limit: { type: "number" },
      },
    },
  },
  {
    name: "list_traces",
    description: "Fetch recent OpenTelemetry distributed traces and slow span latencies.",
    inputSchema: {
      type: "object",
      properties: {
        projectId: { type: "string" },
      },
    },
  },
  {
    name: "check_uptime",
    description: "Check live HTTP/API monitor statuses and 90-day P95 latency.",
    inputSchema: {
      type: "object",
      properties: {
        projectId: { type: "string" },
      },
      required: ["projectId"],
    },
  },
  {
    name: "get_feedback",
    description: "Fetch top-voted public feature requests and roadmap statuses for a project slug.",
    inputSchema: {
      type: "object",
      properties: {
        projectSlug: { type: "string" },
      },
      required: ["projectSlug"],
    },
  },
];

async function runTool(name, args = {}) {
  if (name === "list_crashes") {
    if (!API_KEY) return { error: "DEVPULSE_API_KEY env var is required for list_crashes." };
    const qs = new URLSearchParams({
      apiKey: API_KEY,
      status: String(args.status || "unresolved"),
      limit: String(Math.min(50, Number(args.limit || 15))),
    });
    const res = await fetch(`${HOST}/api/v1/event?${qs}`);
    return await res.json();
  }
  if (name === "list_traces") {
    const qs = new URLSearchParams(args.projectId ? { projectId: String(args.projectId) } : {});
    const res = await fetch(`${HOST}/api/v1/traces?${qs}`);
    return await res.json();
  }
  if (name === "check_uptime") {
    const res = await fetch(`${HOST}/api/v1/monitors?projectId=${encodeURIComponent(String(args.projectId))}`);
    return await res.json();
  }
  if (name === "get_feedback") {
    const res = await fetch(`${HOST}/api/v1/feedback?projectSlug=${encodeURIComponent(String(args.projectSlug))}`);
    return await res.json();
  }
  throw new Error(`Unknown tool: ${name}`);
}

function send(msg) {
  process.stdout.write(`${JSON.stringify(msg)}\n`);
}

let buffer = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", async (chunk) => {
  buffer += chunk;
  const lines = buffer.split(/\r?\n/);
  buffer = lines.pop() || "";

  for (const line of lines) {
    if (!line.trim()) continue;
    let req;
    try {
      req = JSON.parse(line);
    } catch {
      continue;
    }
    const { id, method, params } = req;

    try {
      if (method === "initialize") {
        send({
          jsonrpc: "2.0",
          id,
          result: {
            protocolVersion: "2024-11-05",
            serverInfo: { name: "devpulse-mcp", version: "1.0.0" },
            capabilities: { tools: {} },
          },
        });
      } else if (method === "tools/list") {
        send({ jsonrpc: "2.0", id, result: { tools: TOOLS } });
      } else if (method === "tools/call") {
        const result = await runTool(params?.name, params?.arguments || {});
        send({
          jsonrpc: "2.0",
          id,
          result: {
            content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
          },
        });
      } else if (id !== undefined) {
        send({ jsonrpc: "2.0", id, result: {} });
      }
    } catch (err) {
      if (id !== undefined) {
        send({
          jsonrpc: "2.0",
          id,
          error: { code: -32603, message: err?.message || "MCP execution failed" },
        });
      }
    }
  }
});
