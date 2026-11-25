import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/db";
import { projects } from "@/db/schema";
import { eq, desc, sql } from "drizzle-orm";
import crypto from "crypto";
import { getEffectiveEntitlements } from "@/lib/billing/plans";
import { listAccessibleProjects } from "@/lib/security/rbac";
import { ensurePrimaryKeyHashRecorded } from "@/lib/security/api-keys";
import { recordAuditEvent } from "@/lib/security/audit";
import { verifyGitHubRepoOwnership } from "@/lib/security/github-ownership";

export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const accessibleProjects = await listAccessibleProjects(user);
    return NextResponse.json({
      projects: accessibleProjects.map((p) => ({
        id: p.id,
        name: p.name,
        slug: p.slug,
        description: p.description,
        githubRepo: p.githubRepo,
        npmPackage: p.npmPackage,
        pypiPackage: p.pypiPackage,
        rustCrate: p.rustCrate,
        goModule: p.goModule,
        telemetryApiKey:
          p.accessRole === "viewer" || p.accessRole === "billing"
            ? p.telemetryApiKey.slice(0, 12) + "..."
            : p.telemetryApiKey,
        accessRole: p.accessRole,
        organizationId: p.organizationId,
        workspaceId: p.workspaceId,
        createdAt: p.createdAt,
      })),
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { name, githubRepo, npmPackage, pypiPackage, rustCrate, goModule, vscodeExtension, mcpServerName } = body;

    if (!name || typeof name !== "string") {
      return NextResponse.json({ error: "Project name is required" }, { status: 400 });
    }

    let verifiedGithubRepo: string | null = null;
    if (githubRepo && typeof githubRepo === "string" && githubRepo.trim()) {
      const ownership = await verifyGitHubRepoOwnership(user, githubRepo);
      if (!ownership.allowed) {
        await recordAuditEvent({
          userId: user.id,
          actorUsername: user.githubUsername,
          action: "project.create_denied",
          resourceType: "project",
          resourceId: ownership.githubRepo,
          status: "denied",
          headers: request.headers,
        });
        return NextResponse.json(
          { error: ownership.reason || "You can only link your own GitHub repositories." },
          { status: 403 }
        );
      }
      verifiedGithubRepo = ownership.githubRepo;
    }

    const entitlements = getEffectiveEntitlements({ storageTier: user.storageTier });
    if (entitlements.maxProjects !== null) {
      const [{ count }] = await db
        .select({ count: sql<number>`count(*)` })
        .from(projects)
        .where(eq(projects.userId, user.id));

      if (Number(count) >= entitlements.maxProjects) {
        return NextResponse.json(
          {
            error: `Project limit reached (${entitlements.maxProjects} on ${entitlements.plan.name}). Upgrade to Developer Pro ($14/mo for 25 projects) or Team ($49/mo for unlimited projects).`,
            code: "PROJECT_LIMIT_REACHED",
            limit: entitlements.maxProjects,
            plan: entitlements.plan.id,
          },
          { status: 402 }
        );
      }
    }

    const baseSlug = name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "project";

    let slug = baseSlug;
    let counter = 1;
    while (true) {
      const slugCheck = await db
        .select()
        .from(projects)
        .where(eq(projects.slug, slug))
        .limit(1);
      if (slugCheck.length === 0) break;
      slug = `${baseSlug}-${counter++}`;
    }

    const projectId = `prj_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
    const telemetryApiKey = `dp_live_${crypto.randomBytes(12).toString("hex")}`;
    const publicWriteKey = `dp_pub_${crypto.randomBytes(12).toString("hex")}`;

    await db.insert(projects).values({
      id: projectId,
      userId: user.id,
      name,
      slug,
      githubRepo: verifiedGithubRepo,
      npmPackage: npmPackage || null,
      pypiPackage: pypiPackage || null,
      rustCrate: rustCrate || null,
      goModule: goModule || null,
      vscodeExtension: vscodeExtension || null,
      mcpServerName: mcpServerName || null,
      telemetryApiKey,
      publicWriteKey,
      isPublic: true,
      theme: "dark",
    });

    await ensurePrimaryKeyHashRecorded({
      projectId,
      rawKey: telemetryApiKey,
      userId: user.id,
      name: "Primary SDK Key",
    });

    await recordAuditEvent({
      userId: user.id,
      actorUsername: user.githubUsername,
      projectId,
      action: "project.created",
      resourceType: "project",
      resourceId: projectId,
      headers: request.headers,
      metadata: { name, slug },
    });

    const created = await db.select().from(projects).where(eq(projects.id, projectId)).limit(1);

    return NextResponse.json({ success: true, project: created[0] });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
