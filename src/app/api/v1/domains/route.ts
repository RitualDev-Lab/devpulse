import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/db";
import { users, userCustomDomains } from "@/db/schema";
import { eq, ne, and } from "drizzle-orm";
import {
  PRIMARY_PORTAL_DOMAIN,
  CUSTOM_DOMAIN_CNAME_TARGET,
  normalizeAndValidateSubdomain,
  normalizeAndValidateCustomDomain,
  createCloudflareCustomHostname,
  deleteCloudflareCustomHostname,
} from "@/lib/domains/cloudflare-saas";
import { getEffectiveEntitlements } from "@/lib/billing/plans";
import { recordAuditEvent } from "@/lib/security/audit";

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
    const entitlements = getEffectiveEntitlements({
      storageTier: tier,
      extraCustomDomains: row?.extraCustomDomains,
      extraStorageGb: row?.extraStorageGb,
    });

    const extraDomainsList = await db
      .select()
      .from(userCustomDomains)
      .where(eq(userCustomDomains.userId, user.id));

    return NextResponse.json({
      subdomain,
      subdomainUrl: `https://${subdomain}.${PRIMARY_PORTAL_DOMAIN}`,
      portalPreviewPath: `/portal/${subdomain}`,
      primaryDomain: PRIMARY_PORTAL_DOMAIN,
      cnameTarget: CUSTOM_DOMAIN_CNAME_TARGET,
      tier,
      isPaidTier: entitlements.maxCustomDomains > 0,
      maxCustomDomains: entitlements.maxCustomDomains,
      extraCustomDomains: entitlements.extraCustomDomains,
      customDomains: extraDomainsList,
      customDomain: row?.customDomain || extraDomainsList[0]?.domain || null,
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
    const entitlements = getEffectiveEntitlements({
      storageTier: tier,
      extraCustomDomains: existingUser?.extraCustomDomains,
      extraStorageGb: existingUser?.extraStorageGb,
    });
    const paidEligible = entitlements.maxCustomDomains > 0;

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
                "Custom Domains with automatic Cloudflare SSL require Developer Pro ($14/mo, 1 domain), Team ($49/mo, 5 domains), or an Extra Custom Domain add-on (+$5/mo).",
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

        const [extraConflict] = await db
          .select({ id: userCustomDomains.id, userId: userCustomDomains.userId })
          .from(userCustomDomains)
          .where(eq(userCustomDomains.domain, checkDomain.domain))
          .limit(1);

        if (domainConflict || (extraConflict && extraConflict.userId !== user.id)) {
          return NextResponse.json(
            { error: `Domain "${checkDomain.domain}" is already connected to another workspace.` },
            { status: 409 }
          );
        }

        const userDomains = await db
          .select()
          .from(userCustomDomains)
          .where(eq(userCustomDomains.userId, user.id));

        const alreadyOwnedHere =
          checkDomain.domain === existingUser?.customDomain ||
          userDomains.some((d) => d.domain === checkDomain.domain);

        // Enforce multi-domain quota (Pro: 1, Team: 5, + Extra Custom Domain add-ons)
        const currentCount = new Set(
          [existingUser?.customDomain, ...userDomains.map((d) => d.domain)].filter(Boolean)
        ).size;

        if (!alreadyOwnedHere && currentCount >= entitlements.maxCustomDomains) {
          return NextResponse.json(
            {
              error: `Custom domain limit reached (${currentCount}/${entitlements.maxCustomDomains}). Upgrade to Team ($49/mo for 5 domains) or purchase an Extra Custom Domain (+$5/mo) add-on.`,
              code: "DOMAIN_LIMIT_REACHED",
            },
            { status: 402 }
          );
        }

        // Provision in Cloudflare for SaaS if new domain
        if (!alreadyOwnedHere || !existingUser?.customHostnameId) {
          const cfRes = await createCloudflareCustomHostname(checkDomain.domain);
          if (!existingUser?.customDomain) {
            updates.customDomain = checkDomain.domain;
            updates.customDomainVerified = cfRes.sslStatus === "active";
            updates.customHostnameId = cfRes.customHostnameId;
            updates.customDomainSslStatus = cfRes.sslStatus;
          }
          await db
            .insert(userCustomDomains)
            .values({
              id: `dom_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`,
              userId: user.id,
              domain: checkDomain.domain,
              customHostnameId: cfRes.customHostnameId,
              sslStatus: cfRes.sslStatus,
              verified: cfRes.sslStatus === "active",
            })
            .onConflictDoUpdate({
              target: userCustomDomains.domain,
              set: {
                customHostnameId: cfRes.customHostnameId,
                sslStatus: cfRes.sslStatus,
                verified: cfRes.sslStatus === "active",
                updatedAt: new Date().toISOString(),
              },
            });
          provisionNote = cfRes.note;
        }
      }
    }

    await db.update(users).set(updates).where(eq(users.id, user.id));

    await recordAuditEvent({
      userId: user.id,
      actorUsername: user.githubUsername,
      action: rawCustomDomain !== undefined ? "domain.custom_domain_updated" : "domain.settings_updated",
      resourceType: "domain",
      resourceId: updates.customDomain || updates.subdomain || user.id,
      headers: req.headers,
      metadata: {
        subdomain: updates.subdomain,
        customDomain: updates.customDomain,
        hidePoweredBy: updates.hidePoweredBy,
      },
    });

    const [updated] = await db
      .select()
      .from(users)
      .where(eq(users.id, user.id))
      .limit(1);

    const activeSub = updated?.subdomain || user.githubUsername.toLowerCase();

    const userDomains = await db
      .select()
      .from(userCustomDomains)
      .where(eq(userCustomDomains.userId, user.id));

    return NextResponse.json({
      success: true,
      subdomain: activeSub,
      subdomainUrl: `https://${activeSub}.${PRIMARY_PORTAL_DOMAIN}`,
      maxCustomDomains: entitlements.maxCustomDomains,
      customDomains: userDomains,
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

export async function DELETE(req: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const domainParam = req.nextUrl.searchParams.get("domain");

    if (domainParam) {
      const [row] = await db
        .select()
        .from(userCustomDomains)
        .where(and(eq(userCustomDomains.userId, user.id), eq(userCustomDomains.domain, domainParam)))
        .limit(1);

      if (row?.customHostnameId) {
        await deleteCloudflareCustomHostname(row.customHostnameId);
      }
      await db
        .delete(userCustomDomains)
        .where(and(eq(userCustomDomains.userId, user.id), eq(userCustomDomains.domain, domainParam)));
    }

    const [existing] = await db
      .select({ customDomain: users.customDomain, customHostnameId: users.customHostnameId })
      .from(users)
      .where(eq(users.id, user.id))
      .limit(1);

    if (!domainParam || existing?.customDomain === domainParam) {
      if (existing?.customHostnameId) {
        await deleteCloudflareCustomHostname(existing.customHostnameId);
      }

      const [nextFallback] = await db
        .select()
        .from(userCustomDomains)
        .where(eq(userCustomDomains.userId, user.id))
        .limit(1);

      await db
        .update(users)
        .set({
          customDomain: nextFallback?.domain || null,
          customDomainVerified: nextFallback?.verified || false,
          customHostnameId: nextFallback?.customHostnameId || null,
          customDomainSslStatus: nextFallback?.sslStatus || "pending",
          updatedAt: new Date().toISOString(),
        })
        .where(eq(users.id, user.id));
    }

    await recordAuditEvent({
      userId: user.id,
      actorUsername: user.githubUsername,
      action: "domain.custom_domain_removed",
      resourceType: "domain",
      resourceId: domainParam || existing?.customDomain || user.id,
      headers: req.headers,
    });

    return NextResponse.json({ success: true });
  } catch (err: any) {
    console.error("DELETE /api/v1/domains error:", err);
    return NextResponse.json(
      { error: "Failed to disconnect custom domain", details: err?.message },
      { status: 500 }
    );
  }
}
