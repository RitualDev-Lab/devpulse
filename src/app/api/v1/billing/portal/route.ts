import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/db";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";
import { createDodoCustomerPortalSession } from "@/lib/billing/dodo";
import { apiError } from "@/lib/security/api-error";
import { PUBLIC_APP_URL } from "@/lib/config/app-url";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const [userRow] = await db
      .select({
        dodoCustomerId: users.dodoCustomerId,
        stripeCustomerId: users.stripeCustomerId,
      })
      .from(users)
      .where(eq(users.id, user.id))
      .limit(1);

    // 1. Primary: Dodo Payments Customer Portal
    if (userRow?.dodoCustomerId) {
      const portalUrl = await createDodoCustomerPortalSession(userRow.dodoCustomerId);
      return NextResponse.json({ success: true, provider: "dodo", portalUrl });
    }

    // 2. Fallback: Stripe Billing Portal if configured for legacy/enterprise Stripe customer
    if (userRow?.stripeCustomerId && process.env.STRIPE_SECRET_KEY) {
      const origin = req.headers.get("origin") || `${PUBLIC_APP_URL}`;
      const formBody = new URLSearchParams({
        customer: userRow.stripeCustomerId,
        return_url: `${origin}/dashboard`,
      });
      const res = await fetch("https://api.stripe.com/v1/billing_portal/sessions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: formBody.toString(),
      });
      if (res.ok) {
        const stripeSession = (await res.json()) as { url?: string };
        if (stripeSession.url) {
          return NextResponse.json({
            success: true,
            provider: "stripe",
            portalUrl: stripeSession.url,
          });
        }
      }
    }

    return NextResponse.json(
      {
        error: "No active paid customer record found yet. Complete a plan upgrade first to access your Dodo billing portal.",
      },
      { status: 404 }
    );
  } catch (err: any) {
    console.error("POST /api/v1/billing/portal error:", err);
    return apiError(err, "Failed to open billing portal", 500);
  }
}
