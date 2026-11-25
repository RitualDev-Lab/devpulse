import { db } from "@/db";
import { users, userStorageConfigs } from "@/db/schema";
import { eq, sql } from "drizzle-orm";
import { getHostedR2Credentials, type R2Credentials } from "./r2";
import { decryptSecret } from "@/lib/security/crypto";

export type StorageTier = "free" | "pro" | "team" | "enterprise" | "byos";

export const TIER_QUOTAS: Record<
  StorageTier,
  { limitBytes: number; retentionDays: number | null; prefix: string; label: string }
> = {
  free: {
    limitBytes: 100 * 1024 * 1024, // 100 MB
    retentionDays: 7,
    prefix: "free",
    label: "Free (100 MB • 7-Day R2 Lifecycle)",
  },
  pro: {
    limitBytes: 5 * 1024 * 1024 * 1024, // 5 GB
    retentionDays: 90,
    prefix: "pro",
    label: "Pro (5 GB • 90-Day R2 Lifecycle)",
  },
  team: {
    limitBytes: 50 * 1024 * 1024 * 1024, // 50 GB
    retentionDays: null,
    prefix: "enterprise",
    label: "Team / Enterprise (50 GB + BYOS)",
  },
  enterprise: {
    limitBytes: 50 * 1024 * 1024 * 1024, // 50 GB
    retentionDays: null,
    prefix: "enterprise",
    label: "Team / Enterprise (50 GB + BYOS)",
  },
  byos: {
    limitBytes: 50 * 1024 * 1024 * 1024, // 50 GB + BYOS
    retentionDays: null,
    prefix: "enterprise",
    label: "BYOS (Bring Your Own Storage)",
  },
};

export interface ResolvedStorageContext {
  userId: string;
  tier: StorageTier;
  provider: "devpulse_r2" | "byos_r2" | "byos_s3" | "byos_supabase";
  isByos: boolean;
  usedBytes: number;
  limitBytes: number;
  retentionDays: number | null;
  prefix: string;
  credentials: R2Credentials | null;
}

export function getTierMeta(tier?: string | null) {
  const normalized = (tier || "free").toLowerCase() as StorageTier;
  return TIER_QUOTAS[normalized] || TIER_QUOTAS.free;
}

/**
 * Ensures a user_storage_configs row exists and resolves their active storage target (Hosted R2 vs BYOS).
 */
export async function resolveUserStorageContext(userId: string): Promise<ResolvedStorageContext> {
  const [userRow] = await db
    .select({
      id: users.id,
      storageTier: users.storageTier,
      extraStorageGb: users.extraStorageGb,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  const tier = ((userRow?.storageTier || "free").toLowerCase() as StorageTier) in TIER_QUOTAS
    ? (userRow?.storageTier as StorageTier)
    : "free";
  const tierMeta = getTierMeta(tier);
  const extraBytes = Math.max(0, Number(userRow?.extraStorageGb || 0)) * 1024 * 1024 * 1024;
  const computedLimitBytes = tierMeta.limitBytes + extraBytes;

  let [config] = await db
    .select()
    .from(userStorageConfigs)
    .where(eq(userStorageConfigs.userId, userId))
    .limit(1);

  if (!config) {
    const newId = `stg_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
    try {
      await db.insert(userStorageConfigs).values({
        id: newId,
        userId,
        provider: "devpulse_r2",
        storageUsedBytes: 0,
        storageLimitBytes: computedLimitBytes,
      });
      [config] = await db
        .select()
        .from(userStorageConfigs)
        .where(eq(userStorageConfigs.userId, userId))
        .limit(1);
    } catch {
      // Handle race condition if another concurrent request inserted first
      [config] = await db
        .select()
        .from(userStorageConfigs)
        .where(eq(userStorageConfigs.userId, userId))
        .limit(1);
    }
  }

  const provider = config?.provider || "devpulse_r2";
  const isByos =
    (provider === "byos_r2" || provider === "byos_s3") &&
    !!config?.endpoint &&
    !!config?.bucketName &&
    !!config?.accessKeyEncrypted &&
    !!config?.secretKeyEncrypted;

  let credentials: R2Credentials | null = null;
  if (isByos && config) {
    const decryptedAccess = await decryptSecret(config.accessKeyEncrypted);
    const decryptedSecret = await decryptSecret(config.secretKeyEncrypted);
    if (decryptedAccess && decryptedSecret) {
      credentials = {
        endpoint: config.endpoint!,
        bucketName: config.bucketName!,
        accessKeyId: decryptedAccess,
        secretAccessKey: decryptedSecret,
      };
    }
  } else {
    credentials = getHostedR2Credentials();
  }

  const effectiveLimit = Math.max(config?.storageLimitBytes || 0, computedLimitBytes);

  return {
    userId,
    tier,
    provider: isByos ? (provider as "byos_r2" | "byos_s3") : "devpulse_r2",
    isByos,
    usedBytes: config?.storageUsedBytes || 0,
    limitBytes: effectiveLimit,
    retentionDays: isByos ? null : tierMeta.retentionDays,
    prefix: isByos ? "byos" : tierMeta.prefix,
    credentials,
  };
}

export interface QuotaReservationResult {
  allowed: boolean;
  reason?: string;
  context: ResolvedStorageContext;
}

/**
 * Storage Quota & Metering Guard:
 * Checks whether the user can store `bytesNeeded` and atomically increments `storage_used_bytes`.
 */
export async function checkAndReserveStorageQuota(
  userId: string,
  bytesNeeded: number
): Promise<QuotaReservationResult> {
  const ctx = await resolveUserStorageContext(userId);
  const safeBytes = Math.max(0, Math.ceil(bytesNeeded));

  if (!ctx.credentials) {
    return {
      allowed: false,
      reason: "R2 storage credentials are not configured on this environment.",
      context: ctx,
    };
  }

  // Enforce hosted quota unless user is routing to their own BYOS bucket
  if (!ctx.isByos && ctx.usedBytes + safeBytes > ctx.limitBytes) {
    return {
      allowed: false,
      reason: `Storage quota exceeded (${formatBytes(ctx.usedBytes)} / ${formatBytes(ctx.limitBytes)} on ${ctx.tier.toUpperCase()} tier). Upgrade plan or connect BYOS bucket.`,
      context: ctx,
    };
  }

  if (safeBytes > 0) {
    await db
      .update(userStorageConfigs)
      .set({
        storageUsedBytes: sql`${userStorageConfigs.storageUsedBytes} + ${safeBytes}`,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(userStorageConfigs.userId, userId));
  }

  return {
    allowed: true,
    context: {
      ...ctx,
      usedBytes: ctx.usedBytes + safeBytes,
    },
  };
}

export function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  let val = bytes;
  while (val >= 1024 && i < units.length - 1) {
    val /= 1024;
    i++;
  }
  return `${val >= 10 || i === 0 ? Math.round(val) : val.toFixed(1)} ${units[i]}`;
}
