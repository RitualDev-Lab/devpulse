import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import {
  samlConfig,
  samlSessions,
  organizations,
  organizationMembers,
  users,
} from "@/db/schema";
import { eq, and, or, sql } from "drizzle-orm";
import {
  buildSamlAuthnRequest,
  buildSpMetadataXml,
  parseSamlResponse,
  SAML_REQUEST_TTL_MS,
} from "@/lib/saml/saml-core";
import {
  SSO_SESSION_COOKIE,
  buildSsoCookieOptions,
  createSsoSessionToken,
} from "@/lib/saml/sso-session";
import { getCurrentUser } from "@/lib/auth";
import { recordAuditEvent } from "@/lib/security/audit";

export const dynamic = "force-dynamic";

function resolvePublicOrigin(req: NextRequest): string {
  const fwdHost = req.headers.get("x-forwarded-host");
  const fwdProto = req.headers.get("x-forwarded-proto") || "https";
  if (fwdHost && process.env.NODE_ENV !== "development") {
    return `${fwdProto}://${fwdHost}`;
  }
  return req.nextUrl.origin;
}

function sanitizeRedirectPath(raw?: string | null): string {
  if (!raw) return "/dashboard";
  const trimmed = raw.trim();
  if (!trimmed.startsWith("/") || trimmed.startsWith("//")) {
    return "/dashboard";
  }
  return trimmed;
}

async function findOrgByIdOrSlug(idOrSlug: string) {
  const clean = idOrSlug.trim();
  const [org] = await db
    .select()
    .from(organizations)
    .where(or(eq(organizations.id, clean), eq(organizations.slug, clean.toLowerCase())))
    .limit(1);
  return org || null;
}

async function findActiveSamlByDomain(domainInput: string) {
  const domain = domainInput.trim().toLowerCase().replace(/^.*@/, "");
  if (!domain) return null;

  const activeConfigs = await db
    .select()
    .from(samlConfig)
    .where(eq(samlConfig.isActive, true));

  for (const cfg of activeConfigs) {
    if (!cfg.allowedDomains) continue;
    const list = cfg.allowedDomains
      .split(",")
      .map((d) => d.trim().toLowerCase().replace(/^@/, ""))
      .filter(Boolean);
    if (list.includes(domain)) {
      return cfg;
    }
  }
  return null;
}

function deriveSafeSsoHandle(email: string): string {
  const local = email
    .split("@")[0]
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 20) || "sso";
  const suffix = crypto.randomUUID().replace(/-/g, "").slice(0, 6);
  return `${local}-sso-${suffix}`;
}

/**
 * GET /api/auth/saml
 * - ?action=session                -> current session summary (Supabase or SAML SSO)
 * - ?metadata=1&org=<idOrSlug>     -> SP Metadata XML for Okta / Azure AD / Google Workspace
 * - ?org=<idOrSlug> or ?domain=... -> SP-initiated SAML AuthnRequest 302 redirect to IdP
 */
export async function GET(req: NextRequest) {
  const origin = resolvePublicOrigin(req);
  const acsUrl = `${origin}/api/auth/saml`;
  const action = req.nextUrl.searchParams.get("action");
  const wantMetadata = req.nextUrl.searchParams.get("metadata") === "1" || action === "metadata";

  if (action === "session") {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ authenticated: false, user: null });
    }
    return NextResponse.json({
      authenticated: true,
      user: {
        id: user.id,
        githubUsername: user.githubUsername,
        name: user.name,
        email: user.email,
        avatarUrl: user.avatarUrl,
        authMethod: user.authMethod || "github",
        ssoOrganizationId: user.ssoOrganizationId || null,
      },
    });
  }

  const orgParam = req.nextUrl.searchParams.get("org");
  const domainParam = req.nextUrl.searchParams.get("domain");

  if (wantMetadata) {
    let spEntityId = origin;
    if (orgParam) {
      const org = await findOrgByIdOrSlug(orgParam);
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

  try {
    let cfg: typeof samlConfig.$inferSelect | null = null;

    if (orgParam) {
      const org = await findOrgByIdOrSlug(orgParam);
      if (!org) {
        return NextResponse.redirect(`${origin}/dashboard?error=sso-org-not-found`);
      }
      const [found] = await db
        .select()
        .from(samlConfig)
        .where(eq(samlConfig.organizationId, org.id))
        .limit(1);
      cfg = found || null;
    } else if (domainParam) {
      cfg = await findActiveSamlByDomain(domainParam);
    }

    if (!cfg || !cfg.isActive) {
      return NextResponse.redirect(`${origin}/dashboard?error=sso-not-configured`);
    }

    const relayState = `rs_${crypto.randomUUID().replace(/-/g, "")}`;
    const redirectTo = sanitizeRedirectPath(req.nextUrl.searchParams.get("redirect"));
    const expiresAt = new Date(Date.now() + SAML_REQUEST_TTL_MS).toISOString();

    const { redirectUrl, requestId } = await buildSamlAuthnRequest(
      { idpSsoUrl: cfg.idpSsoUrl, spEntityId: cfg.spEntityId },
      relayState,
      acsUrl
    );

    await db.insert(samlSessions).values({
      id: relayState,
      organizationId: cfg.organizationId,
      redirectTo,
      expiresAt,
      requestId,
    });

    return NextResponse.redirect(redirectUrl, 302);
  } catch (err) {
    console.error("GET /api/auth/saml error:", err);
    return NextResponse.redirect(`${origin}/dashboard?error=sso-init-failed`);
  }
}

/**
 * POST /api/auth/saml
 * SAML 2.0 HTTP-POST Assertion Consumer Service (ACS) callback from Okta / Azure AD / Google Workspace.
 */
export async function POST(req: NextRequest) {
  const origin = resolvePublicOrigin(req);
  const isHttps = origin.startsWith("https://");

  try {
    const contentType = req.headers.get("content-type") || "";
    let samlResponse = "";
    let relayState = "";

    if (contentType.includes("application/json")) {
      const json = (await req.json()) as { SAMLResponse?: string; RelayState?: string };
      samlResponse = String(json.SAMLResponse || "");
      relayState = String(json.RelayState || "");
    } else {
      const formData = await req.formData();
      samlResponse = String(formData.get("SAMLResponse") || "");
      relayState = String(formData.get("RelayState") || "");
    }

    if (!samlResponse) {
      return NextResponse.json({ error: "Missing SAMLResponse" }, { status: 400 });
    }

    // SP-initiated only: the RelayState must name a pending session created by GET.
    // Unsolicited (IdP-initiated) responses have no AuthnRequest to bind to, so they are rejected.
    if (!relayState || !relayState.startsWith("rs_")) {
      return NextResponse.redirect(`${origin}/?error=saml-unsolicited`);
    }

    // Atomic single-use: the pending row is deleted and returned in one statement, so two
    // concurrent callbacks cannot both consume the same RelayState.
    const [sessionRow] = await db
      .delete(samlSessions)
      .where(eq(samlSessions.id, relayState))
      .returning();

    if (!sessionRow) {
      return NextResponse.redirect(`${origin}/?error=saml-invalid-relay-state`);
    }

    if (Date.parse(sessionRow.expiresAt) < Date.now()) {
      return NextResponse.redirect(`${origin}/?error=saml-session-expired`);
    }

    const organizationId = sessionRow.organizationId;
    const redirectTo = sanitizeRedirectPath(sessionRow.redirectTo);
    const expectedRequest = sessionRow.requestId
      ? { id: sessionRow.requestId, issuedAt: Date.parse(sessionRow.expiresAt) - SAML_REQUEST_TTL_MS }
      : null;

    const [cfg] = await db
      .select()
      .from(samlConfig)
      .where(and(eq(samlConfig.organizationId, organizationId), eq(samlConfig.isActive, true)))
      .limit(1);

    if (!cfg) {
      return NextResponse.redirect(`${origin}/?error=saml-disabled`);
    }

    // 3. Cryptographically verify XML signature, Issuer, Conditions, Domain, Role
    const samlUser = await parseSamlResponse(
      samlResponse,
      {
        idpEntityId: cfg.idpEntityId,
        idpSsoUrl: cfg.idpSsoUrl,
        idpCertificate: cfg.idpCertificate,
        spEntityId: cfg.spEntityId,
        attributeEmail: cfg.attributeEmail,
        attributeName: cfg.attributeName,
        attributeRole: cfg.attributeRole,
        defaultRole: cfg.defaultRole,
        allowedDomains: cfg.allowedDomains,
      },
      { acsUrl: `${origin}/api/auth/saml`, expectedRequest }
    );

    // 4. Find or JIT-provision Turso user record
    const normalizedEmail = samlUser.email.toLowerCase();
    const [existingUser] = await db
      .select()
      .from(users)
      .where(sql`lower(${users.email}) = ${normalizedEmail}`)
      .limit(1);

    let userId: string;
    let actorUsername: string;

    if (existingUser) {
      userId = existingUser.id;
      actorUsername = existingUser.githubUsername;
      if (samlUser.name && samlUser.name !== existingUser.name) {
        await db
          .update(users)
          .set({ name: samlUser.name, updatedAt: new Date().toISOString() })
          .where(eq(users.id, existingUser.id));
      }
    } else {
      userId = `sso_${crypto.randomUUID().replace(/-/g, "")}`;
      actorUsername = deriveSafeSsoHandle(normalizedEmail);
      await db.insert(users).values({
        id: userId,
        githubUsername: actorUsername,
        name: samlUser.name,
        email: normalizedEmail,
        storageTier: "team",
        customDomainVerified: false,
      });
    }

    // 5. Enforce SCIM suspension check & bind/JIT-provision org membership
    const [existingMember] = await db
      .select()
      .from(organizationMembers)
      .where(
        and(
          eq(organizationMembers.organizationId, organizationId),
          or(
            eq(organizationMembers.userId, userId),
            sql`lower(${organizationMembers.email}) = ${normalizedEmail}`
          )
        )
      )
      .limit(1);

    if (existingMember?.status === "suspended") {
      await recordAuditEvent({
        userId,
        actorUsername,
        organizationId,
        action: "auth.saml_login",
        resourceType: "user",
        resourceId: userId,
        status: "denied",
        headers: req.headers,
        metadata: { reason: "member_suspended_by_scim", email: normalizedEmail },
      });
      return NextResponse.redirect(`${origin}/?error=sso-suspended`);
    }

    if (existingMember) {
      await db
        .update(organizationMembers)
        .set({
          userId,
          email: normalizedEmail,
          status: "active",
          role: existingMember.role === "owner" ? "owner" : samlUser.role,
          updatedAt: new Date().toISOString(),
        })
        .where(eq(organizationMembers.id, existingMember.id));
    } else {
      await db.insert(organizationMembers).values({
        id: `mem_${crypto.randomUUID().replace(/-/g, "").slice(0, 14)}`,
        organizationId,
        userId,
        githubUsername: actorUsername,
        email: normalizedEmail,
        role: samlUser.role,
        status: "active",
      });
    }

    await recordAuditEvent({
      userId,
      actorUsername,
      organizationId,
      action: "auth.saml_login",
      resourceType: "user",
      resourceId: userId,
      headers: req.headers,
      metadata: {
        provider: cfg.provider,
        email: normalizedEmail,
        role: existingMember?.role === "owner" ? "owner" : samlUser.role,
      },
    });

    // 6. Mint signed HttpOnly SSO session cookie & redirect
    const sessionToken = await createSsoSessionToken({
      userId,
      organizationId,
      email: normalizedEmail,
      name: samlUser.name,
      provider: cfg.provider,
    });

    const response = NextResponse.redirect(`${origin}${redirectTo}`, 302);
    response.cookies.set(
      SSO_SESSION_COOKIE,
      sessionToken,
      buildSsoCookieOptions(isHttps)
    );
    return response;
  } catch (err) {
    console.error("POST /api/auth/saml error:", err);
    return NextResponse.redirect(`${origin}/?error=saml-failed`, 302);
  }
}

/**
 * DELETE /api/auth/saml
 * Clears the enterprise SSO session cookie.
 */
export async function DELETE() {
  const response = NextResponse.json({ success: true });
  response.cookies.delete(SSO_SESSION_COOKIE);
  return response;
}
