import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/db";
import {
  users,
  projects,
  userCustomDomains,
  userStorageConfigs,
  billingEvents,
  projectConnectors,
  errorEvents,
  pageviews,
  structuredLogs,
  organizationMembers,
} from "@/db/schema";
import { and, eq, desc, gte, inArray, sql } from "drizzle-orm";
import { PLANS, ADDONS, getEffectiveEntitlements, getPlanQuotas } from "@/lib/billing/plans";
import { fetchDodoCustomerPayments } from "@/lib/billing/dodo";
import { apiError } from "@/lib/security/api-error";

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

    const userProjects = await db
      .select({ id: projects.id, organizationId: projects.organizationId })
      .from(projects)
      .where(eq(projects.userId, user.id));
    const projectCount = userProjects.length;
    const projectIds = userProjects.map((p) => p.id);
    const orgIds = Array.from(
      new Set(userProjects.map((p) => p.organizationId).filter(Boolean))
    ) as string[];

    const monthStartIso = `${new Date().toISOString().slice(0, 7)}-01T00:00:00.000Z`;
    let packageConnectorCount = 0;
    let heartbeatCount = 0;
    let monthlyEventCount = 0;
    let seatCount = 1;

    if (projectIds.length > 0) {
      const [pkgRes, hbRes, errRes, pvRes, logRes] = await Promise.all([
        db
          .select({ cnt: sql<number>`count(*)` })
          .from(projectConnectors)
          .where(
            and(
              inArray(projectConnectors.projectId, projectIds),
              eq(projectConnectors.category, "package")
            )
          ),
        db
          .select({ cnt: sql<number>`count(*)` })
          .from(projectConnectors)
          .where(
            and(
              inArray(projectConnectors.projectId, projectIds),
              eq(projectConnectors.provider, "cron_heartbeat")
            )
          ),
        db
          .select({ cnt: sql<number>`count(*)` })
          .from(errorEvents)
          .where(
            and(
              inArray(errorEvents.projectId, projectIds),
              gte(errorEvents.createdAt, monthStartIso)
            )
          ),
        db
          .select({ cnt: sql<number>`count(*)` })
          .from(pageviews)
          .where(
            and(
              inArray(pageviews.projectId, projectIds),
              gte(pageviews.createdAt, monthStartIso)
            )
          ),
        db
          .select({ cnt: sql<number>`count(*)` })
          .from(structuredLogs)
          .where(
            and(
              inArray(structuredLogs.projectId, projectIds),
              gte(structuredLogs.createdAt, monthStartIso)
            )
          ),
      ]);
      packageConnectorCount = Number(pkgRes[0]?.cnt || 0);
      heartbeatCount = Number(hbRes[0]?.cnt || 0);
      monthlyEventCount =
        Number(errRes[0]?.cnt || 0) +
        Number(pvRes[0]?.cnt || 0) +
        Number(logRes[0]?.cnt || 0);
    }

    if (orgIds.length > 0) {
      const [memberRes] = await db
        .select({ cnt: sql<number>`count(*)` })
        .from(organizationMembers)
        .where(inArray(organizationMembers.organizationId, orgIds));
      seatCount = Math.max(1, Number(memberRes?.cnt || 1));
    }

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
        packageConnectorCount,
        heartbeatCount,
        monthlyEventCount,
        seatCount,
      },
      quotas: getPlanQuotas(entitlements.plan.id),
      catalog: {
        plans: Object.values(PLANS),
        addons: Object.values(ADDONS),
      },
      invoices: mergedInvoices,
    });
  } catch (err: any) {
    console.error("GET /api/v1/billing error:", err);
    return apiError(err, "Failed to load billing profile", 500);
  }
}
