import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { samlConfig, organizations } from "@/db/schema";
import { eq, or } from "drizzle-orm";
import { buildSpMetadataXml } from "@/lib/saml/saml-core";

export const dynamic = "force-dynamic";

function resolvePublicOrigin(req: NextRequest): string {
  const fwdHost = req.headers.get("x-forwarded-host");
  const fwdProto = req.headers.get("x-forwarded-proto") || "https";
  if (fwdHost && process.env.NODE_ENV !== "development") {
    return `${fwdProto}://${fwdHost}`;
  }
  return req.nextUrl.origin;
}

export async function GET(req: NextRequest) {
  const origin = resolvePublicOrigin(req);
  const acsUrl = `${origin}/api/auth/saml`;
  const orgParam = req.nextUrl.searchParams.get("org");
  let spEntityId = origin;

  if (orgParam) {
    const clean = orgParam.trim();
    const [org] = await db
      .select()
      .from(organizations)
      .where(or(eq(organizations.id, clean), eq(organizations.slug, clean.toLowerCase())))
      .limit(1);

    if (org) {
      const [cfg] = await db
        .select({ spEntityId: samlConfig.spEntityId })
        .from(samlConfig)
        .where(eq(samlConfig.organizationId, org.id))
        .limit(1);
      spEntityId = cfg?.spEntityId || `${origin}/api/auth/saml?org=${org.id}`;
    }
  }

  const xml = buildSpMetadataXml(spEntityId, acsUrl);
  return new NextResponse(xml, {
    status: 200,
    headers: {
      "Content-Type": "application/samlmetadata+xml; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
