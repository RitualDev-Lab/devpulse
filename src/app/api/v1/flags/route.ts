import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { errorEvents, featureFlags, flagExposures } from "@/db/schema";
import { and, desc, eq } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth";
import { resolveProjectAccess } from "@/lib/security/rbac";
import { recordAuditEvent } from "@/lib/security/audit";
import { checkAndAutoRollbackFlags, parseFlagVariants } from "@/lib/flags/flag-engine";
import { isPublicDemoProject } from "@/lib/security/demo-project";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const projectId = req.nextUrl.searchParams.get("projectId");
    if (!projectId) return NextResponse.json({ error: "Missing projectId" }, { status: 400 });

    if (!isPublicDemoProject(projectId)) {
      const user = await getCurrentUser();
      if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      const access = await resolveProjectAccess(projectId, user);
      if (!access) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const [flags, exposures, flagErrors] = await Promise.all([
      db
        .select()
        .from(featureFlags)
        .where(eq(featureFlags.projectId, projectId))
        .orderBy(desc(featureFlags.createdAt))
        .limit(40),
      db
        .select()
        .from(flagExposures)
        .where(eq(flagExposures.projectId, projectId))
        .limit(1000),
      db
        .select({
          id: errorEvents.id,
          flagKey: errorEvents.flagKey,
          flagVariant: errorEvents.flagVariant,
        })
        .from(errorEvents)
        .where(eq(errorEvents.projectId, projectId))
        .limit(500),
    ]);

    const enriched = flags.map((f) => {
      const variants = parseFlagVariants(f.variantsJson);
      const exps = exposures.filter((e) => e.flagKey === f.key);
      const errs = flagErrors.filter((er) => er.flagKey === f.key);

      const abStats = variants.map((v) => {
        const varExps = exps.filter((e) => e.variant === v.name);
        const conversions = varExps.filter((e) => e.converted).length;
        const crashes = errs.filter((er) => (er.flagVariant || "control") === v.name).length;
        const conversionRate =
          varExps.length > 0 ? Math.round((conversions / varExps.length) * 1000) / 10 : 0;
        return {
          variant: v.name,
          weight: v.weight,
          exposures: varExps.length,
          conversions,
          conversionRate,
          crashes,
        };
      });

      return {
        ...f,
        totalExposures: exps.length,
        totalCrashes: errs.length,
        abStats,
      };
    });

    return NextResponse.json({ flags: enriched });
  } catch (err) {
    console.error("GET /api/v1/flags error:", err);
    return NextResponse.json({ error: "Failed to load feature flags" }, { status: 500 });
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
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    if (action === "create_flag") {
      const key = String(body.key || "")
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9_-]/g, "-");
      if (!key) return NextResponse.json({ error: "Flag key is required" }, { status: 400 });

      const rolloutPercent = Math.max(0, Math.min(100, Number(body.rolloutPercent ?? 100)));
      const variants = Array.isArray(body.variants)
        ? body.variants
        : [
            { name: "control", weight: 50 },
            { name: "treatment", weight: 50 },
          ];

      const id = `flg_${crypto.randomUUID().replace(/-/g, "").slice(0, 14)}`;
      await db.insert(featureFlags).values({
        id,
        projectId,
        key,
        description: body.description ? String(body.description).slice(0, 240) : null,
        isEnabled: body.isEnabled !== false,
        rolloutPercent,
        variantsJson: JSON.stringify(variants),
        autoRollbackEnabled: body.autoRollbackEnabled !== false,
        crashRateThresholdPercent: Math.max(
          1,
          Math.min(100, Number(body.crashRateThresholdPercent || 5))
        ),
        status: "active",
      });

      await recordAuditEvent({
        userId: user.id,
        actorUsername: user.githubUsername,
        organizationId: access.project.organizationId,
        workspaceId: access.project.workspaceId,
        projectId,
        action: "flag.created",
        resourceType: "feature_flag",
        resourceId: key,
        headers: req.headers,
        metadata: { key, rolloutPercent },
      });

      return NextResponse.json({ success: true, flagId: id }, { status: 201 });
    }

    if (action === "update_rollout") {
      const flagId = String(body.flagId || "");
      const isEnabled = body.isEnabled !== undefined ? Boolean(body.isEnabled) : true;
      const rolloutPercent = Math.max(0, Math.min(100, Number(body.rolloutPercent ?? 100)));

      await db
        .update(featureFlags)
        .set({
          isEnabled,
          rolloutPercent,
          status: isEnabled ? "active" : "paused",
          rollbackReason: null,
          updatedAt: new Date().toISOString(),
        })
        .where(and(eq(featureFlags.id, flagId), eq(featureFlags.projectId, projectId)));

      await recordAuditEvent({
        userId: user.id,
        actorUsername: user.githubUsername,
        organizationId: access.project.organizationId,
        workspaceId: access.project.workspaceId,
        projectId,
        action: "flag.updated",
        resourceType: "feature_flag",
        resourceId: flagId,
        headers: req.headers,
        metadata: { isEnabled, rolloutPercent },
      });

      return NextResponse.json({ success: true });
    }

    if (action === "delete_flag") {
      const flagId = String(body.flagId || "");
      await db
        .delete(featureFlags)
        .where(and(eq(featureFlags.id, flagId), eq(featureFlags.projectId, projectId)));
      return NextResponse.json({ success: true });
    }

    if (action === "check_rollback") {
      const res = await checkAndAutoRollbackFlags(projectId);
      return NextResponse.json({ success: true, ...res });
    }

    return NextResponse.json({ error: "Unsupported flag action" }, { status: 400 });
  } catch (err) {
    console.error("POST /api/v1/flags error:", err);
    return NextResponse.json({ error: "Feature flag operation failed" }, { status: 500 });
  }
}
