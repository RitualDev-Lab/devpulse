import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { errorEvents, sourceMaps } from "@/db/schema";
import { and, desc, eq } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth";
import { resolveProjectAccess } from "@/lib/security/rbac";
import { resolveUserStorageContext } from "@/lib/storage/quota";
import { getR2ObjectText } from "@/lib/storage/r2";
import { symbolicateStackTrace } from "@/lib/telemetry/symbolicator";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const projectId = req.nextUrl.searchParams.get("projectId");
    const version = req.nextUrl.searchParams.get("version");
    if (!projectId) {
      return NextResponse.json({ error: "Missing projectId" }, { status: 400 });
    }

    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const access = await resolveProjectAccess(projectId, user);
    if (!access) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const whereClause = version
      ? and(eq(sourceMaps.projectId, projectId), eq(sourceMaps.version, version))
      : eq(sourceMaps.projectId, projectId);

    const rows = await db
      .select()
      .from(sourceMaps)
      .where(whereClause)
      .orderBy(desc(sourceMaps.createdAt))
      .limit(100);

    return NextResponse.json({ sourceMaps: rows });
  } catch (err: any) {
    console.error("GET /api/v1/telemetry/symbolicate error:", err);
    return NextResponse.json({ error: "Failed to load source maps" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const projectId = String(body.projectId || "");
    const eventId = body.eventId ? String(body.eventId) : null;
    let stackTrace = typeof body.stackTrace === "string" ? body.stackTrace : "";
    let version = body.version ? String(body.version) : "";

    if (!projectId) {
      return NextResponse.json({ error: "Missing projectId" }, { status: 400 });
    }

    const access = await resolveProjectAccess(projectId, user);
    if (!access) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const storageCtx = await resolveUserStorageContext(access.project.userId);

    if (eventId) {
      const [ev] = await db
        .select()
        .from(errorEvents)
        .where(and(eq(errorEvents.id, eventId), eq(errorEvents.projectId, projectId)))
        .limit(1);

      if (!ev) {
        return NextResponse.json({ error: "Crash event not found" }, { status: 404 });
      }

      if (!version && ev.version) {
        version = ev.version;
      }

      if (!stackTrace) {
        stackTrace = ev.stackTrace || "";
      }

      // Check R2 offloaded stack trace if event had a full payload object
      if (ev.r2ObjectKey && storageCtx.credentials) {
        const rawPayload = await getR2ObjectText(storageCtx.credentials, ev.r2ObjectKey);
        if (rawPayload) {
          try {
            const parsed = JSON.parse(rawPayload);
            if (typeof parsed.stackTrace === "string" && parsed.stackTrace.length > stackTrace.length) {
              stackTrace = parsed.stackTrace;
            }
          } catch {
            // Keep existing inline stackTrace
          }
        }
      }
    }

    if (!stackTrace) {
      return NextResponse.json({ error: "No stack trace available to symbolicate" }, { status: 400 });
    }

    // Load source maps for this version (or latest project maps if version omitted)
    const mapRows = version
      ? await db
          .select()
          .from(sourceMaps)
          .where(and(eq(sourceMaps.projectId, projectId), eq(sourceMaps.version, version)))
          .orderBy(desc(sourceMaps.createdAt))
          .limit(30)
      : await db
          .select()
          .from(sourceMaps)
          .where(eq(sourceMaps.projectId, projectId))
          .orderBy(desc(sourceMaps.createdAt))
          .limit(30);

    if (mapRows.length === 0) {
      return NextResponse.json({
        frames: [],
        decodedTrace: stackTrace,
        totalFrames: 0,
        symbolicatedCount: 0,
        matchedMaps: [],
        message: version
          ? `No source maps uploaded for version ${version}. Run: devpulse upload-sourcemaps --release ${version}`
          : "No source maps uploaded for this project yet.",
      });
    }

    if (!storageCtx.credentials) {
      return NextResponse.json(
        { error: "Storage credentials unavailable to fetch source maps from R2" },
        { status: 500 }
      );
    }

    const artifacts = (
      await Promise.all(
        mapRows.map(async (m) => {
          const content = await getR2ObjectText(storageCtx.credentials!, m.r2ObjectKey);
          return content ? { filePath: m.filePath, content } : null;
        })
      )
    ).filter((x): x is { filePath: string; content: string } => x !== null);

    const result = symbolicateStackTrace(stackTrace, artifacts);

    return NextResponse.json({
      ...result,
      version: version || mapRows[0]?.version || null,
      availableMapsCount: mapRows.length,
    });
  } catch (err: any) {
    console.error("POST /api/v1/telemetry/symbolicate error:", err);
    return NextResponse.json({ error: "Symbolication failed" }, { status: 500 });
  }
}
