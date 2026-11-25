import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/db";
import { users, userStorageConfigs } from "@/db/schema";
import { eq } from "drizzle-orm";
import { resolveUserStorageContext, getTierMeta, type StorageTier } from "@/lib/storage/quota";
import { headR2Bucket } from "@/lib/storage/r2";
import { getEffectiveEntitlements } from "@/lib/billing/plans";
import { recordAuditEvent } from "@/lib/security/audit";
import { encryptSecret, decryptSecret } from "@/lib/security/crypto";
import { validatePublicUrl } from "@/lib/security/ssrf";

export const dynamic = "force-dynamic";

function maskSecret(val?: string | null): string {
  if (!val) return "";
  if (val.length <= 6) return "••••••";
  return `••••••••${val.slice(-4)}`;
}

export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const ctx = await resolveUserStorageContext(user.id);
    const [rawConfig] = await db
      .select()
      .from(userStorageConfigs)
      .where(eq(userStorageConfigs.userId, user.id))
      .limit(1);

    const plainAccess = rawConfig?.accessKeyEncrypted
      ? await decryptSecret(rawConfig.accessKeyEncrypted).catch(() => null)
      : null;
    const plainSecret = rawConfig?.secretKeyEncrypted
      ? await decryptSecret(rawConfig.secretKeyEncrypted).catch(() => null)
      : null;

    return NextResponse.json({
      tier: ctx.tier,
      tierLabel: getTierMeta(ctx.tier).label,
      provider: ctx.provider,
      isByos: ctx.isByos,
      usedBytes: ctx.usedBytes,
      limitBytes: ctx.limitBytes,
      retentionDays: ctx.retentionDays,
      prefix: ctx.prefix,
      hostedR2Configured: !!ctx.credentials && !ctx.isByos,
      byos: {
        endpoint: rawConfig?.endpoint || "",
        bucketName: rawConfig?.bucketName || "",
        accessKeyMasked: maskSecret(plainAccess),
        secretKeyMasked: maskSecret(plainSecret),
        hasCredentials: Boolean(rawConfig?.accessKeyEncrypted && rawConfig?.secretKeyEncrypted),
      },
    });
  } catch (err: any) {
    console.error("GET /api/v1/storage/config error:", err);
    return NextResponse.json(
      { error: "Failed to load storage config", details: err?.message },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const {
      storageTier,
      provider,
      endpoint,
      bucketName,
      accessKeyId,
      secretAccessKey,
      testConnection,
    } = body;

    const entitlements = getEffectiveEntitlements({ storageTier: user.storageTier });

    // Only allow downgrade to Free self-serve; paid upgrades require Dodo Payments checkout
    if (storageTier === "free") {
      const tierMeta = getTierMeta("free");
      await db
        .update(users)
        .set({
          storageTier: "free",
          updatedAt: new Date().toISOString(),
        })
        .where(eq(users.id, user.id));

      await resolveUserStorageContext(user.id);
      await db
        .update(userStorageConfigs)
        .set({
          storageLimitBytes: tierMeta.limitBytes,
          updatedAt: new Date().toISOString(),
        })
        .where(eq(userStorageConfigs.userId, user.id));
    }

    const [existing] = await db
      .select()
      .from(userStorageConfigs)
      .where(eq(userStorageConfigs.userId, user.id))
      .limit(1);

    const nextProvider =
      provider && ["devpulse_r2", "byos_r2", "byos_s3"].includes(provider)
        ? provider
        : existing?.provider || "devpulse_r2";

    if ((nextProvider === "byos_r2" || nextProvider === "byos_s3") && !entitlements.allowByos) {
      return NextResponse.json(
        {
          error: "Bring Your Own Storage (BYOS R2 / S3) requires a Team / Studio ($49/mo) subscription.",
          code: "BYOS_UPGRADE_REQUIRED",
        },
        { status: 402 }
      );
    }

    const nextEndpoint = endpoint !== undefined ? String(endpoint).trim() : existing?.endpoint || null;
    if ((nextProvider === "byos_r2" || nextProvider === "byos_s3") && nextEndpoint) {
      const endpointCheck = validatePublicUrl(nextEndpoint, { allowHttp: false });
      if (!endpointCheck.valid) {
        return NextResponse.json(
          { error: `Invalid BYOS endpoint: ${endpointCheck.reason}` },
          { status: 400 }
        );
      }
    }
    const nextBucket = bucketName !== undefined ? String(bucketName).trim() : existing?.bucketName || null;
    const plainAccessKey =
      accessKeyId && !String(accessKeyId).startsWith("••")
        ? String(accessKeyId).trim()
        : await decryptSecret(existing?.accessKeyEncrypted);
    const plainSecretKey =
      secretAccessKey && !String(secretAccessKey).startsWith("••")
        ? String(secretAccessKey).trim()
        : await decryptSecret(existing?.secretKeyEncrypted);

    if (testConnection) {
      if (!nextEndpoint || !nextBucket || !plainAccessKey || !plainSecretKey) {
        return NextResponse.json(
          { error: "Endpoint, Bucket Name, Access Key, and Secret Key are required to test BYOS." },
          { status: 400 }
        );
      }

      const ok = await headR2Bucket({
        endpoint: nextEndpoint,
        bucketName: nextBucket,
        accessKeyId: plainAccessKey,
        secretAccessKey: plainSecretKey,
      });

      if (!ok) {
        return NextResponse.json(
          { error: "Could not connect to BYOS bucket. Verify endpoint, bucket name, and S3/R2 keys." },
          { status: 400 }
        );
      }
    }

    const encryptedAccessKey = await encryptSecret(plainAccessKey);
    const encryptedSecretKey = await encryptSecret(plainSecretKey);

    await resolveUserStorageContext(user.id);
    await db
      .update(userStorageConfigs)
      .set({
        provider: nextProvider,
        endpoint: nextEndpoint,
        bucketName: nextBucket,
        accessKeyEncrypted: encryptedAccessKey,
        secretKeyEncrypted: encryptedSecretKey,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(userStorageConfigs.userId, user.id));

    const updatedCtx = await resolveUserStorageContext(user.id);

    await recordAuditEvent({
      userId: user.id,
      actorUsername: user.githubUsername,
      action: "storage.config_updated",
      resourceType: "storage_config",
      resourceId: user.id,
      headers: req.headers,
      metadata: { provider: updatedCtx.provider, isByos: updatedCtx.isByos },
    });

    return NextResponse.json({
      success: true,
      message: testConnection ? "BYOS bucket verified and connected!" : "Storage settings updated.",
      tier: updatedCtx.tier,
      provider: updatedCtx.provider,
      isByos: updatedCtx.isByos,
      usedBytes: updatedCtx.usedBytes,
      limitBytes: updatedCtx.limitBytes,
      retentionDays: updatedCtx.retentionDays,
    });
  } catch (err: any) {
    console.error("POST /api/v1/storage/config error:", err);
    return NextResponse.json(
      { error: "Failed to save storage config", details: err?.message },
      { status: 500 }
    );
  }
}
