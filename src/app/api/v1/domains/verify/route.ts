import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/db";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";
import {
  CUSTOM_DOMAIN_CNAME_TARGET,
  getCloudflareCustomHostnameStatus,
  verifyDomainCname,
} from "@/lib/domains/cloudflare-saas";

export const dynamic = "force-dynamic";

export async function POST() {
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

    if (!row?.customDomain) {
      return NextResponse.json(
        { error: "No custom domain configured on this account." },
        { status: 400 }
      );
    }

    const [dnsCheck, cfCheck] = await Promise.all([
      verifyDomainCname(row.customDomain),
      row.customHostnameId
        ? getCloudflareCustomHostnameStatus(row.customHostnameId)
        : Promise.resolve({
            found: false,
          } as Awaited<ReturnType<typeof getCloudflareCustomHostnameStatus>>),
    ]);

    const cfSslStatus = cfCheck.found ? cfCheck.sslStatus : undefined;
    const verified = cfSslStatus === "active" || dnsCheck.verified;
    const nextSslStatus =
      cfSslStatus || (dnsCheck.verified ? "active" : "pending_validation");

    await db
      .update(users)
      .set({
        customDomainVerified: verified,
        customDomainSslStatus: nextSslStatus,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(users.id, user.id));

    return NextResponse.json({
      success: true,
      customDomain: row.customDomain,
      verified,
      sslStatus: nextSslStatus,
      dnsRecordsFound: dnsCheck.records,
      expectedCnameTarget: CUSTOM_DOMAIN_CNAME_TARGET,
      cloudflareSaasStatus: cfCheck.found ? cfCheck.status : null,
      message: verified
        ? `CNAME & SSL verified for ${row.customDomain}!`
        : `Waiting for CNAME ${row.customDomain} -> ${CUSTOM_DOMAIN_CNAME_TARGET} propagation.`,
    });
  } catch (err: any) {
    console.error("POST /api/v1/domains/verify error:", err);
    return NextResponse.json(
      { error: "Failed to verify domain DNS/SSL", details: err?.message },
      { status: 500 }
    );
  }
}
