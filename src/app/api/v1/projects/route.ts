import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/db";
import { dashboardWidgets, projects, uptimeMonitors } from "@/db/schema";
import { eq, desc, sql } from "drizzle-orm";
import crypto from "crypto";
import { getEffectiveEntitlements } from "@/lib/billing/plans";
import { listAccessibleProjects } from "@/lib/security/rbac";
import { ensurePrimaryKeyHashRecorded } from "@/lib/security/api-keys";
import { recordAuditEvent } from "@/lib/security/audit";
import { verifyGitHubRepoOwnership } from "@/lib/security/github-ownership";
import { encryptSecret } from "@/lib/security/crypto";
import { normalizeStackPreset, STACK_PRESETS } from "@/lib/dashboard/presets";
import { buildDefaultLayout } from "@/lib/layout/grid-engine";
import { isValidPublicMonitorUrl } from "@/lib/monitors/checker";

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
    const {
      name,
      description,
      githubRepo,
      githubToken,
      npmPackage,
      pypiPackage,
      rustCrate,
      goModule,
      dockerImage,
      vscodeExtension,
      mcpServerName,
      stackPreset: rawPreset,
      websiteUrl,
    } = body;

    if (!name || typeof name !== "string" || !name.trim()) {
      return NextResponse.json({ error: "Project name is required" }, { status: 400 });
    }

    const explicitPat =
      typeof githubToken === "string" && githubToken.trim() ? githubToken.trim() : null;

    let verifiedGithubRepo: string | null = null;
    if (githubRepo && typeof githubRepo === "string" && githubRepo.trim()) {
      const ownership = await verifyGitHubRepoOwnership(user, githubRepo, explicitPat);
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
    const stackPreset = normalizeStackPreset(rawPreset);
    const encryptedPat = explicitPat ? await encryptSecret(explicitPat).catch(() => null) : null;

    const cleanOpt = (v: unknown) =>
      typeof v === "string" && v.trim() ? v.trim().slice(0, 200) : null;

    await db.insert(projects).values({
      id: projectId,
      userId: user.id,
      name: name.trim().slice(0, 80),
      slug,
      description: cleanOpt(description),
      githubRepo: verifiedGithubRepo,
      githubTokenEncrypted: encryptedPat,
      npmPackage: cleanOpt(npmPackage),
      pypiPackage: cleanOpt(pypiPackage),
      rustCrate: cleanOpt(rustCrate),
      goModule: cleanOpt(goModule),
      dockerImage: cleanOpt(dockerImage),
      vscodeExtension: cleanOpt(vscodeExtension),
      mcpServerName: cleanOpt(mcpServerName),
      stackPreset,
      telemetryApiKey,
      publicWriteKey,
      isPublic: true,
      theme: "dark",
    });

    // Seed smart 2D dashboard widgets matching standalone packages / web / OCI apps
    const presetDefs = STACK_PRESETS[stackPreset].recommendedWidgets;
    const widgetMap = new Map<
      string,
      { id: string; title: string; defaultW: number; defaultH: number }
    >();
    const chosenEcosystems = [
      ...(verifiedGithubRepo ? [{ id: "github_stats", title: "GitHub Repository", defaultW: 4, defaultH: 1 }] : []),
      ...(cleanOpt(npmPackage) ? [{ id: "npm_downloads", title: "npm Registry", defaultW: 4, defaultH: 1 }] : []),
      ...(cleanOpt(pypiPackage) ? [{ id: "pypi_downloads", title: "PyPI Package", defaultW: 4, defaultH: 1 }] : []),
      ...(cleanOpt(rustCrate) ? [{ id: "rust_crates", title: "Rust Crates.io", defaultW: 4, defaultH: 1 }] : []),
      ...(cleanOpt(dockerImage) ? [{ id: "docker_container", title: "Docker Hub Container", defaultW: 4, defaultH: 1 }] : []),
      ...(cleanOpt(vscodeExtension) ? [{ id: "vscode_stats", title: "VS Code Extension", defaultW: 4, defaultH: 1 }] : []),
      ...(cleanOpt(mcpServerName) ? [{ id: "mcp_stats", title: "MCP Server Registry", defaultW: 4, defaultH: 1 }] : []),
    ];
    for (const def of [...chosenEcosystems, ...presetDefs]) {
      // Omit unrelated github/npm preset defaults when creating a standalone workspace without them
      if (!verifiedGithubRepo && def.id === "github_stats") continue;
      if (!cleanOpt(npmPackage) && def.id === "npm_downloads") continue;
      if (!widgetMap.has(def.id)) widgetMap.set(def.id, def);
    }
    if (!widgetMap.has("telemetry_setup")) {
      widgetMap.set("telemetry_setup", { id: "telemetry_setup", title: "SDK Integration", defaultW: 4, defaultH: 1 });
    }
    if (!widgetMap.has("bug_report_badge")) {
      widgetMap.set("bug_report_badge", { id: "bug_report_badge", title: "Public Bug Portal", defaultW: 4, defaultH: 1 });
    }
    const layoutItems = buildDefaultLayout(Array.from(widgetMap.values()));
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

    // Optional website / OCI / VPS health monitor created inline
    if (typeof websiteUrl === "string" && websiteUrl.trim()) {
      const check = isValidPublicMonitorUrl(websiteUrl.trim());
      if (check.valid && check.normalized) {
        await db.insert(uptimeMonitors).values({
          id: `mon_${crypto.randomUUID().replace(/-/g, "").slice(0, 14)}`,
          projectId,
          name: `${name.trim()} Endpoint`,
          url: check.normalized,
          method: "GET",
          expectedStatus: 200,
          intervalMinutes: 5,
          isActive: true,
        }).catch(() => {});
      }
    }

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
