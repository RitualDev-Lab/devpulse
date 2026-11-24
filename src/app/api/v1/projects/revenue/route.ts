import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { projects } from "@/db/schema";
import { eq } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth";
import { resolveProjectAccess } from "@/lib/security/rbac";
import { recordAuditEvent } from "@/lib/security/audit";

export async function POST(req: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const {
      projectId,
      stripeApiKey,
      dodoPaymentsApiKey,
      dodoPaymentsEnvironment,
      githubSponsorsUsername,
    } = body;

    if (!projectId) {
      return NextResponse.json({ error: "Missing projectId" }, { status: 400 });
    }

    const access = await resolveProjectAccess(String(projectId), user);
    if (!access || !access.canManageSecurity) {
      await recordAuditEvent({
        userId: user.id,
        actorUsername: user.githubUsername,
        projectId: String(projectId),
        action: "revenue.keys_updated",
        resourceType: "project",
        resourceId: String(projectId),
        status: "denied",
        headers: req.headers,
        metadata: { role: access?.role || "none" },
      });
      return NextResponse.json(
        { error: "Forbidden: Only Workspace Owners can manage payment provider keys." },
        { status: 403 }
      );
    }

    // Update project revenue keys in Turso database
    await db
      .update(projects)
      .set({
        stripeApiKey: stripeApiKey ? stripeApiKey.trim() : null,
        dodoPaymentsApiKey: dodoPaymentsApiKey ? dodoPaymentsApiKey.trim() : null,
        dodoPaymentsEnvironment: dodoPaymentsEnvironment || "live",
        githubSponsorsUsername: githubSponsorsUsername ? githubSponsorsUsername.trim() : null,
      })
      .where(eq(projects.id, projectId));

    await recordAuditEvent({
      userId: user.id,
      actorUsername: user.githubUsername,
      organizationId: access.project.organizationId,
      projectId: access.project.id,
      action: "revenue.keys_updated",
      resourceType: "project",
      resourceId: access.project.id,
      headers: req.headers,
      metadata: {
        hasStripe: Boolean(stripeApiKey),
        hasDodo: Boolean(dodoPaymentsApiKey),
        dodoPaymentsEnvironment: dodoPaymentsEnvironment || "live",
      },
    });

    return NextResponse.json({
      success: true,
      message: "Revenue and payment provider credentials saved successfully.",
    });
  } catch (err: any) {
    console.error("Error saving revenue settings:", err);
    return NextResponse.json(
      { error: err.message || "Failed to save revenue settings" },
      { status: 500 }
    );
  }
}
