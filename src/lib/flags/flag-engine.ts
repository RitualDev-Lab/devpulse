import { db } from "@/db";
import { errorEvents, featureFlags, flagExposures, projects } from "@/db/schema";
import { and, eq, gte } from "drizzle-orm";
import { assessCrashRollback, summarizeFlagCrashSamples } from "@/lib/flags/rollback-statistics";
import { recordAuditEvent } from "@/lib/security/audit";
import { dispatchCrashAlerts, resolveDecryptedWebhookConfig } from "@/lib/alerts/webhook";
import { PUBLIC_APP_URL } from "@/lib/config/app-url";

export interface FlagVariant {
  name: string;
  weight: number;
}

export interface EvaluatedFlagResult {
  key: string;
  enabled: boolean;
  variant: string;
  rolloutPercent: number;
}

export function hashToPercentBucket(seed: string): number {
  let hash = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) % 100;
}

export function parseFlagVariants(raw?: string | null): FlagVariant[] {
  if (!raw) return [{ name: "control", weight: 50 }, { name: "treatment", weight: 50 }];
  try {
    const arr = JSON.parse(raw);
    if (Array.isArray(arr) && arr.length > 0) {
      return arr.map((v) => ({
        name: String(v?.name || "control"),
        weight: Math.max(0, Number(v?.weight ?? 50)),
      }));
    }
  } catch {
    // ignore malformed JSON
  }
  return [{ name: "control", weight: 50 }, { name: "treatment", weight: 50 }];
}

/**
 * Deterministic consistent-hash feature flag & A/B variant evaluation.
 */
export function evaluateFlagForUser(
  flag: {
    key: string;
    isEnabled: boolean;
    rolloutPercent: number;
    variantsJson?: string | null;
    status?: string;
  },
  userKey = "anonymous"
): EvaluatedFlagResult {
  if (!flag.isEnabled || flag.status === "rolled_back" || flag.status === "paused") {
    return {
      key: flag.key,
      enabled: false,
      variant: "control",
      rolloutPercent: flag.rolloutPercent,
    };
  }

  const rolloutBucket = hashToPercentBucket(`${flag.key}:rollout:${userKey}`);
  const enabled = rolloutBucket < Math.max(0, Math.min(100, flag.rolloutPercent));

  if (!enabled) {
    return {
      key: flag.key,
      enabled: false,
      variant: "control",
      rolloutPercent: flag.rolloutPercent,
    };
  }

  const variants = parseFlagVariants(flag.variantsJson);
  const totalWeight = variants.reduce((s, v) => s + v.weight, 0);
  if (totalWeight <= 0) {
    return { key: flag.key, enabled: true, variant: "treatment", rolloutPercent: flag.rolloutPercent };
  }

  const varBucket = hashToPercentBucket(`${flag.key}:variant:${userKey}`) % totalWeight;
  let acc = 0;
  let chosen = variants[0].name;
  for (const v of variants) {
    acc += v.weight;
    if (varBucket < acc) {
      chosen = v.name;
      break;
    }
  }

  return {
    key: flag.key,
    enabled: true,
    variant: chosen,
    rolloutPercent: flag.rolloutPercent,
  };
}

/**
 * Auto-rolls back a feature flag only when distinct, pseudonymous users show a
 * statistically significant treatment crash-rate increase in the last hour.
 */
export async function checkAndAutoRollbackFlags(projectId: string) {
  const activeFlags = await db
    .select()
    .from(featureFlags)
    .where(
      and(
        eq(featureFlags.projectId, projectId),
        eq(featureFlags.isEnabled, true),
        eq(featureFlags.autoRollbackEnabled, true)
      )
    );

  if (activeFlags.length === 0) return { rolledBack: [] as string[] };

  // No secret means no joinable identities; avoid making rollback decisions from anonymous data.
  if (!process.env.ANALYTICS_HASH_SECRET) return { rolledBack: [] as string[] };

  // SQLite CURRENT_TIMESTAMP rows use `YYYY-MM-DD HH:mm:ss`; keep lexical comparisons aligned.
  const cutoffIso = new Date(Date.now() - 60 * 60_000)
    .toISOString()
    .replace("T", " ")
    .replace(/\.\d{3}Z$/, "");
  const [recentErrors, recentExposures] = await Promise.all([
    db
      .select({ flagKey: errorEvents.flagKey, flagVariant: errorEvents.flagVariant, userHash: errorEvents.flagUserHash })
      .from(errorEvents)
      .where(and(eq(errorEvents.projectId, projectId), gte(errorEvents.createdAt, cutoffIso)))
      .limit(5001),
    db
      .select({ flagKey: flagExposures.flagKey, variant: flagExposures.variant, userHash: flagExposures.userHash })
      .from(flagExposures)
      .where(and(eq(flagExposures.projectId, projectId), gte(flagExposures.createdAt, cutoffIso)))
      .limit(5001),
  ]);

  // The statistical sample must be complete. Truncated query results could bias either arm.
  if (recentErrors.length >= 5001 || recentExposures.length >= 5001) {
    return { rolledBack: [] as string[] };
  }

  const rolledBack: string[] = [];

  for (const flag of activeFlags) {
    if (flag.rolloutPercent <= 0) continue;

    const variants = [...new Set(parseFlagVariants(flag.variantsJson).map((item) => item.name))];
    // Avoid uncorrected multiple-comparison risk until multi-arm tests have adjusted bounds.
    if (variants.length !== 2 || !variants.includes("control")) continue;

    const exposures = recentExposures.filter((ex) => ex.flagKey === flag.key);
    const crashes = recentErrors.filter((error) => error.flagKey === flag.key);
    let triggeredSample: ReturnType<typeof summarizeFlagCrashSamples> | null = null;
    let triggeredDecision: ReturnType<typeof assessCrashRollback> | null = null;
    let triggeredVariant: string | null = null;

    for (const variant of variants) {
      if (variant === "control") continue;
      const sample = summarizeFlagCrashSamples(
        exposures.map(({ userHash, variant: exposureVariant }) => ({ userHash, variant: exposureVariant })),
        crashes.map(({ userHash, flagVariant }) => ({ userHash, variant: flagVariant || "control" })),
        variant,
      );
      const decision = assessCrashRollback({
        control: sample.control,
        treatment: sample.treatment,
        thresholdPercent: flag.crashRateThresholdPercent,
      });
      if (decision.shouldRollback) {
        triggeredSample = sample;
        triggeredDecision = decision;
        triggeredVariant = variant;
        break;
      }
    }

    if (triggeredSample && triggeredDecision && triggeredVariant) {
      const sample = triggeredSample;
      const decision = triggeredDecision;
      const nowIso = new Date().toISOString();
      const reason = `Auto-rolled back: variant ${triggeredVariant}: ${decision.reason} (${sample.treatment.crashedUsers}/${sample.treatment.exposedUsers} treatment users; ${sample.control.crashedUsers}/${sample.control.exposedUsers} control users)`;

      await db
        .update(featureFlags)
        .set({
          isEnabled: false,
          rolloutPercent: 0,
          status: "rolled_back",
          rollbackReason: reason,
          rolledBackAt: nowIso,
          updatedAt: nowIso,
        })
        .where(eq(featureFlags.id, flag.id));

      rolledBack.push(flag.key);

      const [proj] = await db.select().from(projects).where(eq(projects.id, projectId)).limit(1);
      if (proj) {
        await recordAuditEvent({
          userId: proj.userId,
          actorUsername: "flag-rollback-guard",
          organizationId: proj.organizationId,
          workspaceId: proj.workspaceId,
          projectId,
          action: "flag.auto_rolled_back",
          resourceType: "feature_flag",
          resourceId: flag.key,
          metadata: {
            reason,
            treatmentVariant: triggeredVariant,
            controlExposedUsers: sample.control.exposedUsers,
            controlCrashedUsers: sample.control.crashedUsers,
            treatmentExposedUsers: sample.treatment.exposedUsers,
            treatmentCrashedUsers: sample.treatment.crashedUsers,
            treatmentCrashRatePercent: decision.treatmentRatePercent,
            controlCrashRatePercent: decision.controlRatePercent,
            riskDifferenceLowerBoundPercent: decision.riskDifferenceLowerBoundPercent,
          },
        });

        const webhookConfig = await resolveDecryptedWebhookConfig(proj);
        await dispatchCrashAlerts(
          webhookConfig,
          {
            eventId: `flg_${flag.id}`,
            projectName: proj.name,
            projectSlug: proj.slug,
            errorName: `FeatureFlag Auto-Rollback: ${flag.key}`,
            message: reason,
            runtime: "feature-flag-guard",
            environment: "production",
            dashboardUrl: `${PUBLIC_APP_URL}/dashboard/flags?project=${proj.slug}`,
          }
        ).catch(() => {});
      }
    }
  }

  return { rolledBack };
}
