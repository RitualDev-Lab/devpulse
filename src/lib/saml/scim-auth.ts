import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { scimTokens, organizations, organizationMembers, users } from "@/db/schema";
import { eq } from "drizzle-orm";
import { hashApiKey } from "@/lib/security/api-keys";
import type { OrgRole } from "@/lib/security/rbac";

export const SCIM_CONTENT_TYPE = "application/scim+json; charset=utf-8";

export interface ScimAuthContext {
  tokenId: string;
  organizationId: string;
  orgOwnerUserId: string;
  orgName: string;
  baseUrl: string;
}

export function resolveScimBaseUrl(req: NextRequest): string {
  const fwdHost = req.headers.get("x-forwarded-host");
  const fwdProto = req.headers.get("x-forwarded-proto") || "https";
  const origin =
    fwdHost && process.env.NODE_ENV !== "development"
      ? `${fwdProto}://${fwdHost}`
      : req.nextUrl.origin;
  return `${origin}/api/scim/v2`;
}

export function scimJson(body: unknown, status = 200): NextResponse {
  return new NextResponse(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": SCIM_CONTENT_TYPE,
      "Cache-Control": "no-store",
    },
  });
}

export function scimError(detail: string, status: number, scimType?: string): NextResponse {
  const payload: Record<string, unknown> = {
    schemas: ["urn:ietf:params:scim:api:messages:2.0:Error"],
    detail,
    status: String(status),
  };
  if (scimType) payload.scimType = scimType;
  return scimJson(payload, status);
}

/**
 * Authenticates an incoming SCIM 2.0 Bearer request against active SHA-256 hashed tokens.
 */
export async function authenticateScimRequest(
  req: NextRequest
): Promise<{ ok: true; ctx: ScimAuthContext } | { ok: false; response: NextResponse }> {
  const authHeader = req.headers.get("authorization") || "";
  if (!authHeader.toLowerCase().startsWith("bearer ")) {
    return {
      ok: false,
      response: scimError("Missing or invalid Bearer token", 401),
    };
  }

  const rawToken = authHeader.slice(7).trim();
  if (!rawToken) {
    return {
      ok: false,
      response: scimError("Empty Bearer token", 401),
    };
  }

  const tokenHash = await hashApiKey(rawToken);
  const [tokenRow] = await db
    .select()
    .from(scimTokens)
    .where(eq(scimTokens.tokenHash, tokenHash))
    .limit(1);

  if (!tokenRow || tokenRow.status !== "active") {
    return {
      ok: false,
      response: scimError("Invalid or revoked SCIM Bearer token", 401),
    };
  }

  const [org] = await db
    .select()
    .from(organizations)
    .where(eq(organizations.id, tokenRow.organizationId))
    .limit(1);

  if (!org) {
    return {
      ok: false,
      response: scimError("Organization no longer exists", 404),
    };
  }

  // Best-effort lastUsedAt stamp
  db.update(scimTokens)
    .set({ lastUsedAt: new Date().toISOString() })
    .where(eq(scimTokens.id, tokenRow.id))
    .catch(() => {});

  return {
    ok: true,
    ctx: {
      tokenId: tokenRow.id,
      organizationId: org.id,
      orgOwnerUserId: org.ownerUserId,
      orgName: org.name,
      baseUrl: resolveScimBaseUrl(req),
    },
  };
}

export function mapScimRole(raw?: string | null): OrgRole {
  const r = String(raw || "").trim().toLowerCase();
  if (r.includes("owner") || r.includes("admin")) return "owner";
  if (r.includes("maintain") || r.includes("dev") || r.includes("write")) return "maintainer";
  return "viewer";
}

export function deriveScimUsernameHandle(identifier: string): string {
  const base = identifier
    .split("@")[0]
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 20) || "scim";
  const suffix = crypto.randomUUID().replace(/-/g, "").slice(0, 6);
  return `${base}-scim-${suffix}`;
}

export function toScimUser(
  member: typeof organizationMembers.$inferSelect,
  userRow: typeof users.$inferSelect | undefined,
  baseUrl: string
) {
  const email = (member.email || userRow?.email || "").toLowerCase();
  const displayName = userRow?.name || member.githubUsername;
  const parts = displayName.trim().split(/\s+/);
  const givenName = parts[0] || displayName;
  const familyName = parts.slice(1).join(" ") || "";

  return {
    schemas: ["urn:ietf:params:scim:schemas:core:2.0:User"],
    id: member.id,
    externalId: member.scimExternalId || undefined,
    userName: email || member.githubUsername,
    displayName,
    name: {
      formatted: displayName,
      givenName,
      familyName,
    },
    emails: email
      ? [
          {
            value: email,
            type: "work",
            primary: true,
          },
        ]
      : [],
    active: member.status !== "suspended",
    roles: [
      {
        value: member.role,
        display: member.role,
        primary: true,
      },
    ],
    meta: {
      resourceType: "User",
      created: member.createdAt,
      lastModified: member.updatedAt,
      location: `${baseUrl}/Users/${member.id}`,
    },
  };
}

export interface ParsedScimUserInput {
  email: string;
  userName: string;
  displayName: string;
  externalId: string | null;
  active: boolean;
  role: OrgRole;
}

export function parseScimUserPayload(body: Record<string, unknown>): ParsedScimUserInput {
  const userName = String(body.userName || "").trim();
  const emails = Array.isArray(body.emails)
    ? (body.emails as Array<{ value?: string; primary?: boolean }>)
    : [];
  const primaryEmail = emails.find((e) => e.primary)?.value || emails[0]?.value || "";
  const email = (primaryEmail || (userName.includes("@") ? userName : ""))
    .trim()
    .toLowerCase();

  const nameObj = (body.name && typeof body.name === "object"
    ? body.name
    : {}) as Record<string, unknown>;
  const formattedName = String(
    body.displayName ||
      nameObj.formatted ||
      [nameObj.givenName, nameObj.familyName].filter(Boolean).join(" ") ||
      email.split("@")[0] ||
      userName
  ).trim();

  const roles = Array.isArray(body.roles)
    ? (body.roles as Array<{ value?: string; primary?: boolean }>)
    : [];
  const primaryRole = roles.find((r) => r.primary)?.value || roles[0]?.value;

  return {
    email,
    userName: userName || email,
    displayName: formattedName,
    externalId: body.externalId ? String(body.externalId).trim() : null,
    active: body.active === undefined ? true : Boolean(body.active),
    role: mapScimRole(primaryRole),
  };
}

export function parseScimEqFilter(filterStr?: string | null): {
  field: string;
  value: string;
} | null {
  if (!filterStr) return null;
  // Check complex path filter first: emails[type eq "work"].value eq "bob@acme.com"
  const bracketMatch = filterStr
    .trim()
    .match(/^emails\[[^\]]+\]\.value\s+eq\s+"([^"]+)"/i);
  if (bracketMatch) {
    return { field: "emails.value", value: bracketMatch[1].trim().toLowerCase() };
  }
  // Standard Okta/Entra filters: userName eq "alice@acme.com", emails.value eq "...", externalId eq "..."
  const m = filterStr.trim().match(/^([^\s]+)\s+eq\s+"([^"]+)"/i);
  if (m) {
    return { field: m[1].toLowerCase(), value: m[2].trim().toLowerCase() };
  }
  return null;
}
