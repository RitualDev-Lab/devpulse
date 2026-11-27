import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import {
  auditLogs,
  deployments,
  errorEvents,
  pageviews,
  projectReleases,
  structuredLogs,
} from "@/db/schema";
import { desc, eq } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth";
import { resolveProjectAccess } from "@/lib/security/rbac";
import { recordAuditEvent } from "@/lib/security/audit";

export const dynamic = "force-dynamic";

/**
 * DPDP Act 2023 & GDPR Article 32 Data Portability Endpoint
 * Exports structured project telemetry and configuration metadata as JSON.
 */
export async function GET(req: NextRequest) {
  const projectId = req.nextUrl.searchParams.get("projectId")?.trim();
  if (!projectId) {
    return NextResponse.json({ error: "projectId query parameter is required" }, { status: 400 });
  }

  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const access = await resolveProjectAccess(projectId, user);
  if (!access || (access.role !== "owner" && access.role !== "admin")) {
    return NextResponse.json({ error: "Forbidden: owner or admin role required" }, { status: 403 });
  }

  const [crashes, events, deploys, releases, logs, audits] = await Promise.all([
    db.select().from(errorEvents).where(eq(errorEvents.projectId, projectId)).orderBy(desc(errorEvents.createdAt)).limit(500),
    db.select().from(pageviews).where(eq(pageviews.projectId, projectId)).orderBy(desc(pageviews.createdAt)).limit(500),
    db.select().from(deployments).where(eq(deployments.projectId, projectId)).orderBy(desc(deployments.createdAt)).limit(200),
    db.select().from(projectReleases).where(eq(projectReleases.projectId, projectId)).orderBy(desc(projectReleases.releasedAt)).limit(200),
    db.select().from(structuredLogs).where(eq(structuredLogs.projectId, projectId)).orderBy(desc(structuredLogs.timestampMs)).limit(500),
    db.select().from(auditLogs).where(eq(auditLogs.projectId, projectId)).orderBy(desc(auditLogs.createdAt)).limit(200),
  ]);

  await recordAuditEvent({
    userId: user.id,
    actorUsername: user.githubUsername,
    organizationId: access.project.organizationId,
    projectId,
    action: "privacy.data_exported",
    resourceType: "project",
    resourceId: projectId,
    headers: req.headers,
  });

  return new NextResponse(
    JSON.stringify(
      {
        exportedAt: new Date().toISOString(),
        complianceFramework: ["DPDP-2023", "GDPR-Art-20"],
        project: {
          id: access.project.id,
          name: access.project.name,
          slug: access.project.slug,
          githubRepo: access.project.githubRepo,
        },
        crashes,
        pageviews: events,
        deployments: deploys,
        releases,
        logs,
        auditLogs: audits,
      },
      null,
      2
    ),
    {
      status: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="devpulse-export-${access.project.slug}.json"`,
        "Cache-Control": "no-store",
      },
    }
  );
}

/**
 * Self-Serve Right-to-Erasure Telemetry Purge (Owner only).
 * Deletes mutable project telemetry (crashes, pageviews, logs) while retaining immutable audit_logs.
 */
export async function DELETE(req: NextRequest) {
  const projectId = req.nextUrl.searchParams.get("projectId")?.trim();
  const confirm = req.nextUrl.searchParams.get("confirm")?.trim();

  if (!projectId || confirm !== "ERASE_TELEMETRY") {
    return NextResponse.json(
      { error: "projectId and confirm=ERASE_TELEMETRY are required" },
      { status: 400 }
    );
  }

  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const access = await resolveProjectAccess(projectId, user);
  if (!access || access.role !== "owner") {
    return NextResponse.json({ error: "Forbidden: owner role required for erasure" }, { status: 403 });
  }

  await Promise.all([
    db.delete(errorEvents).where(eq(errorEvents.projectId, projectId)),
    db.delete(pageviews).where(eq(pageviews.projectId, projectId)),
    db.delete(structuredLogs).where(eq(structuredLogs.projectId, projectId)),
  ]);

  await recordAuditEvent({
    userId: user.id,
    actorUsername: user.githubUsername,
    organizationId: access.project.organizationId,
    projectId,
    action: "privacy.telemetry_erased",
    resourceType: "project",
    resourceId: projectId,
    headers: req.headers,
  });

  return NextResponse.json({ erased: true, projectId, auditPreserved: true });
}
