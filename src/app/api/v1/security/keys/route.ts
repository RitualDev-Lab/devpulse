import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/db";
import { projects, telemetryKeys } from "@/db/schema";
import { eq, and, desc } from "drizzle-orm";
import { resolveProjectAccess } from "@/lib/security/rbac";
import { recordAuditEvent } from "@/lib/security/audit";
import {
  generateRawTelemetryKey,
  hashApiKey,
  ensurePrimaryKeyHashRecorded,
  revokeProjectActiveKeys,
} from "@/lib/security/api-keys";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const projectId = req.nextUrl.searchParams.get("projectId");
    if (!projectId) {
      return NextResponse.json({ error: "Missing projectId" }, { status: 400 });
    }

    const access = await resolveProjectAccess(projectId, user);
    if (!access) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // Backfill legacy project telemetry key hash once if no rows recorded yet
    const existingKeys = await db
      .select()
      .from(telemetryKeys)
      .where(eq(telemetryKeys.projectId, projectId))
      .orderBy(desc(telemetryKeys.createdAt));

    if (
      existingKeys.length === 0 &&
      access.project.telemetryApiKey &&
      !access.project.telemetryApiKey.startsWith("revoked_")
    ) {
      await ensurePrimaryKeyHashRecorded({
        projectId: access.project.id,
        rawKey: access.project.telemetryApiKey,
        userId: access.project.userId,
        name: "Primary SDK Key",
      });
    }

    const keys = await db
      .select({
        id: telemetryKeys.id,
        name: telemetryKeys.name,
        keyPrefix: telemetryKeys.keyPrefix,
        keyHashPreview: telemetryKeys.keyHash,
        status: telemetryKeys.status,
        lastUsedAt: telemetryKeys.lastUsedAt,
        revokedAt: telemetryKeys.revokedAt,
        createdAt: telemetryKeys.createdAt,
      })
      .from(telemetryKeys)
      .where(eq(telemetryKeys.projectId, projectId))
      .orderBy(desc(telemetryKeys.createdAt));

    return NextResponse.json({
      role: access.role,
      canManageSecurity: access.canManageSecurity,
      keys: keys.map((k) => ({
        ...k,
        keyHashPreview: `${k.keyHashPreview.slice(0, 12)}...${k.keyHashPreview.slice(-6)}`,
      })),
    });
  } catch (err: any) {
    console.error("GET /api/v1/security/keys error:", err);
    return NextResponse.json({ error: "Failed to load API keys" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const { projectId, action, keyId, name } = body;

    if (!projectId || !["generate", "rotate", "revoke"].includes(action)) {
      return NextResponse.json({ error: "Invalid projectId or action" }, { status: 400 });
    }

    const access = await resolveProjectAccess(String(projectId), user);
    if (!access || !access.canManageSecurity) {
      await recordAuditEvent({
        userId: user.id,
        actorUsername: user.githubUsername,
        organizationId: access?.project.organizationId,
        projectId: String(projectId),
        action: `api_key.${action}`,
        resourceType: "telemetry_key",
        resourceId: keyId ? String(keyId) : null,
        status: "denied",
        headers: req.headers,
        metadata: { role: access?.role || "none" },
      });
      return NextResponse.json(
        { error: "Forbidden: Only Workspace Owners can generate, rotate, or revoke API keys." },
        { status: 403 }
      );
    }

    if (action === "revoke") {
      if (!keyId) {
        return NextResponse.json({ error: "Missing keyId to revoke" }, { status: 400 });
      }

      const [targetKey] = await db
        .select()
        .from(telemetryKeys)
        .where(and(eq(telemetryKeys.id, String(keyId)), eq(telemetryKeys.projectId, projectId)))
        .limit(1);

      if (!targetKey) {
        return NextResponse.json({ error: "API key not found" }, { status: 404 });
      }

      await db
        .update(telemetryKeys)
        .set({ status: "revoked", revokedAt: new Date().toISOString() })
        .where(eq(telemetryKeys.id, targetKey.id));

      const currentHash = access.project.telemetryApiKey
        ? await hashApiKey(access.project.telemetryApiKey)
        : null;
      if (currentHash === targetKey.keyHash) {
        await db
          .update(projects)
          .set({
            telemetryApiKey: `revoked_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`,
            updatedAt: new Date().toISOString(),
          })
          .where(eq(projects.id, projectId));
      }

      await recordAuditEvent({
        userId: user.id,
        actorUsername: user.githubUsername,
        organizationId: access.project.organizationId,
        projectId,
        action: "api_key.revoked",
        resourceType: "telemetry_key",
        resourceId: targetKey.id,
        headers: req.headers,
        metadata: { keyPrefix: targetKey.keyPrefix, name: targetKey.name },
      });

      return NextResponse.json({ success: true, revokedKeyId: targetKey.id });
    }

    if (action === "rotate") {
      await revokeProjectActiveKeys(projectId);
    }

    const { rawKey, keyPrefix } = generateRawTelemetryKey();
    const keyHash = await hashApiKey(rawKey);
    const newId = `key_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
    const safeName =
      String(name || (action === "rotate" ? "Rotated SDK Key" : "Secondary SDK Key")).trim().slice(0, 60) ||
      "SDK Key";

    await db.insert(telemetryKeys).values({
      id: newId,
      projectId,
      name: safeName,
      keyPrefix,
      keyHash,
      status: "active",
      createdByUserId: user.id,
    });

    if (action === "rotate" || access.project.telemetryApiKey.startsWith("revoked_")) {
      await db
        .update(projects)
        .set({ telemetryApiKey: rawKey, updatedAt: new Date().toISOString() })
        .where(eq(projects.id, projectId));
    }

    await recordAuditEvent({
      userId: user.id,
      actorUsername: user.githubUsername,
      organizationId: access.project.organizationId,
      projectId,
      action: action === "rotate" ? "api_key.rotated" : "api_key.generated",
      resourceType: "telemetry_key",
      resourceId: newId,
      headers: req.headers,
      metadata: { keyPrefix, name: safeName },
    });

    return NextResponse.json({
      success: true,
      rawKey, // Shown once to the Owner right after generation/rotation
      record: {
        id: newId,
        name: safeName,
        keyPrefix,
        keyHashPreview: `${keyHash.slice(0, 12)}...${keyHash.slice(-6)}`,
        status: "active",
        createdAt: new Date().toISOString(),
      },
    });
  } catch (err: any) {
    console.error("POST /api/v1/security/keys error:", err);
    return NextResponse.json({ error: "API key operation failed" }, { status: 500 });
  }
}
