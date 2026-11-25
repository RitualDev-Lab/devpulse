import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { users, userStorageConfigs } from "@/db/schema";
import { eq, sql } from "drizzle-orm";
import { verifyDodoWebhookSignature } from "@/lib/billing/dodo";
import { getPlanLimits } from "@/lib/billing/plans";
import { initDb } from "@/db/setup";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    await initDb();
    const secret = process.env.DODO_WEBHOOK_SECRET || "";
    const rawBody = await req.text();

    const verified = await verifyDodoWebhookSignature({
      rawBody,
      webhookId: req.headers.get("webhook-id"),
      webhookTimestamp: req.headers.get("webhook-timestamp"),
      webhookSignature: req.headers.get("webhook-signature"),
      secret,
    });

    if (!verified) {
      return NextResponse.json({ error: "Invalid webhook signature" }, { status: 401 });
    }

    const event = JSON.parse(rawBody);
    const eventType = String(event?.type || "");
    const payload = event?.data || {};
    const metadata = payload?.metadata || {};

    const userId = String(metadata?.user_id || "");
    const sku = String(metadata?.sku || "");
    const customerId = payload?.customer?.customer_id || payload?.customer_id || null;
    const subscriptionId = payload?.subscription_id || null;

    if (!userId) {
      return NextResponse.json({ received: true, skipped: "No metadata.user_id" });
    }

    if (
      eventType === "subscription.active" ||
      eventType === "subscription.renewed" ||
      eventType === "payment.succeeded"
    ) {
      if (sku === "extra_domain") {
        await db
          .update(users)
          .set({
            extraCustomDomains: sql`${users.extraCustomDomains} + 1`,
            dodoCustomerId: customerId,
            updatedAt: sql`(CURRENT_TIMESTAMP)`,
          })
          .where(eq(users.id, userId));
      } else if (sku === "pro" || sku === "team") {
        const limits = getPlanLimits(sku);
        await db
          .update(users)
          .set({
            storageTier: sku,
            dodoCustomerId: customerId,
            dodoSubscriptionId: subscriptionId,
            updatedAt: sql`(CURRENT_TIMESTAMP)`,
          })
          .where(eq(users.id, userId));

        await db
          .update(userStorageConfigs)
          .set({
            storageLimitBytes: limits.storageLimitBytes,
            updatedAt: sql`(CURRENT_TIMESTAMP)`,
          })
          .where(eq(userStorageConfigs.userId, userId));
      }
    } else if (
      eventType === "subscription.cancelled" ||
      eventType === "subscription.expired" ||
      eventType === "subscription.failed"
    ) {
      if (sku === "pro" || sku === "team" || !sku) {
        const freeLimits = getPlanLimits("free");
        await db
          .update(users)
          .set({
            storageTier: "free",
            updatedAt: sql`(CURRENT_TIMESTAMP)`,
          })
          .where(eq(users.id, userId));

        await db
          .update(userStorageConfigs)
          .set({
            storageLimitBytes: freeLimits.storageLimitBytes,
            updatedAt: sql`(CURRENT_TIMESTAMP)`,
          })
          .where(eq(userStorageConfigs.userId, userId));
      }
    }

    return NextResponse.json({ received: true, eventType });
  } catch (err: unknown) {
    console.error("Dodo webhook handler error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Webhook error" },
      { status: 500 }
    );
  }
}
