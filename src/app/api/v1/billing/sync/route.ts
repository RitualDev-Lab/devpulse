import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { userStorageConfigs, users } from "@/db/schema";
import { eq } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth";
import { getDodoApiBaseUrl, getDodoApiKey, resolveItemKeyFromProductId } from "@/lib/billing/dodo";
import { getEffectiveEntitlements, type PlanTier } from "@/lib/billing/plans";
import { recordAuditEvent } from "@/lib/security/audit";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const authUser = await getCurrentUser();
    if (!authUser) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.id, authUser.id))
      .limit(1);

    if (!user) {
      return NextResponse.json({ error: "User record not found" }, { status: 404 });
    }

    const syncReport: {
      dodo: { checked: boolean; customerId: string | null; subscriptionId: string | null; tierMatched: string | null };
      stripe: { checked: boolean; customerId: string | null; tierMatched: string | null };
      updatedTier: string;
    } = {
      dodo: {
        checked: false,
        customerId: user.dodoCustomerId || null,
        subscriptionId: user.dodoSubscriptionId || null,
        tierMatched: null,
      },
      stripe: {
        checked: false,
        customerId: user.stripeCustomerId || null,
        tierMatched: null,
      },
      updatedTier: user.storageTier,
    };

    let nextTier = user.storageTier as PlanTier;
    let nextDodoCustomerId = user.dodoCustomerId || null;
    let nextDodoSubId = user.dodoSubscriptionId || null;
    let nextStripeCustomerId = user.stripeCustomerId || null;
    let nextSubStatus = user.subscriptionStatus || "active";
    let nextPeriodEnd = user.currentPeriodEnd || null;

    // 1. Live Dodo Payments Customer & Subscription Sync
    const dodoKey = getDodoApiKey();
    if (dodoKey) {
      syncReport.dodo.checked = true;
      const base = getDodoApiBaseUrl();

      if (!nextDodoCustomerId && user.email) {
        const custRes = await fetch(
          `${base}/customers?email=${encodeURIComponent(user.email)}&page_size=5`,
          { headers: { Authorization: `Bearer ${dodoKey}` } }
        ).catch(() => null);
        if (custRes?.ok) {
          const custJson = (await custRes.json()) as { items?: Array<{ customer_id: string }> };
          if (custJson.items?.[0]?.customer_id) {
            nextDodoCustomerId = custJson.items[0].customer_id;
          }
        }
      }

      if (nextDodoCustomerId) {
        syncReport.dodo.customerId = nextDodoCustomerId;
        const subRes = await fetch(
          `${base}/subscriptions?customer_id=${encodeURIComponent(nextDodoCustomerId)}&page_size=10`,
          { headers: { Authorization: `Bearer ${dodoKey}` } }
        ).catch(() => null);
        if (subRes?.ok) {
          const subJson = (await subRes.json()) as {
            items?: Array<{
              subscription_id: string;
              product_id?: string;
              status?: string;
              next_billing_date?: string;
            }>;
          };
          const activeSub = (subJson.items || []).find((s) => s.status === "active") || subJson.items?.[0];
          if (activeSub) {
            nextDodoSubId = activeSub.subscription_id;
            syncReport.dodo.subscriptionId = nextDodoSubId;
            if (activeSub.next_billing_date) nextPeriodEnd = activeSub.next_billing_date;
            if (activeSub.status) nextSubStatus = activeSub.status;
            const itemKey = resolveItemKeyFromProductId(activeSub.product_id);
            if (itemKey === "pro" || itemKey === "team") {
              nextTier = itemKey;
              syncReport.dodo.tierMatched = itemKey;
            }
          }
        }
      }
    }

    // 2. Live Stripe Customer & Subscription Sync (when STRIPE_SECRET_KEY is configured)
    const stripeKey = process.env.STRIPE_SECRET_KEY?.trim();
    if (stripeKey && (nextStripeCustomerId || user.email)) {
      syncReport.stripe.checked = true;
      if (!nextStripeCustomerId && user.email) {
        const stCustRes = await fetch(
          `https://api.stripe.com/v1/customers?email=${encodeURIComponent(user.email)}&limit=1`,
          { headers: { Authorization: `Bearer ${stripeKey}` } }
        ).catch(() => null);
        if (stCustRes?.ok) {
          const stCust = (await stCustRes.json()) as { data?: Array<{ id: string }> };
          if (stCust.data?.[0]?.id) {
            nextStripeCustomerId = stCust.data[0].id;
          }
        }
      }

      if (nextStripeCustomerId) {
        syncReport.stripe.customerId = nextStripeCustomerId;
        const stSubRes = await fetch(
          `https://api.stripe.com/v1/subscriptions?customer=${encodeURIComponent(nextStripeCustomerId)}&limit=5`,
          { headers: { Authorization: `Bearer ${stripeKey}` } }
        ).catch(() => null);
        if (stSubRes?.ok) {
          const stSubJson = (await stSubRes.json()) as {
            data?: Array<{
              status?: string;
              current_period_end?: number;
              metadata?: { tier?: string };
            }>;
          };
          const active = (stSubJson.data || []).find((s) => s.status === "active" || s.status === "trialing");
          if (active) {
            nextSubStatus = active.status || "active";
            if (active.current_period_end) {
              nextPeriodEnd = new Date(active.current_period_end * 1000).toISOString();
            }
            if (active.metadata?.tier === "pro" || active.metadata?.tier === "team") {
              nextTier = active.metadata.tier;
              syncReport.stripe.tierMatched = active.metadata.tier;
            }
          }
        }
      }
    }

    await db
      .update(users)
      .set({
        storageTier: nextTier,
        dodoCustomerId: nextDodoCustomerId,
        dodoSubscriptionId: nextDodoSubId,
        stripeCustomerId: nextStripeCustomerId,
        subscriptionStatus: nextSubStatus,
        currentPeriodEnd: nextPeriodEnd,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(users.id, user.id));

    const entitlements = getEffectiveEntitlements({
      storageTier: nextTier,
      extraStorageGb: user.extraStorageGb || 0,
    });
    await db
      .update(userStorageConfigs)
      .set({
        storageLimitBytes: entitlements.storageLimitBytes,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(userStorageConfigs.userId, user.id));

    syncReport.updatedTier = nextTier;

    await recordAuditEvent({
      userId: user.id,
      actorUsername: user.githubUsername,
      action: "billing.customer_synced",
      resourceType: "billing",
      resourceId: nextDodoCustomerId || nextStripeCustomerId || user.id,
      headers: req.headers,
      metadata: syncReport,
    });

    return NextResponse.json({ success: true, syncReport });
  } catch (err: any) {
    console.error("POST /api/v1/billing/sync error:", err);
    return NextResponse.json({ error: "Customer sync failed" }, { status: 500 });
  }
}
