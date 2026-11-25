import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { projects } from "@/db/schema";
import { eq } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth";
import {
  checkPendingUploadCapacity,
  recordPendingUpload,
  releasePendingUpload,
} from "@/lib/storage/quota";
import { createPresignedUrl } from "@/lib/storage/r2";
import { verifyTelemetryApiKey } from "@/lib/security/api-keys";
import { checkRateLimit, verifyTurnstileToken, getClientIp } from "@/lib/security/rate-limit";
import { resolveProjectAccess } from "@/lib/security/rbac";

export const dynamic = "force-dynamic";

const MAX_ATTACHMENT_BYTES = 15 * 1024 * 1024; // 15 MB per crash attachment

export async function POST(req: NextRequest) {
  try {
    const ip = getClientIp(req.headers);
    const rl = await checkRateLimit({
      key: `presign:${ip}`,
      limit: 20,
      windowSeconds: 60,
    });
    if (!rl.allowed) {
      return NextResponse.json(
        { error: "Too many attachment presign requests. Retry in a minute." },
        { status: 429, headers: { "Retry-After": String(rl.retryAfterSeconds) } }
      );
    }

    const body = await req.json();
    const { apiKey, projectId, projectSlug, turnstileToken, filename, contentType, sizeBytes } = body;

    const bytes = Number(sizeBytes || 0);
    if (!Number.isFinite(bytes) || bytes <= 0 || bytes > MAX_ATTACHMENT_BYTES) {
      return NextResponse.json(
        { error: `Attachment size must be between 1 byte and ${MAX_ATTACHMENT_BYTES / (1024 * 1024)} MB.` },
        { status: 400 }
      );
    }

    let targetProject: { id: string; userId: string; name: string } | undefined;

    if (apiKey) {
      const verified = await verifyTelemetryApiKey(String(apiKey));
      if (verified) {
        targetProject = { id: verified.id, userId: verified.userId, name: verified.name };
      }
    } else if (projectSlug) {
      const turnstile = await verifyTurnstileToken(turnstileToken, ip);
      if (!turnstile.ok) {
        return NextResponse.json({ error: turnstile.error || "Turnstile failed" }, { status: 403 });
      }
      const [found] = await db
        .select({ id: projects.id, userId: projects.userId, name: projects.name })
        .from(projects)
        .where(eq(projects.slug, String(projectSlug)))
        .limit(1);
      targetProject = found;
    } else if (projectId) {
      const user = await getCurrentUser();
      if (!user) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }
      const access = await resolveProjectAccess(String(projectId), user);
      if (access && access.canWrite) {
        targetProject = { id: access.project.id, userId: access.project.userId, name: access.project.name };
      }
    }

    if (!targetProject) {
      return NextResponse.json({ error: "Invalid project or telemetry apiKey" }, { status: 403 });
    }

    // Check available capacity (including unexpired pending uploads) without permanently debiting quota before upload confirmation
    const quota = await checkPendingUploadCapacity(targetProject.userId, bytes);
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

    await recordPendingUpload({
      objectKey,
      userId: targetProject.userId,
      projectId: targetProject.id,
      sizeBytes: bytes,
      ttlSeconds: 900,
    });

    const uploadUrl = await createPresignedUrl(quota.context.credentials, {
      method: "PUT",
      objectKey,
      expiresInSeconds: 600,
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

export async function DELETE(req: NextRequest) {
  const objectKey = req.nextUrl.searchParams.get("objectKey");
  if (!objectKey) {
    return NextResponse.json({ error: "Missing objectKey" }, { status: 400 });
  }
  await releasePendingUpload(objectKey);
  return NextResponse.json({ released: true });
}
