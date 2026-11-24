import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/db";
import { users, projects, userCustomDomains, userStorageConfigs, billingEvents } from "@/db/schema";
import { eq, desc, sql } from "drizzle-orm";
import { PLANS, ADDONS, getEffectiveEntitlements } from "@/lib/billing/plans";
import { fetchDodoCustomerPayments } from "@/lib/billing/dodo";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const [userRow] = await db
      .select()
      .from(users)
      .where(eq(users.id, user.id))
      .limit(1);

    const [{ projectCount }] = await db
      .select({ projectCount: sql<number>`count(*)` })
      .from(projects)
      .where(eq(projects.userId, user.id));

    const extraDomains = await db
      .select({ domain: userCustomDomains.domain })
      .from(userCustomDomains)
      .where(eq(userCustomDomains.userId, user.id));

    const uniqueCustomDomains = new Set(
      [userRow?.customDomain, ...extraDomains.map((d) => d.domain)].filter(Boolean)
    );

    const [storageRow] = await db
      .select()
      .from(userStorageConfigs)
      .where(eq(userStorageConfigs.userId, user.id))
      .limit(1);

    const entitlements = getEffectiveEntitlements({
      storageTier: userRow?.storageTier || user.storageTier || "free",
      extraCustomDomains: userRow?.extraCustomDomains || 0,
      extraStorageGb: userRow?.extraStorageGb || 0,
    });

    const recordedEvents = await db
      .select({
        id: billingEvents.id,
        provider: billingEvents.provider,
        eventType: billingEvents.eventType,
        paymentId: billingEvents.paymentId,
        subscriptionId: billingEvents.subscriptionId,
        itemKey: billingEvents.itemKey,
        amountCents: billingEvents.amountCents,
        currency: billingEvents.currency,
        status: billingEvents.status,
        invoiceUrl: billingEvents.invoiceUrl,
        createdAt: billingEvents.createdAt,
      })
      .from(billingEvents)
      .where(eq(billingEvents.userId, user.id))
      .orderBy(desc(billingEvents.createdAt))
      .limit(20);

    // Also pull live Dodo Payments invoices if customer exists
    const livePayments = userRow?.dodoCustomerId
      ? await fetchDodoCustomerPayments(userRow.dodoCustomerId)
      : [];

    const seenPaymentIds = new Set(recordedEvents.map((e) => e.paymentId).filter(Boolean));
    const mergedInvoices = [
      ...recordedEvents,
      ...livePayments
        .filter((p) => !seenPaymentIds.has(p.payment_id))
        .map((p) => ({
          id: p.payment_id,
          provider: "dodo" as const,
          eventType: "payment.succeeded",
          paymentId: p.payment_id,
          subscriptionId: p.subscription_id || null,
          itemKey: null,
          amountCents: p.total_amount,
          currency: p.currency,
          status: p.status,
          invoiceUrl: p.payment_link || null,
          createdAt: p.created_at,
        })),
    ];

    return NextResponse.json({
      tier: entitlements.plan.id,
      plan: entitlements.plan,
      subscriptionStatus: userRow?.subscriptionStatus || "active",
      currentPeriodEnd: userRow?.currentPeriodEnd || null,
      hasDodoCustomer: Boolean(userRow?.dodoCustomerId),
      hasStripeCustomer: Boolean(userRow?.stripeCustomerId && process.env.STRIPE_SECRET_KEY),
      entitlements: {
        maxProjects: entitlements.maxProjects,
        maxSubdomains: entitlements.maxSubdomains,
        maxCustomDomains: entitlements.maxCustomDomains,
        extraCustomDomains: entitlements.extraCustomDomains,
        storageLimitBytes: entitlements.storageLimitBytes,
        extraStorageGb: entitlements.extraStorageGb,
        historyDays: entitlements.historyDays,
        allowCustomCss: entitlements.allowCustomCss,
        allowByos: entitlements.allowByos,
        allowWhiteLabel: entitlements.allowWhiteLabel,
        alertChannels: entitlements.alertChannels,
      },
      usage: {
        projectCount: Number(projectCount),
        customDomainCount: uniqueCustomDomains.size,
        storageUsedBytes: storageRow?.storageUsedBytes || 0,
      },
      catalog: {
        plans: Object.values(PLANS),
        addons: Object.values(ADDONS),
      },
      invoices: mergedInvoices,
    });
  } catch (err: any) {
    console.error("GET /api/v1/billing error:", err);
    return NextResponse.json(
      { error: "Failed to load billing profile", details: err?.message },
      { status: 500 }
    );
  }
}
