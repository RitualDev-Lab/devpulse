import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { dashboardWidgets, projects } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth";
import crypto from "crypto";

export const dynamic = "force-dynamic";

export interface WidgetLayoutItem {
  widgetType: string;
  title?: string;
  x: number;
  y: number;
  w: number;
  h: number;
  isVisible: boolean;
}

const VALID_WIDTHS = new Set([3, 4, 6, 8, 9, 12]);

function normalizeWidth(rawWidth: number): number {
  if (rawWidth === 1) return 4;
  if (rawWidth === 2) return 8;
  if (rawWidth === 3) return 12;
  if (VALID_WIDTHS.has(rawWidth)) return rawWidth;
  return Math.max(3, Math.min(12, Math.round(rawWidth || 4)));
}

export async function GET(req: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const projectId = req.nextUrl.searchParams.get("projectId");
    if (!projectId) {
      return NextResponse.json({ error: "Missing projectId" }, { status: 400 });
    }

    const [owned] = await db
      .select({ id: projects.id })
      .from(projects)
      .where(and(eq(projects.id, projectId), eq(projects.userId, user.id)))
      .limit(1);

    if (!owned) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    const rows = await db
      .select()
      .from(dashboardWidgets)
      .where(eq(dashboardWidgets.projectId, projectId));

    const layout: WidgetLayoutItem[] = rows.map((r) => ({
      widgetType: r.widgetType,
      title: r.title,
      x: r.positionX,
      y: r.positionY,
      w: normalizeWidth(r.width),
      h: Math.max(1, Math.min(4, r.height || 1)),
      isVisible: r.isVisible,
    }));

    return NextResponse.json({ success: true, layout });
  } catch (err: unknown) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to fetch layout" },
      { status: 500 }
    );
  }
}

export async function PUT(req: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const projectId = String(body?.projectId || "");
    const widgets: WidgetLayoutItem[] = Array.isArray(body?.widgets) ? body.widgets : [];

    if (!projectId) {
      return NextResponse.json({ error: "Missing projectId" }, { status: 400 });
    }

    const [owned] = await db
      .select({ id: projects.id })
      .from(projects)
      .where(and(eq(projects.id, projectId), eq(projects.userId, user.id)))
      .limit(1);

    if (!owned) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    // Replace widget layout rows atomically for this project
    await db.delete(dashboardWidgets).where(eq(dashboardWidgets.projectId, projectId));

    for (let idx = 0; idx < widgets.length; idx++) {
      const item = widgets[idx];
      if (!item?.widgetType) continue;
      await db.insert(dashboardWidgets).values({
        id: `wdg_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`,
        projectId,
        widgetType: String(item.widgetType).slice(0, 64),
        title: String(item.title || item.widgetType).slice(0, 80),
        positionX: Math.max(0, Math.min(11, Number(item.x) || 0)),
        positionY: Math.max(0, Number(item.y) || idx),
        width: normalizeWidth(Number(item.w) || 4),
        height: Math.max(1, Math.min(4, Number(item.h) || 1)),
        isVisible: item.isVisible !== false,
      });
    }

    return NextResponse.json({ success: true, count: widgets.length });
  } catch (err: unknown) {
    console.error("Failed to save dashboard layout:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to save layout" },
      { status: 500 }
    );
  }
}
