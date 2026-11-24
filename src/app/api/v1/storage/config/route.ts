import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/db";
import { users, userStorageConfigs } from "@/db/schema";
import { eq } from "drizzle-orm";
import { resolveUserStorageContext, getTierMeta, type StorageTier } from "@/lib/storage/quota";
import { headR2Bucket } from "@/lib/storage/r2";

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
        accessKeyMasked: maskSecret(rawConfig?.accessKeyEncrypted),
        secretKeyMasked: maskSecret(rawConfig?.secretKeyEncrypted),
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

    // Optional tier update
    if (storageTier && ["free", "pro", "team", "enterprise", "byos"].includes(storageTier)) {
      const tierMeta = getTierMeta(storageTier as StorageTier);
      await db
        .update(users)
        .set({
          storageTier: storageTier as StorageTier,
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

    const nextEndpoint = endpoint !== undefined ? String(endpoint).trim() : existing?.endpoint || null;
    const nextBucket = bucketName !== undefined ? String(bucketName).trim() : existing?.bucketName || null;
    const nextAccessKey =
      accessKeyId && !String(accessKeyId).startsWith("••")
        ? String(accessKeyId).trim()
        : existing?.accessKeyEncrypted || null;
    const nextSecretKey =
      secretAccessKey && !String(secretAccessKey).startsWith("••")
        ? String(secretAccessKey).trim()
        : existing?.secretKeyEncrypted || null;

    if (testConnection) {
      if (!nextEndpoint || !nextBucket || !nextAccessKey || !nextSecretKey) {
        return NextResponse.json(
          { error: "Endpoint, Bucket Name, Access Key, and Secret Key are required to test BYOS." },
          { status: 400 }
        );
      }

      const ok = await headR2Bucket({
        endpoint: nextEndpoint,
        bucketName: nextBucket,
        accessKeyId: nextAccessKey,
        secretAccessKey: nextSecretKey,
      });

      if (!ok) {
        return NextResponse.json(
          { error: "Could not connect to BYOS bucket. Verify endpoint, bucket name, and S3/R2 keys." },
          { status: 400 }
        );
      }
    }

    await resolveUserStorageContext(user.id);
    await db
      .update(userStorageConfigs)
      .set({
        provider: nextProvider,
        endpoint: nextEndpoint,
        bucketName: nextBucket,
        accessKeyEncrypted: nextAccessKey,
        secretKeyEncrypted: nextSecretKey,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(userStorageConfigs.userId, user.id));

    const updatedCtx = await resolveUserStorageContext(user.id);

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
