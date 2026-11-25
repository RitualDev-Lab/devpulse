import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { errorEvents } from "@/db/schema";
import { and, desc, eq, isNull } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth";
import { resolveProjectAccess } from "@/lib/security/rbac";
import { analyzeCrashWithGemini } from "@/lib/ai/crash-analyzer";
import { recordAuditEvent } from "@/lib/security/audit";

export const dynamic = "force-dynamic";

/**
 * POST /api/v1/crashes/analyze
 * Runs Gemini AI Crash Grouping, Root Cause Explanation, and Code Fix generation
 * for a specific crash event or batch of recent unanalyzed crashes.
 */
export async function POST(req: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await req.json();
    const projectId = String(body.projectId || "");
    const errorId = body.errorId ? String(body.errorId) : null;
    const geminiApiKey = body.geminiApiKey ? String(body.geminiApiKey).trim() : null;

    if (!projectId) {
      return NextResponse.json({ error: "Missing projectId" }, { status: 400 });
    }

    const access = await resolveProjectAccess(projectId, user);
    if (!access || !access.canWrite) {
      return NextResponse.json(
        { error: "Forbidden: Developer, Admin, or Owner permissions required." },
        { status: 403 }
      );
    }

    const targets = errorId
      ? await db
          .select()
          .from(errorEvents)
          .where(and(eq(errorEvents.id, errorId), eq(errorEvents.projectId, projectId)))
          .limit(1)
      : await db
          .select()
          .from(errorEvents)
          .where(and(eq(errorEvents.projectId, projectId), isNull(errorEvents.aiRootCause)))
          .orderBy(desc(errorEvents.createdAt))
          .limit(8);

    if (targets.length === 0) {
      return NextResponse.json({ success: true, analyzed: 0, results: [] });
    }

    // Fetch resolved crashes for regression detection across semantic AI group keys
    const resolvedRows = await db
      .select({
        aiGroupKey: errorEvents.aiGroupKey,
        errorName: errorEvents.errorName,
      })
      .from(errorEvents)
      .where(and(eq(errorEvents.projectId, projectId), eq(errorEvents.status, "resolved")))
      .limit(200);

    const resolvedGroupKeys = new Set(
      resolvedRows.map((r) => r.aiGroupKey).filter(Boolean) as string[]
    );
    const resolvedNames = new Set(resolvedRows.map((r) => r.errorName.split(":")[0].trim()));

    const results: Array<{ errorId: string; analysis: any; isRegression: boolean }> = [];

    for (const err of targets) {
      const analysis = await analyzeCrashWithGemini(
        {
          errorName: err.errorName,
          message: err.message,
          stackTrace: err.stackTrace,
          runtime: err.runtime,
          version: err.version,
          routePath: err.routePath,
        },
        geminiApiKey
      );

      const isRegression =
        err.isRegression ||
        resolvedGroupKeys.has(analysis.aiGroupKey) ||
        resolvedNames.has(err.errorName.split(":")[0].trim());

      await db
        .update(errorEvents)
        .set({
          aiGroupKey: analysis.aiGroupKey,
          aiGroupTitle: analysis.aiGroupTitle,
          aiRootCause: analysis.aiRootCause,
          aiFixSuggestion: analysis.aiFixSuggestion,
          aiCodeSnippet: analysis.aiCodeSnippet,
          isRegression,
        })
        .where(eq(errorEvents.id, err.id));

      results.push({ errorId: err.id, analysis, isRegression });
    }

    await recordAuditEvent({
      userId: user.id,
      actorUsername: user.githubUsername,
      organizationId: access.project.organizationId,
      workspaceId: access.project.workspaceId,
      projectId,
      action: "crash.ai_analyzed",
      resourceType: "error_event",
      resourceId: errorId || `batch:${results.length}`,
      headers: req.headers,
      metadata: {
        analyzedCount: results.length,
        provider: results[0]?.analysis?.provider || "deterministic",
      },
    });

    return NextResponse.json({
      success: true,
      analyzed: results.length,
      results,
    });
  } catch (err) {
    console.error("POST /api/v1/crashes/analyze error:", err);
    return NextResponse.json({ error: "AI crash analysis failed" }, { status: 500 });
  }
}
