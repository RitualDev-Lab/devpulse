import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { userStorageConfigs } from "@/db/schema";
import { eq, sql } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth";
import { getPlanLimits } from "@/lib/billing/plans";
import { getUserStorageSummary } from "@/lib/storage/r2";
import { initDb } from "@/db/setup";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await initDb();
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const summary = await getUserStorageSummary(user.id);
    return NextResponse.json({ success: true, storage: summary });
  } catch (err: unknown) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to load storage summary" },
      { status: 500 }
    );
  }
}

export async function PUT(req: NextRequest) {
  try {
    await initDb();
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const limits = getPlanLimits(user.storageTier, user.extraCustomDomains);
    const body = await req.json().catch(() => ({}));
    const provider = String(body?.provider || "devpulse_r2");

    if (provider !== "devpulse_r2" && !limits.allowByos) {
      return NextResponse.json(
        {
          error: "Bring Your Own R2/S3 Storage (BYOS) requires Developer Pro ($14/mo) or Team ($49/mo).",
          upgradeRequired: true,
        },
        { status: 403 }
      );
    }

    await getUserStorageSummary(user.id);

    if (provider === "devpulse_r2") {
      await db
        .update(userStorageConfigs)
        .set({
          provider: "devpulse_r2",
          bucketName: null,
          endpoint: null,
          accessKeyEncrypted: null,
          secretKeyEncrypted: null,
          updatedAt: sql`(CURRENT_TIMESTAMP)`,
        })
        .where(eq(userStorageConfigs.userId, user.id));
    } else if (provider === "byos_r2" || provider === "byos_s3") {
      const bucketName = String(body?.bucketName || "").trim();
      const endpoint = String(body?.endpoint || "").trim();
      const accessKey = String(body?.accessKey || "").trim();
      const secretKey = String(body?.secretKey || "").trim();

      if (!bucketName || !endpoint || !accessKey || !secretKey) {
        return NextResponse.json(
          { error: "Bucket name, S3/R2 endpoint URL, Access Key ID, and Secret Key are required." },
          { status: 400 }
        );
      }

      await db
        .update(userStorageConfigs)
        .set({
          provider,
          bucketName,
          endpoint,
          accessKeyEncrypted: accessKey,
          secretKeyEncrypted: secretKey,
          updatedAt: sql`(CURRENT_TIMESTAMP)`,
        })
        .where(eq(userStorageConfigs.userId, user.id));
    } else {
      return NextResponse.json({ error: "Unsupported storage provider" }, { status: 400 });
    }

    const updated = await getUserStorageSummary(user.id);
    return NextResponse.json({ success: true, storage: updated });
  } catch (err: unknown) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to update storage config" },
      { status: 500 }
    );
  }
}
