import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/db";
import {
  organizations,
  organizationMembers,
  samlConfig,
  scimTokens,
} from "@/db/schema";
import { eq, and, or, desc } from "drizzle-orm";
import { recordAuditEvent } from "@/lib/security/audit";
import { hashApiKey } from "@/lib/security/api-keys";
import {
  SAML_PROVIDER_PRESETS,
  inspectX509Certificate,
  type SamlProvider,
} from "@/lib/saml/saml-core";

export const dynamic = "force-dynamic";

function resolvePublicOrigin(req: NextRequest): string {
  const fwdHost = req.headers.get("x-forwarded-host");
  const fwdProto = req.headers.get("x-forwarded-proto") || "https";
  if (fwdHost && process.env.NODE_ENV !== "development") {
    return `${fwdProto}://${fwdHost}`;
  }
  return req.nextUrl.origin;
}

async function assertOrgOwner(organizationId: string, userId: string, githubUsername: string) {
  const [org] = await db
    .select()
    .from(organizations)
    .where(eq(organizations.id, organizationId))
    .limit(1);
  if (!org) return { org: null, isOwner: false };

  if (org.ownerUserId === userId) {
    return { org, isOwner: true };
  }

  const [mem] = await db
    .select({ role: organizationMembers.role, status: organizationMembers.status })
    .from(organizationMembers)
    .where(
      and(
        eq(organizationMembers.organizationId, organizationId),
        or(
          eq(organizationMembers.userId, userId),
          eq(organizationMembers.githubUsername, githubUsername.toLowerCase())
        )
      )
    )
    .limit(1);

  return {
    org,
    isOwner: Boolean(mem && mem.status !== "suspended" && mem.role === "owner"),
  };
}

function generateScimBearerToken(): { rawToken: string; prefix: string } {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  const hex = Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  const rawToken = `dp_scim_${hex}`;
  return {
    rawToken,
    prefix: `${rawToken.slice(0, 15)}...`,
  };
}

export async function GET(req: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const organizationId = req.nextUrl.searchParams.get("organizationId")?.trim();
    if (!organizationId) {
      return NextResponse.json({ error: "Missing organizationId" }, { status: 400 });
    }

    const { org, isOwner } = await assertOrgOwner(
      organizationId,
      user.id,
      user.githubUsername
    );
    if (!org) {
      return NextResponse.json({ error: "Organization not found" }, { status: 404 });
    }
    if (!isOwner) {
      return NextResponse.json(
        { error: "Forbidden: Only Organization Owners can view SSO / SCIM settings." },
        { status: 403 }
      );
    }

    const origin = resolvePublicOrigin(req);

    const [cfg] = await db
      .select()
      .from(samlConfig)
      .where(eq(samlConfig.organizationId, organizationId))
      .limit(1);

    const tokens = await db
      .select({
        id: scimTokens.id,
        label: scimTokens.label,
        tokenPrefix: scimTokens.tokenPrefix,
        status: scimTokens.status,
        lastUsedAt: scimTokens.lastUsedAt,
        revokedAt: scimTokens.revokedAt,
        createdAt: scimTokens.createdAt,
      })
      .from(scimTokens)
      .where(eq(scimTokens.organizationId, organizationId))
      .orderBy(desc(scimTokens.createdAt));

    return NextResponse.json({
      organization: { id: org.id, name: org.name, slug: org.slug },
      sp: {
        acsUrl: `${origin}/api/auth/saml`,
        spEntityId: cfg?.spEntityId || `${origin}/api/auth/saml?org=${org.id}`,
        metadataUrl: `${origin}/api/auth/saml/metadata?org=${org.id}`,
        loginUrl: `${origin}/api/auth/saml?org=${org.slug}`,
        scimBaseUrl: `${origin}/api/scim/v2`,
      },
      samlConfig: cfg || null,
      scimTokens: tokens,
      presets: SAML_PROVIDER_PRESETS,
    });
  } catch (err) {
    console.error("GET /api/v1/security/saml error:", err);
    return NextResponse.json({ error: "Failed to load SSO settings" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const organizationId = String(body.organizationId || "").trim();
    const action = String(body.action || "");

    if (!organizationId) {
      return NextResponse.json({ error: "Missing organizationId" }, { status: 400 });
    }

    const { org, isOwner } = await assertOrgOwner(
      organizationId,
      user.id,
      user.githubUsername
    );
    if (!org) {
      return NextResponse.json({ error: "Organization not found" }, { status: 404 });
    }
    if (!isOwner) {
      await recordAuditEvent({
        userId: user.id,
        actorUsername: user.githubUsername,
        organizationId,
        action: `sso.${action || "unknown"}`,
        resourceType: "saml_config",
        status: "denied",
        headers: req.headers,
      });
      return NextResponse.json(
        { error: "Forbidden: Only Organization Owners can configure SAML SSO & SCIM." },
        { status: 403 }
      );
    }

    if (action === "test_saml") {
      const cert = String(body.idpCertificate || "").trim();
      const ssoUrl = String(body.idpSsoUrl || "").trim();
      const entityId = String(body.idpEntityId || "").trim();

      if (!cert) {
        return NextResponse.json({ error: "IdP X.509 Certificate is required" }, { status: 400 });
      }
      const certInfo = await inspectX509Certificate(cert);
      if (!certInfo.valid) {
        return NextResponse.json(
          { valid: false, error: certInfo.error || "Invalid X.509 certificate" },
          { status: 400 }
        );
      }

      if (ssoUrl) {
        try {
          const u = new URL(ssoUrl);
          if (u.protocol !== "https:") {
            return NextResponse.json(
              { valid: false, error: "IdP SSO URL must use HTTPS" },
              { status: 400 }
            );
          }
        } catch {
          return NextResponse.json({ valid: false, error: "Invalid IdP SSO URL" }, { status: 400 });
        }
      }

      return NextResponse.json({
        valid: true,
        certificate: certInfo,
        entityIdPresent: Boolean(entityId),
        ssoUrlPresent: Boolean(ssoUrl),
      });
    }

    if (action === "save_saml") {
      const origin = resolvePublicOrigin(req);
      const provider = (["okta", "azure_ad", "google", "custom"].includes(body.provider)
        ? body.provider
        : "custom") as SamlProvider;

      const idpEntityId = String(body.idpEntityId || "").trim();
      const idpSsoUrl = String(body.idpSsoUrl || "").trim();
      const idpCertificate = String(body.idpCertificate || "").trim();
      const spEntityId =
        String(body.spEntityId || "").trim() || `${origin}/api/auth/saml?org=${org.id}`;
      const attributeEmail = String(body.attributeEmail || "").trim() || "email";
      const attributeName = String(body.attributeName || "").trim() || "name";
      const attributeRole = String(body.attributeRole || "").trim() || "role";
      const defaultRole = (["owner", "maintainer", "viewer"].includes(body.defaultRole)
        ? body.defaultRole
        : "viewer") as "owner" | "maintainer" | "viewer";
      const allowedDomains = body.allowedDomains
        ? String(body.allowedDomains)
            .split(",")
            .map((d) => d.trim().toLowerCase().replace(/^@/, ""))
            .filter(Boolean)
            .join(", ")
        : null;
      const isActive = Boolean(body.isActive);

      if (!idpEntityId || !idpSsoUrl || !idpCertificate) {
        return NextResponse.json(
          { error: "IdP Entity ID, IdP SSO URL, and X.509 Certificate are all required." },
          { status: 400 }
        );
      }

      try {
        const parsed = new URL(idpSsoUrl);
        if (parsed.protocol !== "https:") {
          return NextResponse.json(
            { error: "IdP SSO URL must start with https://" },
            { status: 400 }
          );
        }
      } catch {
        return NextResponse.json({ error: "Invalid IdP SSO URL" }, { status: 400 });
      }

      const certCheck = await inspectX509Certificate(idpCertificate);
      if (!certCheck.valid) {
        return NextResponse.json(
          { error: `Invalid X.509 certificate: ${certCheck.error}` },
          { status: 400 }
        );
      }

      const [existing] = await db
        .select({ id: samlConfig.id })
        .from(samlConfig)
        .where(eq(samlConfig.organizationId, organizationId))
        .limit(1);

      const now = new Date().toISOString();
      const cfgId = existing?.id || `saml_${crypto.randomUUID().replace(/-/g, "").slice(0, 14)}`;

      if (existing) {
        await db
          .update(samlConfig)
          .set({
            provider,
            idpEntityId,
            idpSsoUrl,
            idpCertificate,
            spEntityId,
            attributeEmail,
            attributeName,
            attributeRole,
            defaultRole,
            allowedDomains,
            isActive,
            updatedAt: now,
          })
          .where(eq(samlConfig.id, existing.id));
      } else {
        await db.insert(samlConfig).values({
          id: cfgId,
          organizationId,
          provider,
          idpEntityId,
          idpSsoUrl,
          idpCertificate,
          spEntityId,
          attributeEmail,
          attributeName,
          attributeRole,
          defaultRole,
          allowedDomains,
          isActive,
        });
      }

      await recordAuditEvent({
        userId: user.id,
        actorUsername: user.githubUsername,
        organizationId,
        action: "sso.saml_configured",
        resourceType: "saml_config",
        resourceId: cfgId,
        headers: req.headers,
        metadata: {
          provider,
          idpEntityId,
          isActive,
          certFingerprint: certCheck.sha256Fingerprint,
          allowedDomains,
        },
      });

      const [saved] = await db
        .select()
        .from(samlConfig)
        .where(eq(samlConfig.id, cfgId))
        .limit(1);

      return NextResponse.json({
        success: true,
        samlConfig: saved,
        certificate: certCheck,
      });
    }

    if (action === "create_scim_token") {
      const label = String(body.label || "").trim() || "Okta / Entra SCIM Token";
      const { rawToken, prefix } = generateScimBearerToken();
      const tokenHash = await hashApiKey(rawToken);
      const tokenId = `scim_${crypto.randomUUID().replace(/-/g, "").slice(0, 14)}`;

      await db.insert(scimTokens).values({
        id: tokenId,
        organizationId,
        tokenHash,
        tokenPrefix: prefix,
        label,
        status: "active",
        createdByUserId: user.id,
      });

      await recordAuditEvent({
        userId: user.id,
        actorUsername: user.githubUsername,
        organizationId,
        action: "sso.scim_token_created",
        resourceType: "scim_token",
        resourceId: tokenId,
        headers: req.headers,
        metadata: { label, tokenPrefix: prefix },
      });

      return NextResponse.json({
        success: true,
        rawToken,
        token: {
          id: tokenId,
          label,
          tokenPrefix: prefix,
          status: "active",
          createdAt: new Date().toISOString(),
        },
      });
    }

    if (action === "revoke_scim_token") {
      const tokenId = String(body.tokenId || "").trim();
      if (!tokenId) {
        return NextResponse.json({ error: "Missing tokenId" }, { status: 400 });
      }

      await db
        .update(scimTokens)
        .set({ status: "revoked", revokedAt: new Date().toISOString() })
        .where(and(eq(scimTokens.id, tokenId), eq(scimTokens.organizationId, organizationId)));

      await recordAuditEvent({
        userId: user.id,
        actorUsername: user.githubUsername,
        organizationId,
        action: "sso.scim_token_revoked",
        resourceType: "scim_token",
        resourceId: tokenId,
        headers: req.headers,
      });

      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ error: "Unsupported SSO/SCIM action" }, { status: 400 });
  } catch (err) {
    console.error("POST /api/v1/security/saml error:", err);
    return NextResponse.json({ error: "SSO / SCIM operation failed" }, { status: 500 });
  }
}
