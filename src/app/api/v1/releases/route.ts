import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { projectReleases, sourceMaps } from "@/db/schema";
import { eq, and, desc, sql } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth";
import { resolveProjectAccess } from "@/lib/security/rbac";
import { verifyTelemetryApiKey } from "@/lib/security/api-keys";
import { checkAndReserveStorageQuota } from "@/lib/storage/quota";
import { putR2Object } from "@/lib/storage/r2";

export const dynamic = "force-dynamic";

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    },
  });
}

export async function GET(req: NextRequest) {
  try {
    const projectId = req.nextUrl.searchParams.get("projectId");
    if (!projectId) {
      return NextResponse.json({ error: "Missing projectId" }, { status: 400 });
    }

    if (projectId !== "prj_ritual_core") {
      const user = await getCurrentUser();
      if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      const access = await resolveProjectAccess(projectId, user);
      if (!access) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const releases = await db
      .select()
      .from(projectReleases)
      .where(eq(projectReleases.projectId, projectId))
      .orderBy(desc(projectReleases.releasedAt))
      .limit(20);

    const maps = await db
      .select({ version: sourceMaps.version, filePath: sourceMaps.filePath })
      .from(sourceMaps)
      .where(eq(sourceMaps.projectId, projectId));

    const mapCountByVer: Record<string, number> = {};
    for (const m of maps) {
      mapCountByVer[m.version] = (mapCountByVer[m.version] || 0) + 1;
    }

    return NextResponse.json({
      releases: releases.map((r) => {
        const sessions = Math.max(r.totalSessions, r.crashCount);
        const crashFreeRate =
          sessions > 0
            ? Number(Math.max(0, ((sessions - r.crashCount) / sessions) * 100).toFixed(2))
            : 100;
        return {
          ...r,
          crashFreeRate,
          sourceMapsCount: mapCountByVer[r.version] || 0,
        };
      }),
    });
  } catch (err: any) {
    console.error("GET /api/v1/releases error:", err);
    return NextResponse.json({ error: "Failed to load releases" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const authHeader = req.headers.get("authorization");
    const body = await req.json();
    const apiKey = authHeader?.replace(/^Bearer\s+/i, "") || body.apiKey || body.api_key;
    const action = String(body.action || "session");

    let targetProject: { id: string; userId: string } | null = null;
    if (apiKey) {
      const verified = await verifyTelemetryApiKey(String(apiKey));
      if (verified) targetProject = { id: verified.id, userId: verified.userId };
    } else if (body.projectId) {
      const user = await getCurrentUser();
      if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      const access = await resolveProjectAccess(String(body.projectId), user);
      if (access && access.canWrite) {
        targetProject = { id: access.project.id, userId: access.project.userId };
      }
    }

    if (!targetProject) {
      return NextResponse.json({ error: "Invalid telemetry apiKey or permissions" }, { status: 403 });
    }

    const version = String(body.version || body.release || "").trim().slice(0, 64);
    if (!version) {
      return NextResponse.json({ error: "Missing release version" }, { status: 400 });
    }

    if (action === "upload_sourcemap") {
      const filePath = String(body.filePath || body.file || "bundle.js.map").slice(0, 255);
      const content = typeof body.content === "string" ? body.content : "";
      if (!content) {
        return NextResponse.json({ error: "Missing source map content" }, { status: 400 });
      }

      const sizeBytes = new TextEncoder().encode(content).byteLength;
      if (sizeBytes > 15 * 1024 * 1024) {
        return NextResponse.json({ error: "Source map exceeds 15 MB limit" }, { status: 400 });
      }

      const quota = await checkAndReserveStorageQuota(targetProject.userId, sizeBytes);
      if (!quota.allowed || !quota.context.credentials) {
        return NextResponse.json(
          { error: quota.reason || "Storage quota exceeded" },
          { status: 402 }
        );
      }

      const safeFile = filePath.replace(/[^a-zA-Z0-9._/-]/g, "_");
      const objectKey = `${quota.context.prefix}/${targetProject.userId}/${targetProject.id}/sourcemaps/${version}/${safeFile}`;
      const putRes = await putR2Object(
        quota.context.credentials,
        objectKey,
        content,
        "application/json"
      );

      if (!putRes.ok) {
        return NextResponse.json({ error: "Failed to upload source map to R2" }, { status: 500 });
      }

      const mapId = `map_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
      await db.insert(sourceMaps).values({
        id: mapId,
        projectId: targetProject.id,
        version,
        filePath,
        r2ObjectKey: objectKey,
        sizeBytes,
      });

      return NextResponse.json(
        { success: true, mapId, r2ObjectKey: objectKey, version, filePath, sizeBytes },
        { status: 201, headers: { "Access-Control-Allow-Origin": "*" } }
      );
    }

    // Session heartbeat / release registration
    const sessionInc = Math.max(0, Math.min(1000, Number(body.sessions || 1)));
    const commitSha = body.commitSha ? String(body.commitSha).slice(0, 64) : null;

    const [existing] = await db
      .select()
      .from(projectReleases)
      .where(
        and(
          eq(projectReleases.projectId, targetProject.id),
          eq(projectReleases.version, version)
        )
      )
      .limit(1);

    if (existing) {
      await db
        .update(projectReleases)
        .set({
          totalSessions: sql`${projectReleases.totalSessions} + ${sessionInc}`,
          ...(commitSha && !existing.commitSha ? { commitSha } : {}),
        })
        .where(eq(projectReleases.id, existing.id));
    } else {
      await db.insert(projectReleases).values({
        id: `rel_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`,
        projectId: targetProject.id,
        version,
        commitSha,
        source: "sdk",
        totalSessions: sessionInc,
        crashCount: 0,
      });
    }

    return NextResponse.json(
      { success: true, version, sessionInc },
      { status: 201, headers: { "Access-Control-Allow-Origin": "*" } }
    );
  } catch (err: any) {
    console.error("POST /api/v1/releases error:", err);
    return NextResponse.json({ error: "Release ingest failed" }, { status: 500 });
  }
}
