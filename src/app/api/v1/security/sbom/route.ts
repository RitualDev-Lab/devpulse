import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { projectConnectors, projects } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth";
import { resolveProjectAccess } from "@/lib/security/rbac";
import { isPublicDemoProject } from "@/lib/security/demo-project";
import { readProjectSnapshots } from "@/lib/dashboard/snapshots";
import { buildFixSuggestionUrl, buildProjectSbomReport } from "@/lib/security/sbom";
import { getUserGitHubAccessToken } from "@/lib/security/github-ownership";
import { decryptSecret } from "@/lib/security/crypto";
import { recordAuditEvent } from "@/lib/security/audit";
import { resolveProjectGitConfig } from "@/lib/integrations/git-provider";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const projectId = req.nextUrl.searchParams.get("projectId") || "";
    if (!projectId) {
      return NextResponse.json({ error: "Missing projectId" }, { status: 400 });
    }

    let proj: typeof projects.$inferSelect | undefined;
    if (isPublicDemoProject(projectId)) {
      const [demoRow] = await db
        .select()
        .from(projects)
        .where(eq(projects.id, projectId))
        .limit(1);
      proj = demoRow;
    } else {
      const user = await getCurrentUser();
      if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      const access = await resolveProjectAccess(projectId, user);
      if (!access) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      proj = access.project;
    }

    if (!proj) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    const snap = await readProjectSnapshots(proj.id);
    const report = await buildProjectSbomReport({
      project: {
        npmPackage: proj.npmPackage,
        pypiPackage: proj.pypiPackage,
        rustCrate: proj.rustCrate,
        goModule: proj.goModule,
      },
      npmStats: snap.npmStats,
      pypiStats: snap.pypiStats,
      rustStats: snap.rustStats,
      goStats: snap.goStats,
      packageSecurity: snap.packageSecurity,
      extraPackages: snap.extraPackages,
    });

    const enrichedPackages = report.packages.map((pkg) => ({
      ...pkg,
      vulnerabilities: pkg.vulnerabilities.map((v) => ({
        ...v,
        fixIssueUrl: buildFixSuggestionUrl({
          githubRepo: proj!.githubRepo,
          packageName: pkg.packageName,
          ecosystem: pkg.ecosystem,
          fixedVersion: v.fixedVersion,
          advisoryId: v.id,
        }),
      })),
    }));

    return NextResponse.json({
      ...report,
      packages: enrichedPackages,
      githubRepo: proj.githubRepo,
    });
  } catch (err) {
    console.error("GET /api/v1/security/sbom error:", err);
    return NextResponse.json({ error: "Failed to build SBOM vulnerability inventory" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await req.json();
    const projectId = String(body.projectId || "");
    const packageName = String(body.packageName || "").trim();
    const ecosystem = String(body.ecosystem || "npm").trim();
    const advisoryId = String(body.advisoryId || "OSV-ADVISORY").trim();
    const fixedVersion = body.fixedVersion ? String(body.fixedVersion).trim() : null;

    if (!projectId || !packageName) {
      return NextResponse.json({ error: "projectId and packageName are required" }, { status: 400 });
    }

    const access = await resolveProjectAccess(projectId, user);
    if (!access || !access.canWrite) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const proj = access.project;
    const fallbackUrl = buildFixSuggestionUrl({
      githubRepo: proj.githubRepo,
      packageName,
      ecosystem,
      fixedVersion,
      advisoryId,
    });

    const gitConnectors = await db
      .select({
        category: projectConnectors.category,
        provider: projectConnectors.provider,
        identifier: projectConnectors.identifier,
        targetUrl: projectConnectors.targetUrl,
        credentialsEncrypted: projectConnectors.credentialsEncrypted,
      })
      .from(projectConnectors)
      .where(and(eq(projectConnectors.projectId, proj.id), eq(projectConnectors.category, "git")));

    const gitCfg = resolveProjectGitConfig({
      githubRepo: proj.githubRepo,
      connectors: gitConnectors,
    });

    if (!gitCfg || gitCfg.provider !== "github") {
      return NextResponse.json({
        mode: "manual_url",
        issueUrl: fallbackUrl,
        message: "Attach a GitHub repository with write access to open automated security issues/PRs.",
      });
    }

    const token =
      (proj.githubTokenEncrypted
        ? await decryptSecret(proj.githubTokenEncrypted).catch(() => null)
        : null) || (await getUserGitHubAccessToken(user.id));

    if (!token) {
      return NextResponse.json({
        mode: "manual_url",
        issueUrl: fallbackUrl,
        message: "No GitHub token with write access found; open pre-filled GitHub issue instead.",
      });
    }

    const ghRes = await fetch(`https://api.github.com/repos/${gitCfg.repoSlug}/issues`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "User-Agent": "DevPulse-SBOM-Bot",
      },
      body: JSON.stringify({
        title: `chore(security): upgrade ${packageName} (${ecosystem}) for ${advisoryId}`,
        body: [
          `Automated **DevPulse SBOM & Security Center** remediation request:`,
          "",
          `- **Package:** \`${packageName}\` (${ecosystem})`,
          `- **Advisory:** \`${advisoryId}\``,
          fixedVersion ? `- **Target Fixed Version:** \`${fixedVersion}\`` : `- **Target Fixed Version:** Check advisory guidance`,
          `- **Reference:** https://osv.dev/vulnerability/${encodeURIComponent(advisoryId)}`,
        ].join("\n"),
      }),
    });

    const ghData = (await ghRes.json().catch(() => ({}))) as { html_url?: string; number?: number };
    await recordAuditEvent({
      userId: user.id,
      actorUsername: user.githubUsername,
      organizationId: proj.organizationId,
      workspaceId: proj.workspaceId,
      projectId: proj.id,
      action: "security.fix_pr_opened",
      resourceType: "sbom_advisory",
      resourceId: `${packageName}:${advisoryId}`,
      headers: req.headers,
      metadata: { ecosystem, fixedVersion, githubIssueUrl: ghData.html_url || null },
    });

    if (!ghRes.ok) {
      return NextResponse.json({
        mode: "manual_url",
        issueUrl: fallbackUrl,
        message: "GitHub token lacked write scope; use pre-filled fix issue URL instead.",
      });
    }

    return NextResponse.json({
      mode: "created",
      issueUrl: ghData.html_url,
      issueNumber: ghData.number,
    });
  } catch (err) {
    console.error("POST /api/v1/security/sbom error:", err);
    return NextResponse.json({ error: "Failed to trigger security fix action" }, { status: 500 });
  }
}
