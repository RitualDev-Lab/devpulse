import { db } from "@/db";
import { projects, organizations, organizationMembers } from "@/db/schema";
import { eq, and, or, desc, inArray } from "drizzle-orm";
import type { AuthenticatedUser } from "@/lib/auth";

export type OrgRole = "owner" | "maintainer" | "viewer";

export interface ProjectAccessResult {
  project: typeof projects.$inferSelect;
  role: OrgRole;
  canRead: boolean;
  canWrite: boolean; // owner | maintainer
  canManageSecurity: boolean; // owner only (key rotation, billing, domains, org RBAC)
}

export function roleAllowsWrite(role: OrgRole): boolean {
  return role === "owner" || role === "maintainer";
}

export function roleAllowsSecurityAdmin(role: OrgRole): boolean {
  return role === "owner";
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
    };
  }

  const normalizedHandle = user.githubUsername.toLowerCase();
  const [membership] = await db
    .select()
    .from(organizationMembers)
    .where(
      and(
        eq(organizationMembers.organizationId, proj.organizationId),
        or(
          eq(organizationMembers.userId, user.id),
          eq(organizationMembers.githubUsername, normalizedHandle)
        )
      )
    )
    .limit(1);

  if (!membership) return null;

  // Bind pending invitation cleanly on first access
  if (!membership.userId || membership.status === "pending") {
    db.update(organizationMembers)
      .set({ userId: user.id, status: "active", updatedAt: new Date().toISOString() })
      .where(eq(organizationMembers.id, membership.id))
      .catch(() => {});
  }

  const role = membership.role as OrgRole;
  return {
    project: proj,
    role,
    canRead: true,
    canWrite: roleAllowsWrite(role),
    canManageSecurity: roleAllowsSecurityAdmin(role),
  };
}

/**
 * Lists all projects accessible to a maintainer (direct owned + organization-shared).
 */
export async function listAccessibleProjects(user: AuthenticatedUser) {
  const normalizedHandle = user.githubUsername.toLowerCase();

  const memberships = await db
    .select({
      organizationId: organizationMembers.organizationId,
      role: organizationMembers.role,
    })
    .from(organizationMembers)
    .where(
      or(
        eq(organizationMembers.userId, user.id),
        eq(organizationMembers.githubUsername, normalizedHandle)
      )
    );

  const ownedOrgs = await db
    .select({ id: organizations.id })
    .from(organizations)
    .where(eq(organizations.ownerUserId, user.id));

  const orgRoleMap = new Map<string, OrgRole>();
  for (const m of memberships) {
    orgRoleMap.set(m.organizationId, m.role as OrgRole);
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
}
