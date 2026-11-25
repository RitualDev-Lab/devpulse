import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/db";
import { auditLogs } from "@/db/schema";
import { eq, desc, or, inArray } from "drizzle-orm";
import { resolveProjectAccess, listAccessibleProjects } from "@/lib/security/rbac";
import { recordAuditEvent } from "@/lib/security/audit";
import { resolveUserStorageContext } from "@/lib/storage/quota";
import { createPresignedUrl, putR2Object } from "@/lib/storage/r2";

export const dynamic = "force-dynamic";

function escapeCsv(val: unknown): string {
  const s = String(val ?? "");
  if (s.includes(",") || s.includes('"') || s.includes("\n") || s.includes("\r")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function logsToCsv(logs: Array<typeof auditLogs.$inferSelect>): string {
  const header = [
    "id",
    "createdAt",
    "actorUsername",
    "userId",
    "organizationId",
    "workspaceId",
    "projectId",
    "action",
    "resourceType",
    "resourceId",
    "status",
    "ipAddress",
    "userAgent",
    "metadataJson",
  ].join(",");

  const rows = logs.map((l) =>
    [
      l.id,
      l.createdAt,
      l.actorUsername,
      l.userId,
      l.organizationId || "",
      l.workspaceId || "",
      l.projectId || "",
      l.action,
      l.resourceType,
      l.resourceId || "",
      l.status,
      l.ipAddress || "",
      l.userAgent || "",
      l.metadataJson || "",
    ]
      .map(escapeCsv)
      .join(",")
  );

  return [header, ...rows].join("\r\n");
}

async function queryScopedAuditLogs(
  user: NonNullable<Awaited<ReturnType<typeof getCurrentUser>>>,
  projectId: string | null,
  limit = 100
) {
  if (projectId) {
    const access = await resolveProjectAccess(projectId, user);
    if (!access) return { forbidden: true as const, logs: [] };
    const logs = await db
      .select()
      .from(auditLogs)
      .where(
        access.project.organizationId
          ? or(
              eq(auditLogs.projectId, projectId),
              eq(auditLogs.organizationId, access.project.organizationId),
              eq(auditLogs.userId, user.id)
            )
          : or(eq(auditLogs.projectId, projectId), eq(auditLogs.userId, user.id))
      )
      .orderBy(desc(auditLogs.createdAt))
      .limit(limit);
    return { forbidden: false as const, logs, organizationId: access.project.organizationId };
  }

  const accessible = await listAccessibleProjects(user);
  const accessibleIds = accessible.map((p) => p.id);
  const logs =
    accessibleIds.length > 0
      ? await db
          .select()
          .from(auditLogs)
          .where(or(eq(auditLogs.userId, user.id), inArray(auditLogs.projectId, accessibleIds)))
          .orderBy(desc(auditLogs.createdAt))
          .limit(limit)
      : await db
          .select()
          .from(auditLogs)
          .where(eq(auditLogs.userId, user.id))
          .orderBy(desc(auditLogs.createdAt))
          .limit(limit);

  return { forbidden: false as const, logs, organizationId: null };
}

export async function GET(req: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const projectId = req.nextUrl.searchParams.get("projectId");
    const format = req.nextUrl.searchParams.get("format");
    const limit = format === "csv" ? 500 : 100;

    const scoped = await queryScopedAuditLogs(user, projectId, limit);
    if (scoped.forbidden) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    if (format === "csv") {
      const csv = logsToCsv(scoped.logs);
      const stamp = new Date().toISOString().slice(0, 10);
      return new NextResponse(csv, {
        status: 200,
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="devpulse-soc2-audit-${stamp}.csv"`,
          "Cache-Control": "no-store",
        },
      });
    }

    return NextResponse.json({ logs: scoped.logs });
  } catch (err) {
    console.error("GET /api/v1/security/audit error:", err);
    return NextResponse.json({ error: "Failed to load audit log" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const projectId = body.projectId ? String(body.projectId) : null;
    const action = String(body.action || "export_to_storage");

    if (action !== "export_to_storage") {
      return NextResponse.json({ error: "Unsupported audit action" }, { status: 400 });
    }

    const scoped = await queryScopedAuditLogs(user, projectId, 500);
    if (scoped.forbidden) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const storage = await resolveUserStorageContext(user.id);
    if (!storage.credentials) {
      return NextResponse.json(
        {
          error:
            "No Cloudflare R2 or BYOS S3 storage bucket configured. Configure storage in Settings -> Cloudflare R2 & BYOS, or use CSV Download.",
          code: "STORAGE_NOT_CONFIGURED",
        },
        { status: 400 }
      );
    }

    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const objectKey = `compliance-exports/${user.id}/soc2-audit-${stamp}.csv`;
    const csv = logsToCsv(scoped.logs);

    const putRes = await putR2Object(
      storage.credentials,
      objectKey,
      csv,
      "text/csv; charset=utf-8"
    );

    if (!putRes.ok) {
      return NextResponse.json(
        { error: `R2/S3 upload failed with HTTP ${putRes.status}` },
        { status: 502 }
      );
    }

    const downloadUrl = await createPresignedUrl(storage.credentials, {
      method: "GET",
      objectKey,
      expiresInSeconds: 3600,
    });

    await recordAuditEvent({
      userId: user.id,
      actorUsername: user.githubUsername,
      organizationId: scoped.organizationId,
      projectId,
      action: "audit.exported_storage",
      resourceType: "audit_export",
      resourceId: objectKey,
      headers: req.headers,
      metadata: {
        provider: storage.provider,
        recordCount: scoped.logs.length,
        etag: putRes.etag || null,
      },
    });

    return NextResponse.json({
      success: true,
      objectKey,
      downloadUrl,
      provider: storage.provider,
      recordCount: scoped.logs.length,
    });
  } catch (err) {
    console.error("POST /api/v1/security/audit error:", err);
    return NextResponse.json({ error: "Failed to archive audit log to R2/S3" }, { status: 500 });
  }
}
