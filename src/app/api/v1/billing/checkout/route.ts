import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { createDodoCheckoutSession, type BillingSku } from "@/lib/billing/dodo";

export const dynamic = "force-dynamic";

const ALLOWED_SKUS = new Set<BillingSku>(["pro", "team", "extra_domain"]);

export async function POST(req: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Please sign in with GitHub first." }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const sku = body?.sku as BillingSku;

    if (!ALLOWED_SKUS.has(sku)) {
      return NextResponse.json({ error: "Invalid billing SKU" }, { status: 400 });
    }

    const origin = req.headers.get("origin") || "https://devpulse.ritualdev.in";
    const returnUrl = `${origin}/dashboard?billing=success&sku=${sku}`;

    const session = await createDodoCheckoutSession({
      userId: user.id,
      email: user.email,
      name: user.name || user.githubUsername,
      sku,
      returnUrl,
    });

    if (!session.ok || !session.checkoutUrl) {
      return NextResponse.json(
        {
          error:
            session.error ||
            "Dodo Payments SaaS billing products are not yet configured in environment variables.",
          needsEnvSetup: true,
        },
        { status: 503 }
      );
    }

    return NextResponse.json({
      success: true,
      checkoutUrl: session.checkoutUrl,
    });
  } catch (err: unknown) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to initialize checkout" },
      { status: 500 }
    );
  }
}
