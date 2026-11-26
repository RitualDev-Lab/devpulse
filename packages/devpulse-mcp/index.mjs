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
  {
    name: "get_analytics",
    description: "Fetch session, 7-day retention, and custom-event funnel analytics for this project.",
    inputSchema: {
      type: "object",
      properties: {
        days: { type: "number", description: "Lookback days (1-90)" },
        funnel: { type: "string", description: "Comma-separated sequence of event names" },
      },
    },
  },
];

async function runTool(name, args = {}) {
  if (name === "list_crashes") {
    if (!API_KEY) return { error: "DEVPULSE_API_KEY env var is required for list_crashes." };
    const qs = new URLSearchParams({
      status: String(args.status || "unresolved"),
      limit: String(Math.min(50, Number(args.limit || 15))),
    });
    // The key goes in the Authorization header, never in the URL (URLs end up in logs).
    const res = await fetch(`${HOST}/api/v1/event?${qs}`, {
      headers: { Authorization: `Bearer ${API_KEY}` },
    });
    return await res.json();
  }
  if (name === "list_traces") {
    const qs = new URLSearchParams(args.projectId ? { projectId: String(args.projectId) } : {});
    const res = await fetch(`${HOST}/api/v1/traces?${qs}`, API_KEY ? { headers: { Authorization: `Bearer ${API_KEY}` } } : {});
    return await res.json();
  }
  if (name === "check_uptime") {
    const res = await fetch(`${HOST}/api/v1/monitors?projectId=${encodeURIComponent(String(args.projectId))}`, API_KEY ? { headers: { Authorization: `Bearer ${API_KEY}` } } : {});
    return await res.json();
  }
  if (name === "get_feedback") {
    const qs = new URLSearchParams(args.projectSlug ? { projectSlug: String(args.projectSlug) } : {});
    const res = await fetch(`${HOST}/api/v1/feedback?${qs}`, API_KEY ? { headers: { Authorization: `Bearer ${API_KEY}` } } : {});
    return await res.json();
  }
  if (name === "get_analytics") {
    if (!API_KEY) return { error: "DEVPULSE_API_KEY env var is required for get_analytics." };
    const qs = new URLSearchParams({ days: String(Math.min(90, Math.max(1, Number(args.days || 30)))), funnel: String(args.funnel || "") });
    const res = await fetch(`${HOST}/api/v1/analytics?${qs}`, { headers: { Authorization: `Bearer ${API_KEY}` } });
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
        const toolName = String(params?.name || "");
        const startedAt = Date.now();
        if (API_KEY && TOOLS.some((tool) => tool.name === toolName)) {
          const policyResponse = await fetch(`${HOST}/api/v1/mcp`, {
            method: "POST",
            headers: { Authorization: `Bearer ${API_KEY}`, "Content-Type": "application/json" },
            body: JSON.stringify({ action: "authorize", toolName }),
          });
          const policy = await policyResponse.json();
          if (!policyResponse.ok || policy.allowed !== true) {
            const result = { error: policy.error || policy.reason || "MCP tool denied by project policy." };
            send({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], isError: true } });
            continue;
          }
        }
        let result;
        let outcome = "allowed";
        try {
          result = await runTool(toolName, params?.arguments || {});
          if (result && typeof result === "object" && "error" in result) outcome = "error";
        } catch (error) {
          outcome = "error";
          throw error;
        } finally {
          if (API_KEY && TOOLS.some((tool) => tool.name === toolName)) {
            await fetch(`${HOST}/api/v1/mcp`, {
              method: "POST",
              headers: { Authorization: `Bearer ${API_KEY}`, "Content-Type": "application/json" },
              body: JSON.stringify({ action: "complete", toolName, outcome, durationMs: Date.now() - startedAt }),
            }).catch(() => {});
          }
        }
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
