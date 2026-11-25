import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { syntheticRuns, syntheticTests } from "@/db/schema";
import { and, desc, eq } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth";
import { resolveProjectAccess } from "@/lib/security/rbac";
import { recordAuditEvent } from "@/lib/security/audit";
import { computeP95Latency } from "@/lib/monitors/checker";
import {
  EDGE_REGIONS,
  executeSyntheticTestAcrossRegions,
  parseSyntheticYaml,
} from "@/lib/synthetics/yaml-runner";

export const dynamic = "force-dynamic";

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

    const [tests, runs] = await Promise.all([
      db
        .select()
        .from(syntheticTests)
        .where(eq(syntheticTests.projectId, projectId))
        .orderBy(desc(syntheticTests.createdAt))
        .limit(20),
      db
        .select()
        .from(syntheticRuns)
        .where(eq(syntheticRuns.projectId, projectId))
        .orderBy(desc(syntheticRuns.ranAt))
        .limit(100),
    ]);

    const regionP95 = EDGE_REGIONS.map((reg) => {
      const regRuns = runs.filter((r) => r.region === reg.id);
      const passCount = regRuns.filter((r) => r.status === "pass").length;
      return {
        region: reg.id,
        label: reg.label,
        totalRuns: regRuns.length,
        passRate: regRuns.length > 0 ? Math.round((passCount / regRuns.length) * 100) : 100,
        p95LatencyMs: computeP95Latency(regRuns.map((r) => r.totalLatencyMs)),
      };
    });

    return NextResponse.json({ tests, runs: runs.slice(0, 35), regionP95 });
  } catch (err) {
    console.error("GET /api/v1/synthetics error:", err);
    return NextResponse.json({ error: "Failed to load synthetic monitors" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await req.json();
    const projectId = String(body.projectId || "");
    const action = String(body.action || "");
    if (!projectId) return NextResponse.json({ error: "Missing projectId" }, { status: 400 });

    const access = await resolveProjectAccess(projectId, user);
    if (!access || !access.canWrite) {
      return NextResponse.json(
        { error: "Forbidden: Developer, Admin, or Owner permissions required." },
        { status: 403 }
      );
    }

    if (action === "create_test") {
      const yamlSpec = String(body.yamlSpec || "").trim();
      let parsed;
      try {
        parsed = parseSyntheticYaml(yamlSpec);
      } catch (e: any) {
        return NextResponse.json({ error: e.message || "Invalid YAML spec" }, { status: 400 });
      }

      const id = `syn_${crypto.randomUUID().replace(/-/g, "").slice(0, 14)}`;
      await db.insert(syntheticTests).values({
        id,
        projectId,
        name: String(body.name || parsed.name).slice(0, 100),
        yamlSpec,
        regionsJson: JSON.stringify(EDGE_REGIONS.map((r) => r.id)),
        intervalMinutes: Math.max(5, Math.min(1440, Number(body.intervalMinutes || 15))),
        isActive: true,
        lastStatus: "pending",
      });

      const initialResult = await executeSyntheticTestAcrossRegions(id).catch(() => null);

      await recordAuditEvent({
        userId: user.id,
        actorUsername: user.githubUsername,
        organizationId: access.project.organizationId,
        workspaceId: access.project.workspaceId,
        projectId,
        action: "synthetic.test_created",
        resourceType: "synthetic_test",
        resourceId: id,
        headers: req.headers,
        metadata: { name: parsed.name, baseUrl: parsed.baseUrl, steps: parsed.steps.length },
      });

      return NextResponse.json({ success: true, testId: id, initialResult }, { status: 201 });
    }

    if (action === "run_now") {
      const testId = String(body.testId || "");
      const [found] = await db
        .select({ id: syntheticTests.id })
        .from(syntheticTests)
        .where(and(eq(syntheticTests.id, testId), eq(syntheticTests.projectId, projectId)))
        .limit(1);
      if (!found) return NextResponse.json({ error: "Synthetic test not found" }, { status: 404 });

      const result = await executeSyntheticTestAcrossRegions(testId);
      return NextResponse.json({ success: true, result });
    }

    if (action === "delete_test") {
      const testId = String(body.testId || "");
      await db
        .delete(syntheticTests)
        .where(and(eq(syntheticTests.id, testId), eq(syntheticTests.projectId, projectId)));
      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ error: "Unsupported synthetics action" }, { status: 400 });
  } catch (err) {
    console.error("POST /api/v1/synthetics error:", err);
    return NextResponse.json({ error: "Synthetic monitor operation failed" }, { status: 500 });
  }
}
