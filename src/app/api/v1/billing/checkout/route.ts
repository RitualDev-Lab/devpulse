import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/db";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";
import type { BillingItemKey } from "@/lib/billing/plans";
import { createDodoCheckoutSession } from "@/lib/billing/dodo";

export const dynamic = "force-dynamic";

const ALLOWED_ITEMS = new Set<BillingItemKey>([
  "pro",
  "team",
  "extra_domain",
  "extra_storage",
]);

export async function POST(req: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const itemKey = String(body.itemKey || "").trim() as BillingItemKey;
    const quantity = Math.max(1, Math.min(20, Number(body.quantity || 1)));

    if (!ALLOWED_ITEMS.has(itemKey)) {
      return NextResponse.json(
        { error: "Invalid billing itemKey. Choose pro, team, extra_domain, or extra_storage." },
        { status: 400 }
      );
    }

    const [userRow] = await db
      .select({
        email: users.email,
        name: users.name,
        dodoCustomerId: users.dodoCustomerId,
      })
      .from(users)
      .where(eq(users.id, user.id))
      .limit(1);

    const origin =
      req.headers.get("origin") ||
      (process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "") ?? "https://devpulse.ritualdev.in");

    const returnUrl = `${origin}/dashboard?billing=success&item=${encodeURIComponent(itemKey)}`;

    const session = await createDodoCheckoutSession({
      itemKey,
      quantity,
      userId: user.id,
      userEmail: userRow?.email || user.email,
      userName: userRow?.name || user.name || user.githubUsername,
      dodoCustomerId: userRow?.dodoCustomerId || null,
      returnUrl,
    });

    return NextResponse.json({
      success: true,
      checkoutUrl: session.checkoutUrl,
      sessionId: session.sessionId,
      itemKey,
      quantity,
    });
  } catch (err: any) {
    console.error("POST /api/v1/billing/checkout error:", err);
    return NextResponse.json(
      { error: err?.message || "Failed to initialize Dodo checkout session" },
      { status: 500 }
    );
  }
}
