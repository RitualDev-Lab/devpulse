import { cache } from "react";
import { createClient } from "./supabase/server";
import { db } from "@/db";
import { users, organizationMembers, organizations } from "@/db/schema";
import { eq, and, sql } from "drizzle-orm";
import { getSsoSessionFromCookies } from "@/lib/saml/sso-session";

export interface AuthenticatedUser {
  id: string;
  githubUsername: string;
  name: string | null;
  email: string | null;
  avatarUrl: string | null;
  storageTier: string;
  subdomain: string | null;
  customDomain: string | null;
  customDomainVerified: boolean;
  authMethod?: "github" | "saml";
  ssoOrganizationId?: string | null;
}

/**
 * Get current authenticated user bound to real GitHub identity
 * Ensures row-level synchronization with the Turso users table
 */
export const getCurrentUser = cache(async function getCurrentUser(): Promise<AuthenticatedUser | null> {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error,
    } = await supabase.auth.getUser();

    if (error || !user) {
      return await getSsoAuthenticatedUser();
    }

    const metadata = user.user_metadata || {};
    const githubUsername =
      metadata.user_name ||
      metadata.preferred_username ||
      user.email?.split("@")[0] ||
      `dev_${user.id.slice(0, 8)}`;
    const name = metadata.full_name || metadata.name || githubUsername;
    const email = user.email || null;
    const avatarUrl = metadata.avatar_url || null;

    const defaultSubdomain = githubUsername
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 32) || `dev-${user.id.slice(0, 8)}`;

    // Fast read first: avoid an unconditional Turso write on every authenticated page load
    const existingRows = await db
      .select()
      .from(users)
      .where(eq(users.id, user.id))
      .limit(1);

    const existingUser = existingRows[0];
    const needsSync =
      !existingUser ||
      existingUser.githubUsername !== githubUsername ||
      existingUser.name !== name ||
      existingUser.email !== email ||
      existingUser.avatarUrl !== avatarUrl;

    if (needsSync) {
      try {
        await db
          .insert(users)
          .values({
            id: user.id,
            githubUsername,
            name,
            email,
            avatarUrl,
            storageTier: "free",
            subdomain: defaultSubdomain,
            customDomainVerified: false,
          })
          .onConflictDoUpdate({
            target: users.id,
            set: {
              githubUsername,
              name,
              email,
              avatarUrl,
              updatedAt: sql`(CURRENT_TIMESTAMP)`,
            },
          });
      } catch (dbErr) {
        console.error("Error upserting user into Turso:", dbErr);
      }

      const [refreshed] = await db
        .select()
        .from(users)
        .where(eq(users.id, user.id))
        .limit(1);

      if (refreshed) {
        return {
          id: refreshed.id,
          githubUsername: refreshed.githubUsername,
          name: refreshed.name,
          email: refreshed.email,
          avatarUrl: refreshed.avatarUrl,
          storageTier: refreshed.storageTier,
          subdomain: refreshed.subdomain || defaultSubdomain,
          customDomain: refreshed.customDomain,
          customDomainVerified: refreshed.customDomainVerified,
        };
      }
    }

    if (existingUser) {
      return {
        id: existingUser.id,
        githubUsername: existingUser.githubUsername,
        name: existingUser.name,
        email: existingUser.email,
        avatarUrl: existingUser.avatarUrl,
        storageTier: existingUser.storageTier,
        subdomain: existingUser.subdomain || defaultSubdomain,
        customDomain: existingUser.customDomain,
        customDomainVerified: existingUser.customDomainVerified,
      };
    }

    return {
      id: user.id,
      githubUsername,
      name,
      email,
      avatarUrl,
      storageTier: "free",
      subdomain: defaultSubdomain,
      customDomain: null,
      customDomainVerified: false,
      authMethod: "github",
    };
  } catch (err) {
    console.error("getCurrentUser error:", err);
    return await getSsoAuthenticatedUser();
  }
});

async function getSsoAuthenticatedUser(): Promise<AuthenticatedUser | null> {
  try {
    const sso = await getSsoSessionFromCookies();
    if (!sso) return null;

    const [ssoUser] = await db
      .select()
      .from(users)
      .where(eq(users.id, sso.userId))
      .limit(1);
    if (!ssoUser) return null;

    // Enforce real-time SCIM deprovisioning: if membership was suspended/removed, reject session
    const [org] = await db
      .select({ ownerUserId: organizations.ownerUserId })
      .from(organizations)
      .where(eq(organizations.id, sso.organizationId))
      .limit(1);

    if (org && org.ownerUserId !== ssoUser.id) {
      const [membership] = await db
        .select({ status: organizationMembers.status })
        .from(organizationMembers)
        .where(
          and(
            eq(organizationMembers.organizationId, sso.organizationId),
            eq(organizationMembers.userId, ssoUser.id)
          )
        )
        .limit(1);

      if (!membership || membership.status === "suspended") {
        return null;
      }
    }

    return {
      id: ssoUser.id,
      githubUsername: ssoUser.githubUsername,
      name: ssoUser.name,
      email: ssoUser.email,
      avatarUrl: ssoUser.avatarUrl,
      storageTier: ssoUser.storageTier,
      subdomain: ssoUser.subdomain,
      customDomain: ssoUser.customDomain,
      customDomainVerified: ssoUser.customDomainVerified,
      authMethod: "saml",
      ssoOrganizationId: sso.organizationId,
    };
  } catch {
    return null;
  }
}
