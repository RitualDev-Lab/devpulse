import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { projects } from "@/db/schema";
import { eq } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth";
import { resolveProjectAccess } from "@/lib/security/rbac";
import { readProjectSnapshots, refreshProjectSnapshots } from "@/lib/dashboard/snapshots";

export const dynamic = "force-dynamic";

/**
 * GET /api/v1/projects/snapshots?projectId=...
 * Returns Turso-backed widget snapshots; if stale (>5m) or `?refresh=1`, refreshes from
 * upstream providers cleanly in the background request and updates `project_snapshots`.
 */
export async function GET(req: NextRequest) {
  try {
    const projectId = req.nextUrl.searchParams.get("projectId");
    const forceRefresh = req.nextUrl.searchParams.get("refresh") === "1";

    if (!projectId) {
      return NextResponse.json({ error: "Missing projectId" }, { status: 400 });
    }

    let projectRow: typeof projects.$inferSelect | undefined;
    let userIdForOAuth: string | null = null;

    if (projectId === "prj_ritual_core") {
      const [demoRow] = await db
        .select()
        .from(projects)
        .where(eq(projects.id, "prj_ritual_core"))
        .limit(1);
      projectRow = demoRow;
    } else {
      const user = await getCurrentUser();
      if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      const access = await resolveProjectAccess(projectId, user);
      if (!access || !access.canRead) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
      projectRow = access.project;
      userIdForOAuth = user.id;
    }

    if (!projectRow) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    const existing = await readProjectSnapshots(projectRow.id);
    if (!forceRefresh && !existing.isStale && existing.presentKeys.size > 0) {
      return NextResponse.json({
        githubStats: existing.githubStats,
        npmStats: existing.npmStats,
        pypiStats: existing.pypiStats,
        rustStats: existing.rustStats,
        goStats: existing.goStats,
        dockerStats: existing.dockerStats,
        vscodeStats: existing.vscodeStats,
        mcpStats: existing.mcpStats,
        revenueStats: existing.revenueStats,
        snapshotUpdatedAt: existing.snapshotUpdatedAt,
        refreshed: false,
      });
    }

    const fresh = await refreshProjectSnapshots(projectRow, { userIdForOAuth });
    return NextResponse.json({
      githubStats: fresh.githubStats,
      npmStats: fresh.npmStats,
      pypiStats: fresh.pypiStats,
      rustStats: fresh.rustStats,
      goStats: fresh.goStats,
      dockerStats: fresh.dockerStats,
      vscodeStats: fresh.vscodeStats,
      mcpStats: fresh.mcpStats,
      revenueStats: fresh.revenueStats,
      snapshotUpdatedAt: fresh.snapshotUpdatedAt,
      refreshed: true,
    });
  } catch (err: any) {
    console.error("GET /api/v1/projects/snapshots error:", err);
    return NextResponse.json(
      { error: "Failed to refresh snapshots", details: err?.message },
      { status: 500 }
    );
  }
}
