import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { projects } from "@/db/schema";
import { and, eq, sql } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth";
import { sanitizeCustomCss, THEME_PRESETS } from "@/lib/styling/themes";

export const dynamic = "force-dynamic";

const ALLOWED_THEMES = new Set(THEME_PRESETS.map((t) => t.id));

export async function PATCH(req: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const projectId = String(body?.projectId || "");
    if (!projectId) {
      return NextResponse.json({ error: "Missing projectId" }, { status: 400 });
    }

    const [owned] = await db
      .select({ id: projects.id, theme: projects.theme, customCss: projects.customCss, isPublic: projects.isPublic })
      .from(projects)
      .where(and(eq(projects.id, projectId), eq(projects.userId, user.id)))
      .limit(1);

    if (!owned) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    const nextTheme =
      typeof body.theme === "string" && ALLOWED_THEMES.has(body.theme) ? body.theme : owned.theme;
    const nextCss =
      typeof body.customCss === "string" ? sanitizeCustomCss(body.customCss) : owned.customCss;
    const nextPublic =
      typeof body.isPublic === "boolean" ? body.isPublic : owned.isPublic;

    await db
      .update(projects)
      .set({
        theme: nextTheme,
        customCss: nextCss,
        isPublic: nextPublic,
        updatedAt: sql`(CURRENT_TIMESTAMP)`,
      })
      .where(and(eq(projects.id, projectId), eq(projects.userId, user.id)));

    return NextResponse.json({
      success: true,
      theme: nextTheme,
      customCss: nextCss,
      isPublic: nextPublic,
    });
  } catch (err: unknown) {
    console.error("Failed to save project appearance:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to save appearance" },
      { status: 500 }
    );
  }
}
