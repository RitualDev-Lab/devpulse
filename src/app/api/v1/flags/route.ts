import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { errorEvents, featureFlags, flagExposures } from "@/db/schema";
import { and, desc, eq, gte } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth";
import { resolveProjectAccess } from "@/lib/security/rbac";
import { recordAuditEvent } from "@/lib/security/audit";
import { checkAndAutoRollbackFlags, parseFlagVariants } from "@/lib/flags/flag-engine";
import { buildExperimentReadout } from "@/lib/flags/experiment-readout";
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

    const [flags, flagErrors] = await Promise.all([
      db
        .select()
        .from(featureFlags)
        .where(eq(featureFlags.projectId, projectId))
        .orderBy(desc(featureFlags.createdAt))
        .limit(40),
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

    // Experiment readouts use the same 30-day window as rollback, queried per flag so one busy flag
    // can't truncate another flag's sample. Rows are capped, and the readout pauses when capped.
    const EXPERIMENT_ROW_CAP = 5000;
    const cutoffIso = new Date(Date.now() - 30 * 86400_000).toISOString().slice(0, 19).replace("T", " ");
    const hashingEnabled = Boolean(process.env.ANALYTICS_HASH_SECRET);

    const enriched = await Promise.all(
      flags.map(async (f) => {
        const variants = parseFlagVariants(f.variantsJson);
        const windowRows = await db
          .select({ userHash: flagExposures.userHash, variant: flagExposures.variant, converted: flagExposures.converted })
          .from(flagExposures)
          .where(
            and(
              eq(flagExposures.projectId, projectId),
              eq(flagExposures.flagKey, f.key),
              gte(flagExposures.createdAt, cutoffIso)
            )
          )
          .limit(EXPERIMENT_ROW_CAP + 1);
        const truncated = windowRows.length > EXPERIMENT_ROW_CAP;
        const readout = buildExperimentReadout({
          variants: variants.map((v) => ({ name: v.name, weight: v.weight })),
          rows: truncated ? windowRows.slice(0, EXPERIMENT_ROW_CAP) : windowRows,
          hashingEnabled,
          truncated,
        });
        const errs = flagErrors.filter((er) => er.flagKey === f.key);

        const abStats = readout.arms.map((arm) => ({
          variant: arm.variant,
          weight: arm.weight,
          exposures: arm.exposedUsers,
          conversions: arm.convertedUsers,
          conversionRate: arm.conversionRatePercent,
          crashes: errs.filter((er) => (er.flagVariant || "control") === arm.variant).length,
          status: arm.status,
          differencePoints: arm.differencePoints,
          ciLowerPoints: arm.ciLowerPoints,
          ciUpperPoints: arm.ciUpperPoints,
        }));

        return {
          ...f,
          totalExposures: readout.arms.reduce((sum, arm) => sum + arm.exposedUsers, 0),
          totalCrashes: errs.length,
          abStats,
          experiment: {
            available: readout.available,
            reason: readout.reason,
            controlVariant: readout.controlVariant,
            minUsersPerArm: readout.minUsersPerArm,
            excludedCrossVariantUsers: readout.excludedCrossVariantUsers,
          },
        };
      })
    );

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
