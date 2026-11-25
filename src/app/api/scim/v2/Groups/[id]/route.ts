import { NextRequest } from "next/server";
import { db } from "@/db";
import { organizationMembers } from "@/db/schema";
import { eq, and, inArray } from "drizzle-orm";
import { authenticateScimRequest, mapScimRole, scimError, scimJson } from "@/lib/saml/scim-auth";
import { recordAuditEvent } from "@/lib/security/audit";
import type { OrgRole } from "@/lib/security/rbac";

export const dynamic = "force-dynamic";

function resolveGroupRole(id: string): OrgRole | null {
  const clean = id.trim().toLowerCase();
  if (clean === "maintainer") return "developer";
  if (["owner", "admin", "developer", "viewer", "billing"].includes(clean)) return clean as OrgRole;
  return null;
}

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const auth = await authenticateScimRequest(req);
  if (!auth.ok) return auth.response;

  const { id } = await context.params;
  const role = resolveGroupRole(id);
  if (!role) return scimError("Group not found (valid IDs: owner, maintainer, viewer)", 404);

  const members = await db
    .select()
    .from(organizationMembers)
    .where(
      and(
        eq(organizationMembers.organizationId, auth.ctx.organizationId),
        eq(organizationMembers.role, role)
      )
    );

  return scimJson({
    schemas: ["urn:ietf:params:scim:schemas:core:2.0:Group"],
    id: role,
    displayName: `DevPulse ${role[0].toUpperCase()}${role.slice(1)}s`,
    members: members.map((m) => ({
      value: m.id,
      display: m.email || m.githubUsername,
      $ref: `${auth.ctx.baseUrl}/Users/${m.id}`,
    })),
    meta: {
      resourceType: "Group",
      location: `${auth.ctx.baseUrl}/Groups/${role}`,
    },
  });
}

/**
 * PATCH /api/scim/v2/Groups/[id]
 * Syncs Okta / Entra ID Group Push membership directly to DevPulse RBAC roles.
 */
export async function PATCH(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const auth = await authenticateScimRequest(req);
  if (!auth.ok) return auth.response;

  const { id } = await context.params;
  const role = resolveGroupRole(id) || mapScimRole(id);
  const body = (await req.json()) as {
    Operations?: Array<{ op?: string; path?: string; value?: unknown }>;
  };

  const ops = Array.isArray(body.Operations) ? body.Operations : [];
  const now = new Date().toISOString();

  for (const op of ops) {
    const opType = String(op.op || "replace").toLowerCase();
    const list = Array.isArray(op.value)
      ? (op.value as Array<{ value?: string }>).map((v) => String(v.value || "")).filter(Boolean)
      : [];
    if (list.length === 0) continue;

    if (opType === "remove") {
      await db
        .update(organizationMembers)
        .set({ role: "viewer", updatedAt: now })
        .where(
          and(
            eq(organizationMembers.organizationId, auth.ctx.organizationId),
            inArray(organizationMembers.id, list)
          )
        );
    } else {
      await db
        .update(organizationMembers)
        .set({ role, updatedAt: now })
        .where(
          and(
            eq(organizationMembers.organizationId, auth.ctx.organizationId),
            inArray(organizationMembers.id, list)
          )
        );
    }
  }

  await recordAuditEvent({
    userId: auth.ctx.orgOwnerUserId,
    actorUsername: "scim-provisioner",
    organizationId: auth.ctx.organizationId,
    action: "scim.group_synced",
    resourceType: "organization_member",
    resourceId: role,
    headers: req.headers,
  });

  return GET(req, context);
}
