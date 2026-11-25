import { cache } from "react";
import { db } from "@/db";
import { projects, organizations, organizationMembers } from "@/db/schema";
import { eq, and, or, desc, inArray, sql } from "drizzle-orm";
import type { AuthenticatedUser } from "@/lib/auth";

export type OrgRole = "owner" | "admin" | "developer" | "viewer" | "billing";

export const VALID_ORG_ROLES: readonly OrgRole[] = [
  "owner",
  "admin",
  "developer",
  "viewer",
  "billing",
];

/**
 * Normalizes legacy role names ("maintainer" -> "developer") cleanly.
 */
export function normalizeOrgRole(raw?: string | null): OrgRole {
  const r = String(raw || "viewer").trim().toLowerCase();
  if (r === "maintainer") return "developer";
  if ((VALID_ORG_ROLES as readonly string[]).includes(r)) return r as OrgRole;
  return "viewer";
}

export interface ProjectAccessResult {
  project: typeof projects.$inferSelect;
  role: OrgRole;
  canRead: boolean;
  canWrite: boolean; // owner | admin | developer
  canManageSecurity: boolean; // owner | admin
  canManageBilling: boolean; // owner | billing
}

export function roleAllowsWrite(role: OrgRole): boolean {
  return role === "owner" || role === "admin" || role === "developer";
}

export function roleAllowsSecurityAdmin(role: OrgRole): boolean {
  return role === "owner" || role === "admin";
}

export function roleAllowsBilling(role: OrgRole): boolean {
  return role === "owner" || role === "billing";
}

/**
 * Resolves a user's effective RBAC role for a specific project:
 * - Direct creator (project.userId === user.id) -> "owner"
 * - Organization owner -> "owner"
 * - Active Organization member matching userId or githubUsername -> member.role ("owner" | "maintainer" | "viewer")
 */
export async function resolveProjectAccess(
  projectId: string,
  user: AuthenticatedUser
): Promise<ProjectAccessResult | null> {
  const [proj] = await db
    .select()
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);

  if (!proj) return null;

  if (proj.userId === user.id) {
    return {
      project: proj,
      role: "owner",
      canRead: true,
      canWrite: true,
      canManageSecurity: true,
      canManageBilling: true,
    };
  }

  if (!proj.organizationId) {
    return null;
  }

  const [org] = await db
    .select()
    .from(organizations)
    .where(eq(organizations.id, proj.organizationId))
    .limit(1);

  if (org && org.ownerUserId === user.id) {
    return {
      project: proj,
      role: "owner",
      canRead: true,
      canWrite: true,
      canManageSecurity: true,
      canManageBilling: true,
    };
  }

  const normalizedHandle = user.githubUsername.toLowerCase();
  const normalizedEmail = user.email ? user.email.toLowerCase() : null;
  const [membership] = await db
    .select()
    .from(organizationMembers)
    .where(
      and(
        eq(organizationMembers.organizationId, proj.organizationId),
        or(
          eq(organizationMembers.userId, user.id),
          eq(organizationMembers.githubUsername, normalizedHandle),
          normalizedEmail ? sql`lower(${organizationMembers.email}) = ${normalizedEmail}` : sql`0`
        )
      )
    )
    .limit(1);

  if (!membership || membership.status === "suspended") return null;

  // Bind pending invitation cleanly on first access
  if (!membership.userId || membership.status === "pending") {
    db.update(organizationMembers)
      .set({ userId: user.id, status: "active", updatedAt: new Date().toISOString() })
      .where(eq(organizationMembers.id, membership.id))
      .catch(() => {});
  }

  const role = normalizeOrgRole(membership.role);
  return {
    project: proj,
    role,
    canRead: true,
    canWrite: roleAllowsWrite(role),
    canManageSecurity: roleAllowsSecurityAdmin(role),
    canManageBilling: roleAllowsBilling(role),
  };
}

/**
 * Lists all projects accessible to a user across multi-org / workspace memberships.
 */
export const listAccessibleProjects = cache(async function listAccessibleProjects(user: AuthenticatedUser) {
  const normalizedHandle = user.githubUsername.toLowerCase();
  const normalizedEmail = user.email ? user.email.toLowerCase() : null;

  const [memberships, ownedOrgs] = await Promise.all([
    db
      .select({
        organizationId: organizationMembers.organizationId,
        role: organizationMembers.role,
        status: organizationMembers.status,
      })
      .from(organizationMembers)
      .where(
        or(
          eq(organizationMembers.userId, user.id),
          eq(organizationMembers.githubUsername, normalizedHandle),
          normalizedEmail ? sql`lower(${organizationMembers.email}) = ${normalizedEmail}` : sql`0`
        )
      ),
    db
      .select({ id: organizations.id })
      .from(organizations)
      .where(eq(organizations.ownerUserId, user.id)),
  ]);

  const orgRoleMap = new Map<string, OrgRole>();
  for (const m of memberships) {
    if (m.status === "suspended") continue;
    orgRoleMap.set(m.organizationId, normalizeOrgRole(m.role));
  }
  for (const o of ownedOrgs) {
    orgRoleMap.set(o.id, "owner");
  }

  const orgIds = Array.from(orgRoleMap.keys());

  const rows =
    orgIds.length > 0
      ? await db
          .select()
          .from(projects)
          .where(or(eq(projects.userId, user.id), inArray(projects.organizationId, orgIds)))
          .orderBy(desc(projects.createdAt))
      : await db
          .select()
          .from(projects)
          .where(eq(projects.userId, user.id))
          .orderBy(desc(projects.createdAt));

  return rows.map((p) => {
    const role: OrgRole =
      p.userId === user.id
        ? "owner"
        : (p.organizationId && orgRoleMap.get(p.organizationId)) || "viewer";
    return { ...p, accessRole: role };
  });
});
