import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/db";
import { users } from "@/db/schema";
import { eq, ne, and } from "drizzle-orm";
import {
  PRIMARY_PORTAL_DOMAIN,
  CUSTOM_DOMAIN_CNAME_TARGET,
  isPaidDomainTier,
  normalizeAndValidateSubdomain,
  normalizeAndValidateCustomDomain,
  createCloudflareCustomHostname,
  deleteCloudflareCustomHostname,
} from "@/lib/domains/cloudflare-saas";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const [row] = await db
      .select()
      .from(users)
      .where(eq(users.id, user.id))
      .limit(1);

    const subdomain = row?.subdomain || user.subdomain || user.githubUsername.toLowerCase();
    const tier = row?.storageTier || user.storageTier || "free";

    return NextResponse.json({
      subdomain,
      subdomainUrl: `https://${subdomain}.${PRIMARY_PORTAL_DOMAIN}`,
      portalPreviewPath: `/portal/${subdomain}`,
      primaryDomain: PRIMARY_PORTAL_DOMAIN,
      cnameTarget: CUSTOM_DOMAIN_CNAME_TARGET,
      tier,
      isPaidTier: isPaidDomainTier(tier),
      customDomain: row?.customDomain || null,
      customDomainVerified: row?.customDomainVerified || false,
      customHostnameId: row?.customHostnameId || null,
      customDomainSslStatus: row?.customDomainSslStatus || "pending",
      branding: {
        brandTitle: row?.brandTitle || "",
        brandDescription: row?.brandDescription || "",
        brandFaviconUrl: row?.brandFaviconUrl || "",
        brandOgImageUrl: row?.brandOgImageUrl || "",
        hidePoweredBy: row?.hidePoweredBy || false,
      },
    });
  } catch (err: any) {
    console.error("GET /api/v1/domains error:", err);
    return NextResponse.json(
      { error: "Failed to load domain configuration", details: err?.message },
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
      subdomain: rawSubdomain,
      customDomain: rawCustomDomain,
      brandTitle,
      brandDescription,
      brandFaviconUrl,
      brandOgImageUrl,
      hidePoweredBy,
    } = body;

    const [existingUser] = await db
      .select()
      .from(users)
      .where(eq(users.id, user.id))
      .limit(1);

    const tier = existingUser?.storageTier || user.storageTier || "free";
    const paidEligible = isPaidDomainTier(tier);

    const updates: Record<string, any> = {
      updatedAt: new Date().toISOString(),
    };

    // 1. Validate & assign free *.devpulse.ritualdev.in subdomain
    if (typeof rawSubdomain === "string" && rawSubdomain.trim()) {
      const check = normalizeAndValidateSubdomain(rawSubdomain);
      if (!check.valid) {
        return NextResponse.json({ error: check.error }, { status: 400 });
      }

      const [taken] = await db
        .select({ id: users.id })
        .from(users)
        .where(and(eq(users.subdomain, check.subdomain), ne(users.id, user.id)))
        .limit(1);

      if (taken) {
        return NextResponse.json(
          { error: `Subdomain "${check.subdomain}.devpulse.ritualdev.in" is already claimed.` },
          { status: 409 }
        );
      }
      updates.subdomain = check.subdomain;
    }

    // 2. White-labeling & SEO fields
    if (brandTitle !== undefined) {
      updates.brandTitle = String(brandTitle || "").trim().slice(0, 120) || null;
    }
    if (brandDescription !== undefined) {
      updates.brandDescription = String(brandDescription || "").trim().slice(0, 300) || null;
    }
    if (brandFaviconUrl !== undefined) {
      updates.brandFaviconUrl = String(brandFaviconUrl || "").trim().slice(0, 512) || null;
    }
    if (brandOgImageUrl !== undefined) {
      updates.brandOgImageUrl = String(brandOgImageUrl || "").trim().slice(0, 512) || null;
    }
    if (hidePoweredBy !== undefined) {
      if (hidePoweredBy && !paidEligible) {
        return NextResponse.json(
          { error: 'Hiding "Powered by DevPulse" requires a Pro or Enterprise storage plan.' },
          { status: 402 }
        );
      }
      updates.hidePoweredBy = Boolean(hidePoweredBy) && paidEligible;
    }

    // 3. Paid Cloudflare for SaaS Custom Domain provisioning
    let provisionNote: string | undefined;
    if (rawCustomDomain !== undefined) {
      const trimmedDomain = String(rawCustomDomain || "").trim();
      if (!trimmedDomain) {
        // Clear custom domain if emptied
        if (existingUser?.customHostnameId) {
          await deleteCloudflareCustomHostname(existingUser.customHostnameId);
        }
        updates.customDomain = null;
        updates.customDomainVerified = false;
        updates.customHostnameId = null;
        updates.customDomainSslStatus = "pending";
      } else {
        if (!paidEligible) {
          return NextResponse.json(
            {
              error:
                "Custom Domains with automatic Cloudflare SSL require a Pro, Team, or Enterprise plan. Use your free *.devpulse.ritualdev.in subdomain or upgrade in R2 Storage settings.",
              code: "PAYMENT_REQUIRED",
            },
            { status: 402 }
          );
        }

        const checkDomain = normalizeAndValidateCustomDomain(trimmedDomain);
        if (!checkDomain.valid) {
          return NextResponse.json({ error: checkDomain.error }, { status: 400 });
        }

        const [domainConflict] = await db
          .select({ id: users.id })
          .from(users)
          .where(and(eq(users.customDomain, checkDomain.domain), ne(users.id, user.id)))
          .limit(1);

        if (domainConflict) {
          return NextResponse.json(
            { error: `Domain "${checkDomain.domain}" is already connected to another workspace.` },
            { status: 409 }
          );
        }

        // Only call Cloudflare Custom Hostnames API if domain changed or no hostname ID yet
        if (checkDomain.domain !== existingUser?.customDomain || !existingUser?.customHostnameId) {
          if (existingUser?.customHostnameId && checkDomain.domain !== existingUser.customDomain) {
            await deleteCloudflareCustomHostname(existingUser.customHostnameId);
          }

          const cfRes = await createCloudflareCustomHostname(checkDomain.domain);
          updates.customDomain = checkDomain.domain;
          updates.customDomainVerified = cfRes.sslStatus === "active";
          updates.customHostnameId = cfRes.customHostnameId;
          updates.customDomainSslStatus = cfRes.sslStatus;
          provisionNote = cfRes.note;
        }
      }
    }

    await db.update(users).set(updates).where(eq(users.id, user.id));

    const [updated] = await db
      .select()
      .from(users)
      .where(eq(users.id, user.id))
      .limit(1);

    const activeSub = updated?.subdomain || user.githubUsername.toLowerCase();

    return NextResponse.json({
      success: true,
      subdomain: activeSub,
      subdomainUrl: `https://${activeSub}.${PRIMARY_PORTAL_DOMAIN}`,
      customDomain: updated?.customDomain || null,
      customDomainVerified: updated?.customDomainVerified || false,
      customHostnameId: updated?.customHostnameId || null,
      customDomainSslStatus: updated?.customDomainSslStatus || "pending",
      cnameTarget: CUSTOM_DOMAIN_CNAME_TARGET,
      provisionNote,
      branding: {
        brandTitle: updated?.brandTitle || "",
        brandDescription: updated?.brandDescription || "",
        brandFaviconUrl: updated?.brandFaviconUrl || "",
        brandOgImageUrl: updated?.brandOgImageUrl || "",
        hidePoweredBy: updated?.hidePoweredBy || false,
      },
    });
  } catch (err: any) {
    console.error("POST /api/v1/domains error:", err);
    return NextResponse.json(
      { error: "Failed to save domain settings", details: err?.message },
      { status: 500 }
    );
  }
}

export async function DELETE() {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const [existing] = await db
      .select({ customHostnameId: users.customHostnameId })
      .from(users)
      .where(eq(users.id, user.id))
      .limit(1);

    if (existing?.customHostnameId) {
      await deleteCloudflareCustomHostname(existing.customHostnameId);
    }

    await db
      .update(users)
      .set({
        customDomain: null,
        customDomainVerified: false,
        customHostnameId: null,
        customDomainSslStatus: "pending",
        updatedAt: new Date().toISOString(),
      })
      .where(eq(users.id, user.id));

    return NextResponse.json({ success: true });
  } catch (err: any) {
    console.error("DELETE /api/v1/domains error:", err);
    return NextResponse.json(
      { error: "Failed to disconnect custom domain", details: err?.message },
      { status: 500 }
    );
  }
}
