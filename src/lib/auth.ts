import { createClient } from "./supabase/server";
import { db } from "@/db";
import { users, projects } from "@/db/schema";
import { eq, sql } from "drizzle-orm";

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
}

/**
 * Get current authenticated user bound to real GitHub identity
 * Ensures row-level synchronization with the Turso users table
 */
export async function getCurrentUser(): Promise<AuthenticatedUser | null> {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error,
    } = await supabase.auth.getUser();

    if (error || !user) {
      return null;
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

        // Special claim: if maintainer logs in as ritualdev-lab or ritual-dev-git,
        // claim prj_ritual_core if it was created under demo id
        const lowerUser = githubUsername.toLowerCase();
        if (lowerUser === "ritualdev-lab" || lowerUser === "ritual-dev-git") {
          await db
            .update(projects)
            .set({ userId: user.id })
            .where(eq(projects.userId, "usr_ritualdev_demo"));
        }
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
    };
  } catch (err) {
    console.error("getCurrentUser error:", err);
    return null;
  }
}
