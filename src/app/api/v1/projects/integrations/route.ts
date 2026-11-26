import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { projects } from "@/db/schema";
import { eq } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth";
import { resolveProjectAccess } from "@/lib/security/rbac";
import { recordAuditEvent } from "@/lib/security/audit";
import { verifyGitHubRepoOwnership } from "@/lib/security/github-ownership";
import { apiError } from "@/lib/security/api-error";
import { DEVPULSE_MCP_TOOLS } from "@/lib/integrations/mcp-policy";
import { ECOSYSTEM_WIDGET_DEFS } from "@/lib/dashboard/ecosystem-widgets";
import { syncEcosystemWidgetsAndSnapshots } from "@/lib/dashboard/snapshots";

export async function POST(req: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const {
      projectId,
      githubRepo,
      npmPackage,
      pypiPackage,
      rustCrate,
      goModule,
      dockerImage,
      vscodeExtension,
      mcpServerName,
      mcpAllowedTools,
    } = body;

    if (!projectId) {
      return NextResponse.json({ error: "Missing projectId" }, { status: 400 });
    }

    const access = await resolveProjectAccess(String(projectId), user);
    if (!access || !access.canWrite) {
      await recordAuditEvent({
        userId: user.id,
        actorUsername: user.githubUsername,
        projectId: String(projectId),
        action: "integrations.updated",
        resourceType: "project",
        resourceId: String(projectId),
        status: "denied",
        headers: req.headers,
        metadata: { role: access?.role || "none" },
      });
      return NextResponse.json(
        { error: "Forbidden: Viewer role cannot modify project integrations." },
        { status: 403 }
      );
    }

    const cleanStr = (val?: string | null) => {
      if (!val) return null;
      const trimmed = val.trim();
      return trimmed.length > 0 ? trimmed : null;
    };
    if (mcpAllowedTools !== undefined && mcpAllowedTools !== null &&
      (!Array.isArray(mcpAllowedTools) || mcpAllowedTools.some((tool: unknown) => typeof tool !== "string" || !DEVPULSE_MCP_TOOLS.includes(tool as (typeof DEVPULSE_MCP_TOOLS)[number])))) {
      return NextResponse.json({ error: "mcpAllowedTools must be null or a list of supported MCP tools" }, { status: 400 });
    }
    if (mcpAllowedTools !== undefined && !access.canManageSecurity) {
      await recordAuditEvent({ userId: user.id, actorUsername: user.githubUsername, organizationId: access.project.organizationId, projectId: access.project.id, action: "mcp.policy_update_denied", resourceType: "mcp_policy", resourceId: access.project.id, status: "denied", headers: req.headers, metadata: { role: access.role } });
      return NextResponse.json({ error: "Forbidden: Only workspace security admins can manage MCP tool policy." }, { status: 403 });
    }

    let cleanGithub = cleanStr(githubRepo);
    if (cleanGithub && cleanGithub.toLowerCase() !== (access.project.githubRepo || "").toLowerCase()) {
      const ownership = await verifyGitHubRepoOwnership(user, cleanGithub);
      if (!ownership.allowed) {
        await recordAuditEvent({
          userId: user.id,
          actorUsername: user.githubUsername,
          projectId: access.project.id,
          action: "integrations.github_denied",
          resourceType: "project",
          resourceId: ownership.githubRepo,
          status: "denied",
          headers: req.headers,
        });
        return NextResponse.json(
          { error: ownership.reason || "You can only connect GitHub repositories you own or maintain." },
          { status: 403 }
        );
      }
      cleanGithub = ownership.githubRepo;
    }

    if (mcpAllowedTools !== undefined) {
      await recordAuditEvent({ userId: user.id, actorUsername: user.githubUsername, organizationId: access.project.organizationId, workspaceId: access.project.workspaceId, projectId: access.project.id, action: "mcp.policy_updated", resourceType: "mcp_policy", resourceId: access.project.id, headers: req.headers, metadata: { allowedTools: mcpAllowedTools } });
    }

    const previousFields = {
      githubRepo: access.project.githubRepo || null,
      npmPackage: access.project.npmPackage || null,
      pypiPackage: access.project.pypiPackage || null,
      rustCrate: access.project.rustCrate || null,
      goModule: access.project.goModule || null,
      dockerImage: access.project.dockerImage || null,
      vscodeExtension: access.project.vscodeExtension || null,
      mcpServerName: access.project.mcpServerName || null,
    };
    const nextFields = {
      githubRepo: cleanGithub,
      npmPackage: cleanStr(npmPackage),
      pypiPackage: cleanStr(pypiPackage),
      rustCrate: cleanStr(rustCrate),
      goModule: cleanStr(goModule),
      dockerImage: cleanStr(dockerImage),
      vscodeExtension: cleanStr(vscodeExtension),
      mcpServerName: cleanStr(mcpServerName),
    };

    await db
      .update(projects)
      .set({
        ...nextFields,
        ...(mcpAllowedTools !== undefined
          ? { mcpAllowedToolsJson: mcpAllowedTools === null ? null : JSON.stringify(Array.from(new Set(mcpAllowedTools))) }
          : {}),
      })
      .where(eq(projects.id, projectId));

    const changedFields = ECOSYSTEM_WIDGET_DEFS
      .map((d) => d.field)
      .filter((field) => previousFields[field] !== nextFields[field]);
    if (changedFields.length > 0) {
      await syncEcosystemWidgetsAndSnapshots({
        projectId,
        userIdForOAuth: user.id,
        changedFields,
      });
    }

    await recordAuditEvent({
      userId: user.id,
      actorUsername: user.githubUsername,
      organizationId: access.project.organizationId,
      projectId: access.project.id,
      action: "integrations.updated",
      resourceType: "project",
      resourceId: access.project.id,
      headers: req.headers,
      metadata: {
        githubRepo: cleanStr(githubRepo),
        npmPackage: cleanStr(npmPackage),
        pypiPackage: cleanStr(pypiPackage),
        rustCrate: cleanStr(rustCrate),
        ...(mcpAllowedTools !== undefined ? { mcpAllowedTools: mcpAllowedTools === null ? null : [...mcpAllowedTools] } : {}),
      },
    });

    return NextResponse.json({
      success: true,
      message: "Package integrations updated successfully.",
    });
  } catch (err) {
    console.error("Error updating project integrations:", err);
    return apiError(err, "Failed to update project integrations", 500);
  }
}
