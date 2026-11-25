import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { dashboardWidgets } from "@/db/schema";
import { eq } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth";
import type { GridWidgetItem } from "@/lib/layout/grid-engine";
import { resolveProjectAccess } from "@/lib/security/rbac";
import { recordAuditEvent } from "@/lib/security/audit";
import { isPublicDemoProject } from "@/lib/security/demo-project";
import { apiError } from "@/lib/security/api-error";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const projectId = req.nextUrl.searchParams.get("projectId");
    if (!projectId) {
      return NextResponse.json({ error: "Missing projectId" }, { status: 400 });
    }

    if (!isPublicDemoProject(projectId)) {
      const user = await getCurrentUser();
      if (!user) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }
      const access = await resolveProjectAccess(projectId, user);
      if (!access) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
    }

    const rows = await db
      .select()
      .from(dashboardWidgets)
      .where(eq(dashboardWidgets.projectId, projectId));

    const widgets: GridWidgetItem[] = rows.map((r) => ({
      id: r.widgetType,
      title: r.title,
      x: r.positionX,
      y: r.positionY,
      w: r.width,
      h: r.height,
      isVisible: r.isVisible,
    }));

    return NextResponse.json({ widgets });
  } catch (err: any) {
    console.error("GET /api/v1/projects/layout error:", err);
    return apiError(err, "Failed to fetch project layout", 500);
  }
}

async function saveLayout(req: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const { projectId, widgets } = body as { projectId?: string; widgets?: GridWidgetItem[] };

    if (!projectId || !Array.isArray(widgets)) {
      return NextResponse.json({ error: "Missing projectId or widgets array" }, { status: 400 });
    }

    const access = await resolveProjectAccess(projectId, user);
    if (!access || !access.canWrite) {
      await recordAuditEvent({
        userId: user.id,
        actorUsername: user.githubUsername,
        projectId,
        action: "layout.updated",
        resourceType: "dashboard_layout",
        resourceId: projectId,
        status: "denied",
        headers: req.headers,
        metadata: { role: access?.role || "none" },
      });
      return NextResponse.json({ error: "Forbidden: Viewer role cannot edit layout." }, { status: 403 });
    }

    // Replace widgets atomically for this project
    await db.delete(dashboardWidgets).where(eq(dashboardWidgets.projectId, projectId));

    if (widgets.length > 0) {
      const rowsToInsert = widgets.map((w) => ({
        id: `w_${projectId}_${String(w.id).replace(/[^a-zA-Z0-9_-]/g, "")}`.slice(0, 128),
        projectId,
        widgetType: String(w.id).slice(0, 64),
        title: String(w.title || w.id).slice(0, 128),
        positionX: Math.max(0, Math.min(11, Math.round(Number(w.x) || 0))),
        positionY: Math.max(0, Math.round(Number(w.y) || 0)),
        width: Math.max(1, Math.min(12, Math.round(Number(w.w) || 4))),
        height: Math.max(1, Math.min(4, Math.round(Number(w.h) || 1))),
        isVisible: w.isVisible !== false,
      }));

      await db.insert(dashboardWidgets).values(rowsToInsert);
    }

    await recordAuditEvent({
      userId: user.id,
      actorUsername: user.githubUsername,
      organizationId: access.project.organizationId,
      projectId,
      action: "layout.updated",
      resourceType: "dashboard_layout",
      resourceId: projectId,
      headers: req.headers,
      metadata: { savedCount: widgets.length },
    });

    return NextResponse.json({
      success: true,
      savedCount: widgets.length,
    });
  } catch (err: any) {
    console.error("PUT /api/v1/projects/layout error:", err);
    return apiError(err, "Failed to persist dashboard layout", 500);
  }
}

export async function PUT(req: NextRequest) {
  return saveLayout(req);
}

export async function POST(req: NextRequest) {
  return saveLayout(req);
}

export async function DELETE(req: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const projectId = req.nextUrl.searchParams.get("projectId");
    if (!projectId) {
      return NextResponse.json({ error: "Missing projectId" }, { status: 400 });
    }

    const access = await resolveProjectAccess(projectId, user);
    if (!access || !access.canWrite) {
      await recordAuditEvent({
        userId: user.id,
        actorUsername: user.githubUsername,
        projectId,
        action: "layout.reset",
        resourceType: "dashboard_layout",
        resourceId: projectId,
        status: "denied",
        headers: req.headers,
        metadata: { role: access?.role || "none" },
      });
      return NextResponse.json({ error: "Forbidden: Viewer role cannot edit layout." }, { status: 403 });
    }

    await db.delete(dashboardWidgets).where(eq(dashboardWidgets.projectId, projectId));
    await recordAuditEvent({
      userId: user.id,
      actorUsername: user.githubUsername,
      organizationId: access.project.organizationId,
      projectId,
      action: "layout.reset",
      resourceType: "dashboard_layout",
      resourceId: projectId,
      headers: req.headers,
    });
    return NextResponse.json({ success: true });
  } catch (err: any) {
    console.error("DELETE /api/v1/projects/layout error:", err);
    return apiError(err, "Failed to reset layout", 500);
  }
}
