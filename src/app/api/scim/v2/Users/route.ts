import { NextRequest } from "next/server";
import { db } from "@/db";
import { organizationMembers, users } from "@/db/schema";
import { eq, and, or, inArray, sql } from "drizzle-orm";
import {
  authenticateScimRequest,
  deriveScimUsernameHandle,
  parseScimEqFilter,
  parseScimUserPayload,
  scimError,
  scimJson,
  toScimUser,
} from "@/lib/saml/scim-auth";
import { recordAuditEvent } from "@/lib/security/audit";

export const dynamic = "force-dynamic";

/**
 * GET /api/scim/v2/Users
 * Lists or filters provisioned members of the SCIM-scoped organization.
 */
export async function GET(req: NextRequest) {
  const auth = await authenticateScimRequest(req);
  if (!auth.ok) return auth.response;

  const { ctx } = auth;
  const startIndex = Math.max(1, Number(req.nextUrl.searchParams.get("startIndex") || 1));
  const count = Math.min(200, Math.max(1, Number(req.nextUrl.searchParams.get("count") || 100)));
  const filter = parseScimEqFilter(req.nextUrl.searchParams.get("filter"));

  const members = await db
    .select()
    .from(organizationMembers)
    .where(eq(organizationMembers.organizationId, ctx.organizationId));

  const userIds = members.map((m) => m.userId).filter(Boolean) as string[];
  const userRows =
    userIds.length > 0
      ? await db.select().from(users).where(inArray(users.id, userIds))
      : [];
  const userMap = new Map(userRows.map((u) => [u.id, u]));

  let resources = members.map((m) =>
    toScimUser(m, m.userId ? userMap.get(m.userId) : undefined, ctx.baseUrl)
  );

  if (filter) {
    resources = resources.filter((r) => {
      if (filter.field === "username") {
        return r.userName.toLowerCase() === filter.value;
      }
      if (filter.field === "emails.value" || filter.field === "email") {
        return r.emails.some((e) => e.value.toLowerCase() === filter.value);
      }
      if (filter.field === "externalid") {
        return (r.externalId || "").toLowerCase() === filter.value;
      }
      if (filter.field === "id") {
        return r.id.toLowerCase() === filter.value;
      }
      return true;
    });
  }

  const totalResults = resources.length;
  const paged = resources.slice(startIndex - 1, startIndex - 1 + count);

  return scimJson({
    schemas: ["urn:ietf:params:scim:api:messages:2.0:ListResponse"],
    totalResults,
    startIndex,
    itemsPerPage: paged.length,
    Resources: paged,
  });
}

/**
 * POST /api/scim/v2/Users
 * Auto-provisions a user from Okta / Azure AD / Google Workspace into Turso + org RBAC.
 */
export async function POST(req: NextRequest) {
  const auth = await authenticateScimRequest(req);
  if (!auth.ok) return auth.response;

  const { ctx } = auth;
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return scimError("Invalid JSON payload", 400, "invalidSyntax");
  }

  const parsed = parseScimUserPayload(body);
  if (!parsed.email && !parsed.userName) {
    return scimError("SCIM User requires userName or emails[0].value", 400, "invalidValue");
  }

  const lookupEmail = parsed.email || parsed.userName.toLowerCase();

  // Check for existing organization member
  const [existingMem] = await db
    .select()
    .from(organizationMembers)
    .where(
      and(
        eq(organizationMembers.organizationId, ctx.organizationId),
        or(
          sql`lower(${organizationMembers.email}) = ${lookupEmail}`,
          parsed.externalId ? eq(organizationMembers.scimExternalId, parsed.externalId) : sql`0`
        )
      )
    )
    .limit(1);

  if (existingMem) {
    // RFC 7644 allows 409 uniqueness conflict if active duplicate, or update if suspended/pending
    if (existingMem.status === "active") {
      return scimError("User already exists in organization", 409, "uniqueness");
    }
  }

  // Find or create user in Turso
  let [userRow] = parsed.email
    ? await db
        .select()
        .from(users)
        .where(sql`lower(${users.email}) = ${parsed.email}`)
        .limit(1)
    : [];

  if (!userRow) {
    const newUserId = `scim_${crypto.randomUUID().replace(/-/g, "")}`;
    const handle = deriveScimUsernameHandle(parsed.email || parsed.userName);
    await db.insert(users).values({
      id: newUserId,
      githubUsername: handle,
      name: parsed.displayName || handle,
      email: parsed.email || null,
      storageTier: "team",
      customDomainVerified: false,
    });
    const [created] = await db.select().from(users).where(eq(users.id, newUserId)).limit(1);
    userRow = created;
  } else if (parsed.displayName && parsed.displayName !== userRow.name) {
    await db
      .update(users)
      .set({ name: parsed.displayName, updatedAt: new Date().toISOString() })
      .where(eq(users.id, userRow.id));
  }

  const now = new Date().toISOString();
  const targetStatus = parsed.active ? "active" : "suspended";
  let memId = existingMem?.id;

  if (existingMem) {
    await db
      .update(organizationMembers)
      .set({
        userId: userRow.id,
        email: parsed.email || existingMem.email,
        scimExternalId: parsed.externalId || existingMem.scimExternalId,
        status: targetStatus,
        role: existingMem.role === "owner" ? "owner" : parsed.role,
        updatedAt: now,
      })
      .where(eq(organizationMembers.id, existingMem.id));
  } else {
    memId = `mem_${crypto.randomUUID().replace(/-/g, "").slice(0, 14)}`;
    await db.insert(organizationMembers).values({
      id: memId,
      organizationId: ctx.organizationId,
      userId: userRow.id,
      githubUsername: userRow.githubUsername,
      email: parsed.email || null,
      scimExternalId: parsed.externalId,
      role: parsed.role,
      status: targetStatus,
      invitedByUserId: ctx.orgOwnerUserId,
    });
  }

  const [finalMember] = await db
    .select()
    .from(organizationMembers)
    .where(eq(organizationMembers.id, memId!))
    .limit(1);

  await recordAuditEvent({
    userId: ctx.orgOwnerUserId,
    actorUsername: "scim-provisioner",
    organizationId: ctx.organizationId,
    action: "scim.user_provisioned",
    resourceType: "organization_member",
    resourceId: memId,
    headers: req.headers,
    metadata: { email: parsed.email, externalId: parsed.externalId, status: targetStatus },
  });

  return scimJson(toScimUser(finalMember, userRow, ctx.baseUrl), 201);
}
