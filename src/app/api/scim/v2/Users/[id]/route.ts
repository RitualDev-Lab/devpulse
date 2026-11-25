import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { organizationMembers, users } from "@/db/schema";
import { eq, and, or } from "drizzle-orm";
import {
  authenticateScimRequest,
  mapScimRole,
  parseScimUserPayload,
  scimError,
  scimJson,
  toScimUser,
} from "@/lib/saml/scim-auth";
import { recordAuditEvent } from "@/lib/security/audit";

export const dynamic = "force-dynamic";

async function findOrgMember(organizationId: string, idOrUserId: string) {
  const [mem] = await db
    .select()
    .from(organizationMembers)
    .where(
      and(
        eq(organizationMembers.organizationId, organizationId),
        or(
          eq(organizationMembers.id, idOrUserId),
          eq(organizationMembers.userId, idOrUserId),
          eq(organizationMembers.scimExternalId, idOrUserId)
        )
      )
    )
    .limit(1);
  return mem || null;
}

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const auth = await authenticateScimRequest(req);
  if (!auth.ok) return auth.response;

  const { id } = await context.params;
  const mem = await findOrgMember(auth.ctx.organizationId, id);
  if (!mem) return scimError("User not found", 404);

  const [userRow] = mem.userId
    ? await db.select().from(users).where(eq(users.id, mem.userId)).limit(1)
    : [];

  return scimJson(toScimUser(mem, userRow, auth.ctx.baseUrl));
}

export async function PUT(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const auth = await authenticateScimRequest(req);
  if (!auth.ok) return auth.response;

  const { id } = await context.params;
  const mem = await findOrgMember(auth.ctx.organizationId, id);
  if (!mem) return scimError("User not found", 404);

  const body = (await req.json()) as Record<string, unknown>;
  const parsed = parseScimUserPayload(body);

  if (!parsed.active && mem.userId === auth.ctx.orgOwnerUserId) {
    return scimError("Cannot suspend primary Organization Owner", 400);
  }

  const nextStatus = parsed.active ? "active" : "suspended";
  const now = new Date().toISOString();

  await db
    .update(organizationMembers)
    .set({
      email: parsed.email || mem.email,
      scimExternalId: parsed.externalId || mem.scimExternalId,
      status: nextStatus,
      role: mem.userId === auth.ctx.orgOwnerUserId ? "owner" : parsed.role,
      updatedAt: now,
    })
    .where(eq(organizationMembers.id, mem.id));

  if (mem.userId && (parsed.displayName || parsed.email)) {
    await db
      .update(users)
      .set({
        ...(parsed.displayName ? { name: parsed.displayName } : {}),
        ...(parsed.email ? { email: parsed.email } : {}),
        updatedAt: now,
      })
      .where(eq(users.id, mem.userId));
  }

  const [updated] = await db
    .select()
    .from(organizationMembers)
    .where(eq(organizationMembers.id, mem.id))
    .limit(1);
  const [userRow] = updated.userId
    ? await db.select().from(users).where(eq(users.id, updated.userId)).limit(1)
    : [];

  await recordAuditEvent({
    userId: auth.ctx.orgOwnerUserId,
    actorUsername: "scim-provisioner",
    organizationId: auth.ctx.organizationId,
    action: parsed.active ? "scim.user_updated" : "scim.user_deprovisioned",
    resourceType: "organization_member",
    resourceId: mem.id,
    headers: req.headers,
    metadata: { status: nextStatus, email: updated.email },
  });

  return scimJson(toScimUser(updated, userRow, auth.ctx.baseUrl));
}

/**
 * PATCH /api/scim/v2/Users/[id]
 * Handles RFC 7644 PatchOp sent by Okta & Azure AD (most notably `active: false` deprovisioning).
 */
export async function PATCH(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const auth = await authenticateScimRequest(req);
  if (!auth.ok) return auth.response;

  const { id } = await context.params;
  const mem = await findOrgMember(auth.ctx.organizationId, id);
  if (!mem) return scimError("User not found", 404);

  let body: { Operations?: Array<{ op?: string; path?: string; value?: unknown }> };
  try {
    body = await req.json();
  } catch {
    return scimError("Invalid PATCH JSON", 400, "invalidSyntax");
  }

  const ops = Array.isArray(body.Operations) ? body.Operations : [];
  let nextStatus = mem.status;
  let nextEmail = mem.email;
  let nextExternalId = mem.scimExternalId;
  let nextRole = mem.role;
  let nextDisplayName: string | null = null;

  for (const op of ops) {
    const opType = String(op.op || "replace").toLowerCase();
    const path = String(op.path || "").toLowerCase();
    const val = op.value;

    if (opType === "remove") {
      if (path === "active") nextStatus = "suspended";
      continue;
    }

    if (path === "active") {
      const activeBool = val === true || val === "true";
      nextStatus = activeBool ? "active" : "suspended";
    } else if (path === "displayname" || path === "name.formatted") {
      if (typeof val === "string" && val.trim()) nextDisplayName = val.trim();
    } else if (path === "externalid") {
      if (typeof val === "string") nextExternalId = val.trim();
    } else if (path === "username" || path.startsWith("emails")) {
      if (typeof val === "string" && val.includes("@")) nextEmail = val.trim().toLowerCase();
    } else if (path === "roles" && Array.isArray(val) && val[0]?.value) {
      nextRole = mapScimRole(String(val[0].value));
    } else if (!path && val && typeof val === "object") {
      const obj = val as Record<string, unknown>;
      if ("active" in obj) {
        nextStatus = obj.active === true || obj.active === "true" ? "active" : "suspended";
      }
      if (typeof obj.displayName === "string" && obj.displayName.trim()) {
        nextDisplayName = obj.displayName.trim();
      }
      if (typeof obj.externalId === "string") {
        nextExternalId = obj.externalId.trim();
      }
      if (typeof obj.userName === "string" && obj.userName.includes("@")) {
        nextEmail = obj.userName.trim().toLowerCase();
      }
    }
  }

  if (nextStatus === "suspended" && mem.userId === auth.ctx.orgOwnerUserId) {
    return scimError("Cannot suspend primary Organization Owner", 400);
  }

  const now = new Date().toISOString();
  await db
    .update(organizationMembers)
    .set({
      status: nextStatus,
      email: nextEmail,
      scimExternalId: nextExternalId,
      role: mem.userId === auth.ctx.orgOwnerUserId ? "owner" : nextRole,
      updatedAt: now,
    })
    .where(eq(organizationMembers.id, mem.id));

  if (mem.userId && (nextDisplayName || nextEmail)) {
    await db
      .update(users)
      .set({
        ...(nextDisplayName ? { name: nextDisplayName } : {}),
        ...(nextEmail ? { email: nextEmail } : {}),
        updatedAt: now,
      })
      .where(eq(users.id, mem.userId));
  }

  const [updated] = await db
    .select()
    .from(organizationMembers)
    .where(eq(organizationMembers.id, mem.id))
    .limit(1);
  const [userRow] = updated.userId
    ? await db.select().from(users).where(eq(users.id, updated.userId)).limit(1)
    : [];

  await recordAuditEvent({
    userId: auth.ctx.orgOwnerUserId,
    actorUsername: "scim-provisioner",
    organizationId: auth.ctx.organizationId,
    action: nextStatus === "suspended" ? "scim.user_deprovisioned" : "scim.user_updated",
    resourceType: "organization_member",
    resourceId: mem.id,
    headers: req.headers,
    metadata: { status: nextStatus, email: updated.email },
  });

  return scimJson(toScimUser(updated, userRow, auth.ctx.baseUrl));
}

export async function DELETE(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const auth = await authenticateScimRequest(req);
  if (!auth.ok) return auth.response;

  const { id } = await context.params;
  const mem = await findOrgMember(auth.ctx.organizationId, id);
  if (!mem) return scimError("User not found", 404);

  if (mem.userId === auth.ctx.orgOwnerUserId) {
    return scimError("Cannot delete primary Organization Owner", 400);
  }

  await db.delete(organizationMembers).where(eq(organizationMembers.id, mem.id));

  await recordAuditEvent({
    userId: auth.ctx.orgOwnerUserId,
    actorUsername: "scim-provisioner",
    organizationId: auth.ctx.organizationId,
    action: "scim.user_deleted",
    resourceType: "organization_member",
    resourceId: mem.id,
    headers: req.headers,
    metadata: { email: mem.email },
  });

  return new NextResponse(null, { status: 204 });
}
