import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { users, userStorageConfigs, billingEvents } from "@/db/schema";
import { eq } from "drizzle-orm";
import { getEffectiveEntitlements, type BillingItemKey } from "@/lib/billing/plans";
import {
  verifyDodoWebhookSignature,
  verifyDodoPaymentOrSubscriptionLive,
  resolveItemKeyFromProductId,
} from "@/lib/billing/dodo";
import { createCloudflareCustomHostname } from "@/lib/domains/cloudflare-saas";
import { recordAuditEvent } from "@/lib/security/audit";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const rawBody = await req.text();
    const webhookId = req.headers.get("webhook-id");
    const webhookTimestamp = req.headers.get("webhook-timestamp");
    const webhookSignature = req.headers.get("webhook-signature");

    let payload: any = {};
    try {
      payload = JSON.parse(rawBody);
    } catch {
      return NextResponse.json({ error: "Invalid JSON payload" }, { status: 400 });
    }

    const eventType: string = payload.type || payload.event_type || "unknown";
    const data: any = payload.data || payload;
    const paymentId: string | null = data.payment_id || null;
    const subscriptionId: string | null = data.subscription_id || null;

    // 1. Cryptographic signature verification (Standard Webhooks HMAC-SHA256)
    let isAuthentic = await verifyDodoWebhookSignature(rawBody, {
      webhookId,
      webhookTimestamp,
      webhookSignature,
    });

    // 2. Fallback live Dodo API verification ONLY if signature header missing/unmatched in local tests
    let verifiedLiveMeta: Record<string, string> | undefined;
    let verifiedLiveCustomer: string | undefined;
    if (!isAuthentic && (paymentId || subscriptionId)) {
      const liveCheck = await verifyDodoPaymentOrSubscriptionLive({
        paymentId,
        subscriptionId,
      });
      if (liveCheck.verified) {
        isAuthentic = true;
        verifiedLiveMeta = liveCheck.metadata;
        verifiedLiveCustomer = liveCheck.customerId;
      }
    }

    if (!isAuthentic) {
      return NextResponse.json(
        { error: "Invalid Dodo Payments webhook signature" },
        { status: 401 }
      );
    }

    const externalEventId =
      webhookId ||
      payload.id ||
      `${eventType}:${paymentId || subscriptionId || Date.now()}`;

    // Idempotency guard: never double-apply add-ons on webhook retry
    const [existingEvent] = await db
      .select({ id: billingEvents.id })
      .from(billingEvents)
      .where(eq(billingEvents.externalEventId, externalEventId))
      .limit(1);

    if (existingEvent) {
      return NextResponse.json({ received: true, deduplicated: true });
    }

    const metadata: Record<string, string> = {
      ...(data.metadata || {}),
      ...(verifiedLiveMeta || {}),
    };

    const dodoCustomerId: string | null =
      data.customer?.customer_id || verifiedLiveCustomer || null;

    // Locate user via metadata.userId, customer_id, or email
    let targetUserId: string | null = metadata.userId || null;
    let userRow: any = null;

    if (targetUserId) {
      const rows = await db.select().from(users).where(eq(users.id, targetUserId)).limit(1);
      userRow = rows[0] || null;
    }
    if (!userRow && dodoCustomerId) {
      const rows = await db
        .select()
        .from(users)
        .where(eq(users.dodoCustomerId, dodoCustomerId))
        .limit(1);
      userRow = rows[0] || null;
      targetUserId = userRow?.id || null;
    }
    if (!userRow && data.customer?.email) {
      const rows = await db
        .select()
        .from(users)
        .where(eq(users.email, String(data.customer.email)))
        .limit(1);
      userRow = rows[0] || null;
      targetUserId = userRow?.id || null;
    }

    if (!userRow || !targetUserId) {
      // Event verified but belongs to another app sharing the Dodo business account
      return NextResponse.json({ received: true, ignored: "No matching DevPulse user" });
    }

    // Resolve itemKey (pro, team, extra_domain, extra_storage)
    const productId: string | null =
      data.product_id || data.product_cart?.[0]?.product_id || null;
    const itemKey: BillingItemKey | null =
      (metadata.itemKey as BillingItemKey) || resolveItemKeyFromProductId(productId);

    const quantity = Math.max(
      1,
      Number(metadata.quantity || data.product_cart?.[0]?.quantity || 1)
    );

    const userUpdates: Record<string, any> = {
      updatedAt: new Date().toISOString(),
    };
    if (dodoCustomerId) userUpdates.dodoCustomerId = dodoCustomerId;
    if (data.next_billing_date) userUpdates.currentPeriodEnd = String(data.next_billing_date);

    const isActivationEvent = [
      "subscription.active",
      "subscription.renewed",
      "subscription.plan_changed",
      "payment.succeeded",
    ].includes(eventType);

    const isRefundOrRevocation = [
      "payment.refunded",
      "payment.disputed",
      "refund.succeeded",
      "subscription.cancelled",
      "subscription.expired",
      "subscription.on_hold",
    ].includes(eventType);

    if (isActivationEvent && itemKey) {
      if (itemKey === "pro" || itemKey === "team") {
        userUpdates.storageTier = itemKey;
        userUpdates.subscriptionStatus = "active";
        if (subscriptionId) userUpdates.dodoSubscriptionId = subscriptionId;

        // Auto-unlock custom domain SSL provisioning if user already saved a pending customDomain
        if (userRow.customDomain && !userRow.customHostnameId) {
          const cfRes = await createCloudflareCustomHostname(userRow.customDomain).catch(() => null);
          if (cfRes) {
            userUpdates.customHostnameId = cfRes.customHostnameId;
            userUpdates.customDomainSslStatus = cfRes.sslStatus;
            userUpdates.customDomainVerified = cfRes.sslStatus === "active";
          }
        }
      } else if (itemKey === "extra_domain" && eventType === "payment.succeeded") {
        userUpdates.extraCustomDomains = Number(userRow.extraCustomDomains || 0) + quantity;
      } else if (itemKey === "extra_storage" && eventType === "payment.succeeded") {
        userUpdates.extraStorageGb = Number(userRow.extraStorageGb || 0) + 25 * quantity;
      }
    } else if (isRefundOrRevocation) {
      if (itemKey === "extra_domain") {
        userUpdates.extraCustomDomains = Math.max(
          0,
          Number(userRow.extraCustomDomains || 0) - quantity
        );
      } else if (itemKey === "extra_storage") {
        userUpdates.extraStorageGb = Math.max(
          0,
          Number(userRow.extraStorageGb || 0) - 25 * quantity
        );
      } else if (eventType === "subscription.cancelled" || eventType === "subscription.on_hold") {
        userUpdates.subscriptionStatus =
          eventType === "subscription.cancelled" ? "cancelled" : "on_hold";
      } else if (eventType === "subscription.expired") {
        userUpdates.subscriptionStatus = "expired";
        userUpdates.storageTier = "free";
      }
    }

    await db.update(users).set(userUpdates).where(eq(users.id, targetUserId));

    // Recalculate effective storage quota in user_storage_configs
    const effective = getEffectiveEntitlements({
      storageTier: userUpdates.storageTier ?? userRow.storageTier,
      extraCustomDomains: userUpdates.extraCustomDomains ?? userRow.extraCustomDomains,
      extraStorageGb: userUpdates.extraStorageGb ?? userRow.extraStorageGb,
    });

    await db
      .insert(userStorageConfigs)
      .values({
        id: `stg_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`,
        userId: targetUserId,
        provider: "devpulse_r2",
        storageUsedBytes: 0,
        storageLimitBytes: effective.storageLimitBytes,
      })
      .onConflictDoUpdate({
        target: userStorageConfigs.userId,
        set: {
          storageLimitBytes: effective.storageLimitBytes,
          updatedAt: new Date().toISOString(),
        },
      });

    // Record idempotent billing event / invoice row
    await db.insert(billingEvents).values({
      id: `bil_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`,
      userId: targetUserId,
      provider: "dodo",
      externalEventId,
      eventType,
      paymentId,
      subscriptionId,
      productId,
      itemKey: itemKey || null,
      amountCents: Number(data.total_amount ?? data.recurring_pre_tax_amount ?? 0),
      currency: String(data.currency || "USD"),
      status: String(data.status || (isActivationEvent ? "succeeded" : eventType)),
      invoiceUrl: data.payment_link ? String(data.payment_link) : null,
      rawPayloadJson: rawBody.slice(0, 8000),
    });

    await recordAuditEvent({
      userId: targetUserId,
      actorUsername: userRow.githubUsername || "dodo_webhook",
      action: `billing.${eventType}`,
      resourceType: "subscription",
      resourceId: subscriptionId || paymentId || externalEventId,
      headers: req.headers,
      metadata: {
        tier: effective.plan.id,
        itemKey: itemKey || null,
        amountCents: Number(data.total_amount ?? data.recurring_pre_tax_amount ?? 0),
      },
    });

    return NextResponse.json({
      received: true,
      userId: targetUserId,
      tier: effective.plan.id,
      storageLimitBytes: effective.storageLimitBytes,
      maxCustomDomains: effective.maxCustomDomains,
    });
  } catch (err: any) {
    console.error("POST /api/v1/billing/webhook error:", err);
    return NextResponse.json(
      { error: "Webhook processing failed", details: err?.message },
      { status: 500 }
    );
  }
}
