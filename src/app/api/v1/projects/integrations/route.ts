import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { projects } from "@/db/schema";
import { eq } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth";
import { resolveProjectAccess } from "@/lib/security/rbac";
import { recordAuditEvent } from "@/lib/security/audit";
import { verifyGitHubRepoOwnership } from "@/lib/security/github-ownership";

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

    await db
      .update(projects)
      .set({
        githubRepo: cleanGithub,
        npmPackage: cleanStr(npmPackage),
        pypiPackage: cleanStr(pypiPackage),
        rustCrate: cleanStr(rustCrate),
        goModule: cleanStr(goModule),
        dockerImage: cleanStr(dockerImage),
        vscodeExtension: cleanStr(vscodeExtension),
        mcpServerName: cleanStr(mcpServerName),
      })
      .where(eq(projects.id, projectId));

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
      },
    });

    return NextResponse.json({
      success: true,
      message: "Package integrations updated successfully.",
    });
  } catch (err: any) {
    console.error("Error updating project integrations:", err);
    return NextResponse.json(
      { error: err.message || "Failed to update project integrations" },
      { status: 500 }
    );
  }
}
