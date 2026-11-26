import { NextRequest, NextResponse } from "next/server";
import { and, desc, eq, gte } from "drizzle-orm";
import { db } from "@/db";
import { mcpToolCalls, projects } from "@/db/schema";
import { verifyTelemetryApiKey } from "@/lib/security/api-keys";
import { getCurrentUser } from "@/lib/auth";
import { resolveProjectAccess } from "@/lib/security/rbac";
import { recordAuditEvent } from "@/lib/security/audit";
import { DEVPULSE_MCP_TOOLS, parseMcpToolAllowlist } from "@/lib/integrations/mcp-policy";
import { isPublicDemoProject } from "@/lib/security/demo-project";
import { aggregateMcpMetrics } from "@/lib/integrations/mcp-analytics";

export const dynamic = "force-dynamic";

function getBearer(req: NextRequest): string {
  return req.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim() || "";
}

export async function GET(req: NextRequest) {
  try {
    const apiKey = getBearer(req);
    const projectId = req.nextUrl.searchParams.get("projectId")?.trim();
    let authorizedProjectId = projectId;
    if (apiKey) {
      const verified = await verifyTelemetryApiKey(apiKey);
      if (!verified) return NextResponse.json({ error: "Invalid API key" }, { status: 401 });
      authorizedProjectId = verified.id;
    } else {
      if (!projectId) return NextResponse.json({ error: "Missing projectId" }, { status: 400 });
      if (!isPublicDemoProject(projectId)) {
        const user = await getCurrentUser();
        if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        const access = await resolveProjectAccess(projectId, user);
        if (!access) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
    }
    if (!authorizedProjectId) return NextResponse.json({ error: "Project not found" }, { status: 404 });

    const cutoff = new Date(Date.now() - 30 * 86400_000).toISOString().replace("T", " ").slice(0, 19);
    const [calls, project] = await Promise.all([
      db.select({ toolName: mcpToolCalls.toolName, outcome: mcpToolCalls.outcome, durationMs: mcpToolCalls.durationMs, createdAt: mcpToolCalls.createdAt })
        .from(mcpToolCalls)
        .where(and(eq(mcpToolCalls.projectId, authorizedProjectId), gte(mcpToolCalls.createdAt, cutoff)))
        .orderBy(desc(mcpToolCalls.createdAt))
        .limit(5000),
      db.select({ policy: projects.mcpAllowedToolsJson }).from(projects).where(eq(projects.id, authorizedProjectId)).limit(1),
    ]);
    const agg = aggregateMcpMetrics(calls);
    const allowlist = parseMcpToolAllowlist(project[0]?.policy ?? null);
    return NextResponse.json({
      windowDays: 30,
      totalCalls: agg.totalCalls,
      deniedCount: agg.deniedCount,
      errorCount: agg.errorCount,
      errorRatePercent: agg.errorRatePercent,
      p50DurationMs: agg.p50DurationMs,
      p95DurationMs: agg.p95DurationMs,
      totalTokens: agg.totalTokens,
      estimatedCostUsd: agg.estimatedCostUsd,
      truncated: calls.length === 5000,
      policy: { mode: allowlist === null ? "all_allowed" : "allowlist", allowedTools: allowlist ?? [...DEVPULSE_MCP_TOOLS] },
      tools: agg.tools,
      daily: agg.daily,
    });
  } catch (error) {
    console.error("MCP analytics error:", error);
    return NextResponse.json({ error: "Failed to load MCP tool analytics" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const parsed: unknown = await req.json();
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }
    const body = parsed as Record<string, unknown>;
    const action = String(body.action || "");
    if (action === "configure") {
      const user = await getCurrentUser();
      if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      const projectId = String(body.projectId || "");
      if (!projectId) return NextResponse.json({ error: "Missing projectId" }, { status: 400 });
      const access = await resolveProjectAccess(projectId, user);
      if (!access?.canManageSecurity) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      const selected = body.allowedTools;
      if (selected !== null && (!Array.isArray(selected) || selected.some((tool: unknown) => typeof tool !== "string" || !DEVPULSE_MCP_TOOLS.includes(tool as (typeof DEVPULSE_MCP_TOOLS)[number])))) {
        return NextResponse.json({ error: "allowedTools must be null or a list of supported tool names" }, { status: 400 });
      }
      const allowedTools = selected === null ? null : Array.from(new Set(selected as string[]));
      await db.update(projects).set({ mcpAllowedToolsJson: allowedTools === null ? null : JSON.stringify(allowedTools) }).where(eq(projects.id, projectId));
      await recordAuditEvent({ userId: user.id, actorUsername: user.githubUsername, organizationId: access.project.organizationId, workspaceId: access.project.workspaceId, projectId, action: "mcp.policy_updated", resourceType: "mcp_policy", resourceId: projectId, headers: req.headers, metadata: { allowedTools } });
      return NextResponse.json({ success: true, allowedTools });
    }
    const apiKey = getBearer(req);
    if (!apiKey) return NextResponse.json({ error: "Missing bearer API key" }, { status: 401 });
    const verified = await verifyTelemetryApiKey(apiKey);
    if (!verified) return NextResponse.json({ error: "Invalid API key" }, { status: 401 });

    const toolName = String(body.toolName || "").trim();
    if (!DEVPULSE_MCP_TOOLS.includes(toolName as (typeof DEVPULSE_MCP_TOOLS)[number])) {
      return NextResponse.json({ error: "Unknown MCP tool" }, { status: 400 });
    }
    const [project] = await db.select({ userId: projects.userId, organizationId: projects.organizationId, workspaceId: projects.workspaceId, policy: projects.mcpAllowedToolsJson })
      .from(projects).where(eq(projects.id, verified.id)).limit(1);
    if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });
    const allowedTools = parseMcpToolAllowlist(project.policy);

    if (action === "authorize") {
      const allowed = allowedTools === null || allowedTools.includes(toolName);
      if (!allowed) {
        const id = `mcp_${crypto.randomUUID().replace(/-/g, "").slice(0, 18)}`;
        await db.insert(mcpToolCalls).values({ id, projectId: verified.id, toolName, outcome: "denied", durationMs: 0 });
        await recordAuditEvent({
          userId: project.userId,
          actorUsername: "devpulse-mcp-client",
          organizationId: project.organizationId,
          workspaceId: project.workspaceId,
          projectId: verified.id,
          action: "mcp.tool_denied",
          resourceType: "mcp_tool",
          resourceId: toolName,
          status: "denied",
          headers: req.headers,
          metadata: { toolName, policyMode: "allowlist" },
        });
      }
      return NextResponse.json({ allowed, reason: allowed ? null : "Tool is not in this project's MCP allowlist." });
    }

    if (action === "complete") {
      const outcome = body.outcome === "error" ? "error" : "allowed";
      const durationMs = Math.max(0, Math.min(120_000, Math.floor(Number(body.durationMs) || 0)));
      const id = `mcp_${crypto.randomUUID().replace(/-/g, "").slice(0, 18)}`;
      await db.insert(mcpToolCalls).values({ id, projectId: verified.id, toolName, outcome, durationMs });
      await recordAuditEvent({
        userId: project.userId,
        actorUsername: "devpulse-mcp-client",
        organizationId: project.organizationId,
        workspaceId: project.workspaceId,
        projectId: verified.id,
        action: "mcp.tool_called",
        resourceType: "mcp_tool",
        resourceId: toolName,
        headers: req.headers,
        metadata: { toolName, outcome, durationMs },
      });
      return NextResponse.json({ success: true });
    }
    return NextResponse.json({ error: "Unsupported action" }, { status: 400 });
  } catch (error) {
    console.error("MCP tool telemetry error:", error);
    return NextResponse.json({ error: "MCP tool policy check failed" }, { status: 500 });
  }
}
