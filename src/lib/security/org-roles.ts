// Pure role helpers. Kept free of database imports so SAML and SCIM code and their tests can use them.

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

/**
 * Role an identity provider (SAML or SCIM) may assign. Provisioning never grants ownership;
 * an owner-level claim is capped at admin. Existing owners are protected by the callers.
 */
export function clampProvisionedRole(raw?: string | null): OrgRole {
  const role = normalizeOrgRole(raw);
  return role === "owner" ? "admin" : role;
}
