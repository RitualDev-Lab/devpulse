import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { projects, dashboardWidgets } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth";
import type { GridWidgetItem } from "@/lib/layout/grid-engine";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const projectId = req.nextUrl.searchParams.get("projectId");
    if (!projectId) {
      return NextResponse.json({ error: "Missing projectId" }, { status: 400 });
    }

    if (projectId !== "prj_ritual_core") {
      const user = await getCurrentUser();
      if (!user) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }
      const [proj] = await db
        .select({ id: projects.id })
        .from(projects)
        .where(and(eq(projects.id, projectId), eq(projects.userId, user.id)))
        .limit(1);

      if (!proj) {
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
    return NextResponse.json(
      { error: "Failed to fetch project layout", details: err?.message },
      { status: 500 }
    );
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

    const [proj] = await db
      .select({ id: projects.id })
      .from(projects)
      .where(and(eq(projects.id, projectId), eq(projects.userId, user.id)))
      .limit(1);

    if (!proj) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
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

    return NextResponse.json({
      success: true,
      savedCount: widgets.length,
    });
  } catch (err: any) {
    console.error("PUT /api/v1/projects/layout error:", err);
    return NextResponse.json(
      { error: "Failed to persist dashboard layout", details: err?.message },
      { status: 500 }
    );
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

    const [proj] = await db
      .select({ id: projects.id })
      .from(projects)
      .where(and(eq(projects.id, projectId), eq(projects.userId, user.id)))
      .limit(1);

    if (!proj) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    await db.delete(dashboardWidgets).where(eq(dashboardWidgets.projectId, projectId));
    return NextResponse.json({ success: true });
  } catch (err: any) {
    console.error("DELETE /api/v1/projects/layout error:", err);
    return NextResponse.json(
      { error: "Failed to reset layout", details: err?.message },
      { status: 500 }
    );
  }
}
