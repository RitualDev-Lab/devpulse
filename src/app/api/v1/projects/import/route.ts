import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { scanGitHubRepository } from "@/lib/scanner/github-scanner";
import { db } from "@/db";
import { projects, dashboardWidgets } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import crypto from "crypto";

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
    const { repo } = body;

    if (!repo || typeof repo !== "string" || !repo.trim()) {
      return NextResponse.json(
        { error: "Please provide a valid GitHub repository in 'owner/repo' format." },
        { status: 400 }
      );
    }

    // 1. Run GitHub Root Scanner
    const scanned = await scanGitHubRepository(repo.trim());

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
      return NextResponse.json({
        success: true,
        message: "Repository is already imported.",
        project: existing[0],
        summary: scanned.summary,
      });
    }

    // 3. Generate unique slug for user's project
    const baseSlug = scanned.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "project";

    let slug = baseSlug;
    let counter = 1;
    while (true) {
      const slugCheck = await db
        .select()
        .from(projects)
        .where(and(eq(projects.userId, user.id), eq(projects.slug, slug)))
        .limit(1);
      if (slugCheck.length === 0) break;
      slug = `${baseSlug}-${counter++}`;
    }

    const projectId = `prj_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
    const telemetryApiKey = `dp_live_${crypto.randomBytes(12).toString("hex")}`;

    // 4. Insert new Project row
    await db.insert(projects).values({
      id: projectId,
      userId: user.id,
      name: scanned.name,
      slug,
      description: scanned.description || `Developer mission control for ${scanned.githubRepo}`,
      githubRepo: scanned.githubRepo,
      npmPackage: scanned.detectedEcosystems.npmPackage || null,
      pypiPackage: scanned.detectedEcosystems.pypiPackage || null,
      rustCrate: scanned.detectedEcosystems.rustCrate || null,
      goModule: scanned.detectedEcosystems.goModule || null,
      dockerImage: scanned.detectedEcosystems.dockerImage || null,
      vscodeExtension: scanned.detectedEcosystems.vscodeExtension || null,
      mcpServerName: scanned.detectedEcosystems.mcpServerName || null,
      telemetryApiKey,
      isPublic: true,
      theme: "dark",
    });

    // 5. Seed initial widgets for drag-and-drop grid
    const initialWidgets = [
      { type: "github_stats", title: "GitHub Repository" },
      ...(scanned.detectedEcosystems.npmPackage ? [{ type: "npm_downloads", title: "npm Registry" }] : []),
      ...(scanned.detectedEcosystems.pypiPackage ? [{ type: "pypi_downloads", title: "PyPI Package" }] : []),
      ...(scanned.detectedEcosystems.rustCrate ? [{ type: "rust_crates", title: "Rust Crates.io" }] : []),
      ...(scanned.detectedEcosystems.dockerImage ? [{ type: "docker_container", title: "Docker Hub Container" }] : []),
      ...(scanned.detectedEcosystems.vscodeExtension ? [{ type: "vscode_installs", title: "VS Code Extension" }] : []),
      ...(scanned.detectedEcosystems.mcpServerName ? [{ type: "mcp_servers", title: "MCP Server Registry" }] : []),
      { type: "error_stream", title: "Crash & Error Stream" },
      { type: "web_analytics", title: "Cookie-Free Web Traffic" },
      { type: "revenue_stats", title: "Developer Revenue" },
      { type: "telemetry_setup", title: "SDK Integration" },
      { type: "bug_report_badge", title: "Public Bug Portal" },
    ];

    for (let i = 0; i < initialWidgets.length; i++) {
      const w = initialWidgets[i];
      await db.insert(dashboardWidgets).values({
        id: `wdg_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`,
        projectId,
        widgetType: w.type,
        title: w.title,
        positionX: (i % 3) * 4,
        positionY: Math.floor(i / 3) * 2,
        width: 1,
        height: 1,
        isVisible: true,
      });
    }

    const created = await db.select().from(projects).where(eq(projects.id, projectId)).limit(1);

    return NextResponse.json({
      success: true,
      project: created[0],
      summary: scanned.summary,
    });
  } catch (error: any) {
    console.error("Error importing repository:", error);
    return NextResponse.json(
      { error: error.message || "Failed to import and scan repository." },
      { status: 500 }
    );
  }
}
