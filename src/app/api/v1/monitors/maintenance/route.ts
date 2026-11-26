import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { projectConnectors } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth";
import { resolveProjectAccess } from "@/lib/security/rbac";
import { isPublicDemoProject } from "@/lib/security/demo-project";
import { listProjectMaintenanceWindows } from "@/lib/monitors/maintenance";
import { recordAuditEvent } from "@/lib/security/audit";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const projectId = req.nextUrl.searchParams.get("projectId") || "";
    if (!projectId) {
      return NextResponse.json({ error: "Missing projectId" }, { status: 400 });
    }

    if (!isPublicDemoProject(projectId)) {
      const user = await getCurrentUser();
      if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      const access = await resolveProjectAccess(projectId, user);
      if (!access) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const windows = await listProjectMaintenanceWindows(projectId);
    return NextResponse.json({ windows });
  } catch (err) {
    console.error("GET /api/v1/monitors/maintenance error:", err);
    return NextResponse.json({ error: "Failed to load maintenance windows" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await req.json();
    const projectId = String(body.projectId || "");
    const action = String(body.action || "create");
    if (!projectId) {
      return NextResponse.json({ error: "Missing projectId" }, { status: 400 });
    }

    const access = await resolveProjectAccess(projectId, user);
    if (!access || !access.canWrite) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    if (action === "delete") {
      const id = String(body.id || "");
      await db
        .delete(projectConnectors)
        .where(
          and(
            eq(projectConnectors.id, id),
            eq(projectConnectors.projectId, projectId),
            eq(projectConnectors.provider, "maintenance_window")
          )
        );
      return NextResponse.json({ success: true });
    }

    const title = String(body.title || "").trim().slice(0, 100);
    const reason = body.reason ? String(body.reason).trim().slice(0, 240) : null;
    const startsAt = new Date(String(body.startsAt || "")).toISOString();
    const endsAt = new Date(String(body.endsAt || "")).toISOString();
    const suppressAlerts = body.suppressAlerts !== false;

    if (!title || Number.isNaN(Date.parse(startsAt)) || Number.isNaN(Date.parse(endsAt))) {
      return NextResponse.json({ error: "Valid title, startsAt, and endsAt are required" }, { status: 400 });
    }
    if (Date.parse(endsAt) <= Date.parse(startsAt)) {
      return NextResponse.json({ error: "endsAt must be after startsAt" }, { status: 400 });
    }

    const id = `mnt_${crypto.randomUUID().replace(/-/g, "").slice(0, 14)}`;
    await db.insert(projectConnectors).values({
      id,
      projectId,
      category: "telemetry",
      provider: "maintenance_window",
      label: title,
      identifier: `mw_${Date.now()}`,
      metadataJson: JSON.stringify({
        reason,
        startsAt,
        endsAt,
        suppressAlerts,
      }),
    });

    await recordAuditEvent({
      userId: user.id,
      actorUsername: user.githubUsername,
      organizationId: access.project.organizationId,
      workspaceId: access.project.workspaceId,
      projectId,
      action: "maintenance.window_scheduled",
      resourceType: "maintenance_window",
      resourceId: id,
      headers: req.headers,
      metadata: { title, startsAt, endsAt, suppressAlerts },
    });

    return NextResponse.json({ success: true, id }, { status: 201 });
  } catch (err) {
    console.error("POST /api/v1/monitors/maintenance error:", err);
    return NextResponse.json({ error: "Failed to save maintenance window" }, { status: 500 });
  }
}
