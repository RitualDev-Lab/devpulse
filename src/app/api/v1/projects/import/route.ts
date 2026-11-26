import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { scanGitHubRepository } from "@/lib/scanner/github-scanner";
import { db } from "@/db";
import { projects, dashboardWidgets, projectConnectors } from "@/db/schema";
import { eq, and, sql } from "drizzle-orm";
import crypto from "crypto";
import { buildDefaultLayout } from "@/lib/layout/grid-engine";
import { normalizeStackPreset } from "@/lib/dashboard/presets";
import { buildEcosystemWidgets } from "@/lib/dashboard/ecosystem-widgets";
import { getEffectiveEntitlements } from "@/lib/billing/plans";
import { ensurePrimaryKeyHashRecorded } from "@/lib/security/api-keys";
import { recordAuditEvent } from "@/lib/security/audit";
import { verifyGitHubRepoOwnership } from "@/lib/security/github-ownership";
import { encryptSecret } from "@/lib/security/crypto";
import { apiError } from "@/lib/security/api-error";

export async function POST(request: Request) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json(
        { error: "Unauthorized. Please sign in with GitHub to import a repository." },
        { status: 401 }
      );
    }

    const body = await request.json();
    const { repo, stackPreset: rawPreset, githubToken } = body;
    const explicitPat = typeof githubToken === "string" && githubToken.trim() ? githubToken.trim() : null;
    const stackPreset = normalizeStackPreset(rawPreset);

    if (!repo || typeof repo !== "string" || !repo.trim()) {
      return NextResponse.json(
        { error: "Please provide a valid GitHub repository in 'owner/repo' format." },
        { status: 400 }
      );
    }

    // 0. Enforce strict Personal / Verified GitHub Organization ownership (supports inline PAT for private repos)
    const ownership = await verifyGitHubRepoOwnership(user, repo, explicitPat);
    if (!ownership.allowed) {
      await recordAuditEvent({
        userId: user.id,
        actorUsername: user.githubUsername,
        action: "project.import_denied",
        resourceType: "project",
        resourceId: ownership.githubRepo,
        status: "denied",
        headers: request.headers,
        metadata: { reason: ownership.reason },
      });
      return NextResponse.json(
        {
          error: ownership.reason || "You can only import repositories you own or maintain.",
          code: ownership.needsOrgReauth ? "ORG_REAUTH_REQUIRED" : "REPO_NOT_OWNED",
        },
        { status: 403 }
      );
    }

    // 1. Run GitHub Root Scanner (with user's OAuth token when present)
    const scanned = await scanGitHubRepository(ownership.githubRepo, ownership.token || undefined);

    // 2. Check if this repository is already tracked by this user
    const existing = await db
      .select()
      .from(projects)
      .where(
        and(
          eq(projects.userId, user.id),
          eq(projects.githubRepo, scanned.githubRepo)
        )
      )
      .limit(1);

    if (existing[0]) {
      if (explicitPat) {
        const enc = await encryptSecret(explicitPat).catch(() => null);
        if (enc) {
          await db
            .update(projects)
            .set({ githubTokenEncrypted: enc })
            .where(eq(projects.id, existing[0].id));
        }
      }
      return NextResponse.json({
        success: true,
        message: "Repository is already imported.",
        project: existing[0],
        summary: scanned.summary,
      });
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
            error: `Project limit reached (${entitlements.maxProjects} on ${entitlements.plan.name}). Upgrade to Developer Pro ($14/mo) or Team ($49/mo) in Billing to import more repositories.`,
            code: "PROJECT_LIMIT_REACHED",
            limit: entitlements.maxProjects,
            plan: entitlements.plan.id,
          },
          { status: 402 }
        );
      }
    }

    // 3. Generate globally unique slug across all tenants
    const baseSlug = scanned.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "project";

    let slug = baseSlug;
    let counter = 1;
    while (true) {
      const slugCheck = await db
        .select({ id: projects.id })
        .from(projects)
        .where(eq(projects.slug, slug))
        .limit(1);
      if (slugCheck.length === 0) break;
      slug = `${baseSlug}-${counter++}`;
    }

    const projectId = `prj_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
    const telemetryApiKey = `dp_live_${crypto.randomBytes(12).toString("hex")}`;
    const publicWriteKey = `dp_pub_${crypto.randomBytes(12).toString("hex")}`;
    const encryptedPat = explicitPat ? await encryptSecret(explicitPat).catch(() => null) : null;

    // 4. Insert new Project row
    await db.insert(projects).values({
      id: projectId,
      userId: user.id,
      name: scanned.name,
      slug,
      description: scanned.description || `Developer mission control for ${scanned.githubRepo}`,
      githubRepo: scanned.githubRepo,
      githubTokenEncrypted: encryptedPat,
      npmPackage: scanned.detectedEcosystems.npmPackage || null,
      pypiPackage: scanned.detectedEcosystems.pypiPackage || null,
      rustCrate: scanned.detectedEcosystems.rustCrate || null,
      goModule: scanned.detectedEcosystems.goModule || null,
      dockerImage: scanned.detectedEcosystems.dockerImage || null,
      vscodeExtension: scanned.detectedEcosystems.vscodeExtension || null,
      mcpServerName: scanned.detectedEcosystems.mcpServerName || null,
      stackPreset,
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
      action: "project.imported",
      resourceType: "project",
      resourceId: projectId,
      headers: request.headers,
      metadata: { githubRepo: scanned.githubRepo, slug },
    });

    // 5. Seed initial 2D 12-column widgets combining Role-Aware Preset + verified detected ecosystems
    const initialDefs = buildEcosystemWidgets(
      {
        githubRepo: scanned.githubRepo,
        npmPackage: scanned.detectedEcosystems.npmPackage,
        pypiPackage: scanned.detectedEcosystems.pypiPackage,
        rustCrate: scanned.detectedEcosystems.rustCrate,
        goModule: scanned.detectedEcosystems.goModule,
        dockerImage: scanned.detectedEcosystems.dockerImage,
        vscodeExtension: scanned.detectedEcosystems.vscodeExtension,
        mcpServerName: scanned.detectedEcosystems.mcpServerName,
      },
      stackPreset
    );

    const layoutItems = buildDefaultLayout(initialDefs);
    if (layoutItems.length > 0) {
      await db.insert(dashboardWidgets).values(
        layoutItems.map((w) => ({
          id: `w_${projectId}_${w.id}`.slice(0, 128),
          projectId,
          widgetType: w.id,
          title: w.title,
          positionX: w.x,
          positionY: w.y,
          width: w.w,
          height: w.h,
          isVisible: w.isVisible,
        }))
      );
    }

    if (scanned.detectedConnectors && scanned.detectedConnectors.length > 0) {
      const nowIso = new Date().toISOString();
      await db
        .insert(projectConnectors)
        .values(
          scanned.detectedConnectors.slice(0, 12).map((conn) => ({
            id: `con_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`,
            projectId,
            category: "package" as const,
            provider: conn.provider,
            label: conn.label,
            targetUrl: conn.url,
            identifier: conn.identifier,
            lastSyncedAt: nowIso,
          }))
        )
        .catch(() => {});
    }

    const created = await db.select().from(projects).where(eq(projects.id, projectId)).limit(1);

    return NextResponse.json({
      success: true,
      project: created[0],
      summary: scanned.summary,
    });
  } catch (error: any) {
    console.error("Error importing repository:", error);
    return apiError(error, "Failed to import and scan repository.", 500);
  }
}
