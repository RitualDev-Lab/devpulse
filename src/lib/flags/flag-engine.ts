import { db } from "@/db";
import { errorEvents, featureFlags, flagExposures, projects } from "@/db/schema";
import { and, eq, gte } from "drizzle-orm";
import { recordAuditEvent } from "@/lib/security/audit";
import { dispatchCrashAlerts, resolveDecryptedWebhookConfig } from "@/lib/alerts/webhook";
import { decryptSecret } from "@/lib/security/crypto";
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
 * Ties feature flag rollout % to live crash rate and auto-rolls back any active flag
 * whose correlated crash rate exceeds crashRateThresholdPercent.
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

  const cutoffIso = new Date(Date.now() - 60 * 60_000).toISOString();
  const [recentErrors, recentExposures] = await Promise.all([
    db
      .select({ id: errorEvents.id, flagKey: errorEvents.flagKey })
      .from(errorEvents)
      .where(and(eq(errorEvents.projectId, projectId), gte(errorEvents.createdAt, cutoffIso)))
      .limit(500),
    db
      .select({ id: flagExposures.id, flagKey: flagExposures.flagKey })
      .from(flagExposures)
      .where(and(eq(flagExposures.projectId, projectId), gte(flagExposures.createdAt, cutoffIso)))
      .limit(1000),
  ]);

  const rolledBack: string[] = [];

  for (const flag of activeFlags) {
    if (flag.rolloutPercent <= 0) continue;

    const taggedCrashes = recentErrors.filter((e) => e.flagKey === flag.key).length;
    const exposures = Math.max(
      1,
      recentExposures.filter((ex) => ex.flagKey === flag.key).length
    );
    const crashRatePct = (taggedCrashes / exposures) * 100;

    if (taggedCrashes >= 2 && crashRatePct > flag.crashRateThresholdPercent) {
      const nowIso = new Date().toISOString();
      const reason = `Auto-rolled back: ${taggedCrashes} crash(es) across ${exposures} exposure(s) (${crashRatePct.toFixed(1)}% > ${flag.crashRateThresholdPercent}% limit)`;

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
          metadata: { taggedCrashes, exposures, crashRatePct, reason },
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
