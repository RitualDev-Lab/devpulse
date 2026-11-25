import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { errorEvents, projects } from "@/db/schema";
import { eq } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth";
import { resolveProjectAccess } from "@/lib/security/rbac";
import { isValidProjectR2ObjectKey } from "@/lib/security/ssrf";
import { resolveUserStorageContext } from "@/lib/storage/quota";
import { createPresignedUrl, getR2ObjectText } from "@/lib/storage/r2";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const eventId = req.nextUrl.searchParams.get("eventId");
    const kind = req.nextUrl.searchParams.get("kind") || "payload"; // 'payload' | 'attachment'

    if (!eventId) {
      return NextResponse.json({ error: "Missing eventId" }, { status: 400 });
    }

    const [event] = await db
      .select()
      .from(errorEvents)
      .where(eq(errorEvents.id, eventId))
      .limit(1);

    if (!event) {
      return NextResponse.json({ error: "Event not found" }, { status: 404 });
    }

    const [project] = await db
      .select({ id: projects.id, userId: projects.userId })
      .from(projects)
      .where(eq(projects.id, event.projectId))
      .limit(1);

    if (!project) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    // Tenant scoping & RBAC: allow demo preview OR any authorized org/project member
    if (project.id !== "prj_ritual_core") {
      const user = await getCurrentUser();
      if (!user) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }
      const access = await resolveProjectAccess(project.id, user);
      if (!access || !access.canRead) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
    }

    const storageCtx = await resolveUserStorageContext(project.userId);
    if (!storageCtx.credentials) {
      return NextResponse.json(
        { error: "R2 storage credentials unavailable" },
        { status: 503 }
      );
    }

    if (kind === "attachment") {
      if (!event.attachmentUrl) {
        return NextResponse.json({ error: "No attachment for this event" }, { status: 404 });
      }
      if (!isValidProjectR2ObjectKey(event.attachmentUrl, project.id, project.userId)) {
        return NextResponse.json(
          { error: "Invalid attachment object key for this project." },
          { status: 400 }
        );
      }
      const url = await createPresignedUrl(storageCtx.credentials, {
        method: "GET",
        objectKey: event.attachmentUrl,
        expiresInSeconds: 600,
      });
      return NextResponse.json({
        url,
        objectKey: event.attachmentUrl,
        provider: storageCtx.provider,
      });
    }

    // kind === "payload" (100KB+ stack trace & terminal log object in R2)
    if (!event.r2ObjectKey) {
      return NextResponse.json({
        content: event.stackTrace || "",
        objectKey: null,
        sizeBytes: event.payloadSizeBytes || 0,
        provider: "turso",
      });
    }

    if (!isValidProjectR2ObjectKey(event.r2ObjectKey, project.id, project.userId)) {
      return NextResponse.json(
        { error: "Invalid R2 payload key for this project." },
        { status: 400 }
      );
    }

    const rawContent = await getR2ObjectText(storageCtx.credentials, event.r2ObjectKey);
    const downloadUrl = await createPresignedUrl(storageCtx.credentials, {
      method: "GET",
      objectKey: event.r2ObjectKey,
      expiresInSeconds: 600,
    });

    return NextResponse.json({
      content: rawContent ?? event.stackTrace ?? "",
      objectKey: event.r2ObjectKey,
      sizeBytes: event.payloadSizeBytes,
      provider: event.storageProvider,
      downloadUrl,
    });
  } catch (err: any) {
    console.error("GET /api/v1/storage/attachment error:", err);
    return NextResponse.json(
      { error: "Failed to retrieve R2 object", details: err?.message },
      { status: 500 }
    );
  }
}
