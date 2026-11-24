import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/db";
import { auditLogs } from "@/db/schema";
import { eq, desc, or, inArray } from "drizzle-orm";
import { resolveProjectAccess, listAccessibleProjects } from "@/lib/security/rbac";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const projectId = req.nextUrl.searchParams.get("projectId");
    let logs: Array<typeof auditLogs.$inferSelect> = [];

    if (projectId) {
      const access = await resolveProjectAccess(projectId, user);
      if (!access) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
      logs = await db
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
        .limit(100);
    } else {
      const accessible = await listAccessibleProjects(user);
      const accessibleIds = accessible.map((p) => p.id);
      logs =
        accessibleIds.length > 0
          ? await db
              .select()
              .from(auditLogs)
              .where(or(eq(auditLogs.userId, user.id), inArray(auditLogs.projectId, accessibleIds)))
              .orderBy(desc(auditLogs.createdAt))
              .limit(100)
          : await db
              .select()
              .from(auditLogs)
              .where(eq(auditLogs.userId, user.id))
              .orderBy(desc(auditLogs.createdAt))
              .limit(100);
    }

    return NextResponse.json({ logs });
  } catch (err: any) {
    console.error("GET /api/v1/security/audit error:", err);
    return NextResponse.json({ error: "Failed to load audit log" }, { status: 500 });
  }
}
