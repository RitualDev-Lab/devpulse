import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { resolveProjectAccess } from "@/lib/security/rbac";
import { recordAuditEvent } from "@/lib/security/audit";
import { compileProjectDigest, sendProjectDigest } from "@/lib/alerts/digest";

export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const projectId = req.nextUrl.searchParams.get("projectId");
  if (!projectId) return NextResponse.json({ error: "Missing projectId" }, { status: 400 });

  const access = await resolveProjectAccess(projectId, user);
  if (!access) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const compiled = await compileProjectDigest(projectId);
  return NextResponse.json({ digest: compiled });
}

export async function POST(req: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await req.json();
    const projectId = String(body.projectId || "");
    const toEmail = body.toEmail ? String(body.toEmail).trim() : undefined;

    if (!projectId) {
      return NextResponse.json({ error: "Missing projectId" }, { status: 400 });
    }

    const access = await resolveProjectAccess(projectId, user);
    if (!access || !access.canWrite) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const result = await sendProjectDigest(projectId, toEmail);

    await recordAuditEvent({
      userId: user.id,
      actorUsername: user.githubUsername,
      organizationId: access.project.organizationId,
      projectId,
      action: "digest.dispatched",
      resourceType: "project",
      resourceId: projectId,
      headers: req.headers,
      metadata: { sent: result.sent, provider: "provider" in result ? result.provider : "none" },
    });

    return NextResponse.json(result, { status: result.sent ? 200 : 200 });
  } catch (err: any) {
    console.error("POST /api/v1/notifications/digest error:", err);
    return NextResponse.json({ error: "Failed to dispatch digest" }, { status: 500 });
  }
}
