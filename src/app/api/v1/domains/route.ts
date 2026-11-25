import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { customDomains, projects, users } from "@/db/schema";
import { and, desc, eq } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth";
import { getPlanLimits } from "@/lib/billing/plans";
import { isValidCustomHostname, isValidSubdomainSlug } from "@/lib/domains/host-routing";
import { initDb } from "@/db/setup";
import crypto from "crypto";

export const dynamic = "force-dynamic";

async function registerCloudflareHostname(hostname: string) {
  const token = process.env.CLOUDFLARE_API_TOKEN;
  const zoneId = process.env.CLOUDFLARE_ZONE_ID;
  if (!token || !zoneId) {
    return {
      configured: false,
      cloudflareHostnameId: null,
      sslStatus: "pending_validation",
      verificationRecordName: hostname,
      verificationRecordValue: "cname.devpulse.ritualdev.in",
    };
  }

  try {
    const res = await fetch(
      `https://api.cloudflare.com/client/v4/zones/${zoneId}/custom_hostnames`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          hostname,
          ssl: {
            method: "http",
            type: "dv",
            settings: { min_tls_version: "1.2" },
          },
        }),
      }
    );
    const json = await res.json().catch(() => null);
    if (res.ok && json?.success && json.result) {
      return {
        configured: true,
        cloudflareHostnameId: json.result.id || null,
        sslStatus: json.result.ssl?.status || "pending_validation",
        verificationRecordName:
          json.result.ownership_verification?.name || hostname,
        verificationRecordValue:
          json.result.ownership_verification?.value || "cname.devpulse.ritualdev.in",
      };
    }
  } catch (err) {
    console.warn("Cloudflare Custom Hostnames API error:", err);
  }

  return {
    configured: true,
    cloudflareHostnameId: null,
    sslStatus: "pending_validation",
    verificationRecordName: hostname,
    verificationRecordValue: "cname.devpulse.ritualdev.in",
  };
}

async function checkCloudflareAndDnsVerification(
  hostname: string,
  cloudflareHostnameId?: string | null
): Promise<{ verified: boolean; sslStatus: string }> {
  const token = process.env.CLOUDFLARE_API_TOKEN;
  const zoneId = process.env.CLOUDFLARE_ZONE_ID;

  if (token && zoneId && cloudflareHostnameId) {
    try {
      const cfRes = await fetch(
        `https://api.cloudflare.com/client/v4/zones/${zoneId}/custom_hostnames/${cloudflareHostnameId}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      if (cfRes.ok) {
        const cfJson = await cfRes.json().catch(() => null);
        const status = cfJson?.result?.ssl?.status || "pending_validation";
        const hostStatus = cfJson?.result?.status || "pending";
        if (status === "active" || hostStatus === "active") {
          return { verified: true, sslStatus: "active" };
        }
        return { verified: false, sslStatus: status };
      }
    } catch {
      // Fall through to DoH check
    }
  }

  // Fallback DNS-over-HTTPS CNAME verification
  try {
    const dohRes = await fetch(
      `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(hostname)}&type=CNAME`,
      { headers: { Accept: "application/dns-json" } }
    );
    if (dohRes.ok) {
      const dohJson = (await dohRes.json().catch(() => null)) as { Answer?: Array<{ data?: string }> } | null;
      const answers = Array.isArray(dohJson?.Answer) ? dohJson.Answer : [];
      const pointsToDevPulse = answers.some((ans) => {
        const data = String(ans?.data || "").toLowerCase().replace(/\.$/, "");
        return data === "cname.devpulse.ritualdev.in" || data === "devpulse.ritualdev.in";
      });
      if (pointsToDevPulse) {
        return { verified: true, sslStatus: "active" };
      }
    }
  } catch {
    // Ignore DoH failures
  }

  return { verified: false, sslStatus: "pending_validation" };
}

export async function GET() {
  try {
    await initDb();
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const domains = await db
      .select()
      .from(customDomains)
      .where(eq(customDomains.userId, user.id))
      .orderBy(desc(customDomains.createdAt));

    const limits = getPlanLimits(user.storageTier, user.extraCustomDomains);

    return NextResponse.json({
      success: true,
      subdomain: user.subdomain,
      maxCustomDomains: limits.maxCustomDomains,
      extraCustomDomains: user.extraCustomDomains,
      tier: limits.tier,
      cnameTarget: "cname.devpulse.ritualdev.in",
      domains,
    });
  } catch (err: unknown) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed to list domains" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    await initDb();
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const action = String(body?.action || "");

    if (action === "claim_subdomain") {
      const slug = String(body?.subdomain || "").trim().toLowerCase();
      if (!isValidSubdomainSlug(slug)) {
        return NextResponse.json(
          { error: "Subdomain must be 3-38 chars (lowercase letters, digits, hyphens) and not reserved." },
          { status: 400 }
        );
      }

      const [existingOwner] = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.subdomain, slug))
        .limit(1);

      if (existingOwner && existingOwner.id !== user.id) {
        return NextResponse.json({ error: "This subdomain is already claimed." }, { status: 409 });
      }

      await db.update(users).set({ subdomain: slug }).where(eq(users.id, user.id));
      return NextResponse.json({
        success: true,
        subdomain: slug,
        url: `https://${slug}.devpulse.ritualdev.in`,
      });
    }

    if (action === "add_custom_domain") {
      const hostname = String(body?.hostname || "").trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
      const projectId = body?.projectId ? String(body.projectId) : null;

      if (!isValidCustomHostname(hostname)) {
        return NextResponse.json(
          { error: "Please enter a valid custom domain such as stats.yourtool.dev." },
          { status: 400 }
        );
      }

      const limits = getPlanLimits(user.storageTier, user.extraCustomDomains);
      const currentDomains = await db
        .select()
        .from(customDomains)
        .where(eq(customDomains.userId, user.id));

      if (currentDomains.length >= limits.maxCustomDomains) {
        return NextResponse.json(
          {
            error:
              limits.maxCustomDomains === 0
                ? "Custom domains require Developer Pro ($14/mo) or Team ($49/mo)."
                : `You've used all ${limits.maxCustomDomains} custom domain slots on your plan. Add an extra domain (+$5/mo) or upgrade to Team.`,
            upgradeRequired: true,
          },
          { status: 403 }
        );
      }

      if (projectId) {
        const [ownedProj] = await db
          .select({ id: projects.id })
          .from(projects)
          .where(and(eq(projects.id, projectId), eq(projects.userId, user.id)))
          .limit(1);
        if (!ownedProj) {
          return NextResponse.json({ error: "Selected project not found" }, { status: 404 });
        }
      }

      const cf = await registerCloudflareHostname(hostname);
      const id = `dom_${crypto.randomUUID().replace(/-/g, "").slice(0, 14)}`;

      await db.insert(customDomains).values({
        id,
        userId: user.id,
        projectId,
        hostname,
        cloudflareHostnameId: cf.cloudflareHostnameId,
        sslStatus: cf.sslStatus,
        verificationRecordName: cf.verificationRecordName,
        verificationRecordValue: cf.verificationRecordValue,
        verified: false,
      });

      const [created] = await db.select().from(customDomains).where(eq(customDomains.id, id)).limit(1);
      return NextResponse.json({ success: true, domain: created });
    }

    if (action === "verify_custom_domain") {
      const domainId = String(body?.domainId || "");
      const [row] = await db
        .select()
        .from(customDomains)
        .where(and(eq(customDomains.id, domainId), eq(customDomains.userId, user.id)))
        .limit(1);

      if (!row) {
        return NextResponse.json({ error: "Custom domain not found" }, { status: 404 });
      }

      const check = await checkCloudflareAndDnsVerification(row.hostname, row.cloudflareHostnameId);
      await db
        .update(customDomains)
        .set({
          verified: check.verified,
          sslStatus: check.sslStatus,
        })
        .where(eq(customDomains.id, row.id));

      if (check.verified) {
        await db
          .update(users)
          .set({ customDomain: row.hostname, customDomainVerified: true })
          .where(eq(users.id, user.id));
      }

      return NextResponse.json({
        success: true,
        verified: check.verified,
        sslStatus: check.sslStatus,
      });
    }

    return NextResponse.json({ error: "Unsupported action" }, { status: 400 });
  } catch (err: unknown) {
    console.error("Domains API error:", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed to update domain" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const domainId = req.nextUrl.searchParams.get("id");
    if (!domainId) {
      return NextResponse.json({ error: "Missing domain id" }, { status: 400 });
    }

    const [row] = await db
      .select()
      .from(customDomains)
      .where(and(eq(customDomains.id, domainId), eq(customDomains.userId, user.id)))
      .limit(1);

    if (!row) {
      return NextResponse.json({ error: "Domain not found" }, { status: 404 });
    }

    const token = process.env.CLOUDFLARE_API_TOKEN;
    const zoneId = process.env.CLOUDFLARE_ZONE_ID;
    if (token && zoneId && row.cloudflareHostnameId) {
      await fetch(
        `https://api.cloudflare.com/client/v4/zones/${zoneId}/custom_hostnames/${row.cloudflareHostnameId}`,
        {
          method: "DELETE",
          headers: { Authorization: `Bearer ${token}` },
        }
      ).catch(() => {});
    }

    await db
      .delete(customDomains)
      .where(and(eq(customDomains.id, domainId), eq(customDomains.userId, user.id)));

    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed to delete domain" }, { status: 500 });
  }
}
