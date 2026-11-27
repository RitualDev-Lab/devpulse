/**
 * OpenFGA Relationship-Based Access Control (ReBAC) Model & Air-Gapped IAM Helper
 * Complements coarse org roles with fine-grained resource inheritance:
 *   organization -> workspace -> project -> secret_vault
 */

export type FgaRelation = "owner" | "admin" | "maintainer" | "viewer" | "can_read" | "can_write" | "can_read_secrets";

export interface FgaTuple {
  user: string; // e.g. "user:alice"
  relation: FgaRelation;
  object: string; // e.g. "project:proj_123"
}

const ROLE_CAPABILITIES: Record<"owner" | "admin" | "maintainer" | "viewer", Set<FgaRelation>> = {
  owner: new Set(["owner", "admin", "maintainer", "viewer", "can_read", "can_write", "can_read_secrets"]),
  admin: new Set(["admin", "maintainer", "viewer", "can_read", "can_write", "can_read_secrets"]),
  maintainer: new Set(["maintainer", "viewer", "can_read", "can_write"]),
  viewer: new Set(["viewer", "can_read"]),
};

export function evaluateRebacPermission(input: {
  tuples: FgaTuple[];
  userId: string;
  object: string;
  requiredRelation: FgaRelation;
  parentOrgObject?: string | null;
}): boolean {
  const userKey = input.userId.startsWith("user:") ? input.userId : `user:${input.userId}`;
  const matchingObjects = new Set([input.object]);
  if (input.parentOrgObject) matchingObjects.add(input.parentOrgObject);

  for (const t of input.tuples) {
    if (t.user !== userKey || !matchingObjects.has(t.object)) continue;
    if (t.relation === input.requiredRelation) return true;
    if (t.relation in ROLE_CAPABILITIES) {
      const caps = ROLE_CAPABILITIES[t.relation as keyof typeof ROLE_CAPABILITIES];
      if (caps.has(input.requiredRelation)) return true;
    }
  }
  return false;
}
