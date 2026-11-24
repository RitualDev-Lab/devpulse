import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { projects } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth";
import { normalizeThemeId } from "@/lib/layout/css-scoper";
import { getEffectiveEntitlements } from "@/lib/billing/plans";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const { projectId, theme, customCss } = body;

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

    const normalizedTheme = normalizeThemeId(theme);
    const cleanCss = typeof customCss === "string" ? customCss.slice(0, 20000) : "";

    if (cleanCss.trim().length > 0) {
      const entitlements = getEffectiveEntitlements({ storageTier: user.storageTier });
      if (!entitlements.allowCustomCss) {
        return NextResponse.json(
          {
            error: "Custom CSS injection is a Developer Pro ($14/mo) & Team ($49/mo) feature. Preset themes remain free on all plans.",
            code: "CUSTOM_CSS_UPGRADE_REQUIRED",
          },
          { status: 402 }
        );
      }
    }

    await db
      .update(projects)
      .set({
        theme: normalizedTheme,
        customCss: cleanCss,
        updatedAt: new Date().toISOString(),
      })
      .where(and(eq(projects.id, projectId), eq(projects.userId, user.id)));

    return NextResponse.json({
      success: true,
      theme: normalizedTheme,
      customCss: cleanCss,
    });
  } catch (err: any) {
    console.error("POST /api/v1/projects/styling error:", err);
    return NextResponse.json(
      { error: "Failed to save styling preferences", details: err?.message },
      { status: 500 }
    );
  }
}
