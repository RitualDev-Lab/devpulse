import { NextRequest } from "next/server";
import { db } from "@/db";
import { organizationMembers } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { authenticateScimRequest, scimJson } from "@/lib/saml/scim-auth";
import type { OrgRole } from "@/lib/security/rbac";

export const dynamic = "force-dynamic";

const ROLE_GROUPS: Array<{ id: OrgRole; displayName: string }> = [
  { id: "owner", displayName: "DevPulse Owners" },
  { id: "maintainer", displayName: "DevPulse Maintainers" },
  { id: "viewer", displayName: "DevPulse Viewers" },
];

export async function GET(req: NextRequest) {
  const auth = await authenticateScimRequest(req);
  if (!auth.ok) return auth.response;

  const members = await db
    .select()
    .from(organizationMembers)
    .where(
      and(
        eq(organizationMembers.organizationId, auth.ctx.organizationId),
        eq(organizationMembers.status, "active")
      )
    );

  const resources = ROLE_GROUPS.map((g) => ({
    schemas: ["urn:ietf:params:scim:schemas:core:2.0:Group"],
    id: g.id,
    displayName: g.displayName,
    members: members
      .filter((m) => m.role === g.id)
      .map((m) => ({
        value: m.id,
        display: m.email || m.githubUsername,
        $ref: `${auth.ctx.baseUrl}/Users/${m.id}`,
      })),
    meta: {
      resourceType: "Group",
      location: `${auth.ctx.baseUrl}/Groups/${g.id}`,
    },
  }));

  return scimJson({
    schemas: ["urn:ietf:params:scim:api:messages:2.0:ListResponse"],
    totalResults: resources.length,
    startIndex: 1,
    itemsPerPage: resources.length,
    Resources: resources,
  });
}
