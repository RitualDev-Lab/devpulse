import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { projects } from "@/db/schema";
import { eq } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth";
import { checkAndReserveStorageQuota } from "@/lib/storage/quota";
import { createPresignedUrl } from "@/lib/storage/r2";

export const dynamic = "force-dynamic";

const MAX_ATTACHMENT_BYTES = 15 * 1024 * 1024; // 15 MB per crash attachment

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { apiKey, projectId, filename, contentType, sizeBytes } = body;

    const bytes = Number(sizeBytes || 0);
    if (!Number.isFinite(bytes) || bytes <= 0 || bytes > MAX_ATTACHMENT_BYTES) {
      return NextResponse.json(
        { error: `Attachment size must be between 1 byte and ${MAX_ATTACHMENT_BYTES / (1024 * 1024)} MB.` },
        { status: 400 }
      );
    }

    let targetProject: { id: string; userId: string; name: string } | undefined;

    if (apiKey) {
      const [found] = await db
        .select({ id: projects.id, userId: projects.userId, name: projects.name })
        .from(projects)
        .where(eq(projects.telemetryApiKey, String(apiKey)))
        .limit(1);
      targetProject = found;
    } else if (projectId) {
      const user = await getCurrentUser();
      if (!user) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }
      const [found] = await db
        .select({ id: projects.id, userId: projects.userId, name: projects.name })
        .from(projects)
        .where(eq(projects.id, String(projectId)))
        .limit(1);

      if (found && found.userId === user.id) {
        targetProject = found;
      }
    }

    if (!targetProject) {
      return NextResponse.json({ error: "Invalid project or telemetry apiKey" }, { status: 403 });
    }

    // Enforce Storage Quota & Metering Guard
    const quota = await checkAndReserveStorageQuota(targetProject.userId, bytes);
    if (!quota.allowed || !quota.context.credentials) {
      return NextResponse.json(
        {
          error: quota.reason || "Storage quota exceeded",
          code: "STORAGE_QUOTA_EXCEEDED",
          usedBytes: quota.context.usedBytes,
          limitBytes: quota.context.limitBytes,
          tier: quota.context.tier,
        },
        { status: 413 }
      );
    }

    const safeName = String(filename || "attachment.bin")
      .replace(/[^a-zA-Z0-9._-]/g, "_")
      .slice(0, 64);
    const uid = crypto.randomUUID().replace(/-/g, "").slice(0, 12);
    const objectKey = `${quota.context.prefix}/${targetProject.userId}/${targetProject.id}/attachments/${uid}-${safeName}`;

    const uploadUrl = await createPresignedUrl(quota.context.credentials, {
      method: "PUT",
      objectKey,
      expiresInSeconds: 600, // 10 minutes
    });

    return NextResponse.json({
      success: true,
      uploadUrl,
      objectKey,
      contentType: String(contentType || "application/octet-stream"),
      expiresIn: 600,
      provider: quota.context.provider,
      usedBytes: quota.context.usedBytes,
      limitBytes: quota.context.limitBytes,
    });
  } catch (err: any) {
    console.error("POST /api/v1/storage/presign error:", err);
    return NextResponse.json(
      { error: "Failed to create presigned upload URL", details: err?.message },
      { status: 500 }
    );
  }
}
