import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { projects } from "@/db/schema";
import { eq } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth";
import { normalizeThemeId } from "@/lib/layout/css-scoper";
import { getEffectiveEntitlements } from "@/lib/billing/plans";
import { resolveProjectAccess } from "@/lib/security/rbac";
import { recordAuditEvent } from "@/lib/security/audit";
import { apiError } from "@/lib/security/api-error";

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

    const access = await resolveProjectAccess(String(projectId), user);
    if (!access || !access.canWrite) {
      await recordAuditEvent({
        userId: user.id,
        actorUsername: user.githubUsername,
        projectId: String(projectId),
        action: "styling.updated",
        resourceType: "project",
        resourceId: String(projectId),
        status: "denied",
        headers: req.headers,
        metadata: { role: access?.role || "none" },
      });
      return NextResponse.json({ error: "Forbidden: Viewer role cannot edit styling." }, { status: 403 });
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
      .where(eq(projects.id, projectId));

    await recordAuditEvent({
      userId: user.id,
      actorUsername: user.githubUsername,
      organizationId: access.project.organizationId,
      projectId: access.project.id,
      action: "styling.updated",
      resourceType: "project",
      resourceId: access.project.id,
      headers: req.headers,
      metadata: { theme: normalizedTheme, hasCustomCss: Boolean(cleanCss.trim()) },
    });

    return NextResponse.json({
      success: true,
      theme: normalizedTheme,
      customCss: cleanCss,
    });
  } catch (err: any) {
    console.error("POST /api/v1/projects/styling error:", err);
    return apiError(err, "Failed to save styling preferences", 500);
  }
}
