import { createClient } from "@/lib/supabase/server";
import { db } from "@/db";
import { users, projects } from "@/db/schema";
import { eq } from "drizzle-orm";
import type { AuthenticatedUser } from "@/lib/auth";
import { encryptSecret, decryptSecret } from "@/lib/security/crypto";

export interface GitHubRepoChoice {
  id: number;
  name: string;
  fullName: string;
  owner: string;
  ownerType: "personal" | "organization";
  description: string | null;
  language: string | null;
  stars: number;
  isPrivate: boolean;
  updatedAt: string;
  alreadyImported: boolean;
}

export interface GitHubOrgSummary {
  login: string;
  avatarUrl: string | null;
}

export async function getUserGitHubAccessToken(userId: string): Promise<string | null> {
  try {
    const supabase = await createClient();
    const { data } = await supabase.auth.getSession();
    const liveToken = data?.session?.provider_token;
    if (liveToken) {
      // Best-effort refresh encrypted persisted token in Turso
      encryptSecret(liveToken)
        .then((enc) => {
          if (!enc) return;
          return db
            .update(users)
            .set({ githubAccessToken: enc, updatedAt: new Date().toISOString() })
            .where(eq(users.id, userId));
        })
        .catch(() => {});
      return liveToken;
    }
  } catch {
    // ignore
  }

  try {
    const [row] = await db
      .select({ githubAccessToken: users.githubAccessToken })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    return await decryptSecret(row?.githubAccessToken);
  } catch {
    return null;
  }
}

function buildAppFallbackHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github.v3+json",
    "User-Agent": "DevPulse-HQ/1.0",
  };
  if (process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET) {
    const basic = Buffer.from(
      `${process.env.GITHUB_CLIENT_ID}:${process.env.GITHUB_CLIENT_SECRET}`
    ).toString("base64");
    headers.Authorization = `Basic ${basic}`;
  }
  return headers;
}

export async function listUserAndOrgRepositories(user: AuthenticatedUser): Promise<{
  repos: GitHubRepoChoice[];
  orgs: GitHubOrgSummary[];
  hasOAuthToken: boolean;
}> {
  const token = await getUserGitHubAccessToken(user.id);
  const headers: Record<string, string> = token
    ? {
        Accept: "application/vnd.github.v3+json",
        "User-Agent": "DevPulse-HQ/1.0",
        Authorization: `Bearer ${token}`,
      }
    : buildAppFallbackHeaders();

  const existing = await db
    .select({ githubRepo: projects.githubRepo })
    .from(projects)
    .where(eq(projects.userId, user.id));

  const importedSet = new Set(
    existing.map((e) => (e.githubRepo || "").toLowerCase()).filter(Boolean)
  );

  // 1. Discover organizations (authenticated /user/orgs finds private memberships like RitualDev-Lab!)
  const orgMap = new Map<string, GitHubOrgSummary>();
  const orgUrls = token
    ? [
        "https://api.github.com/user/orgs?per_page=50",
        `https://api.github.com/users/${encodeURIComponent(user.githubUsername)}/orgs?per_page=50`,
      ]
    : [`https://api.github.com/users/${encodeURIComponent(user.githubUsername)}/orgs?per_page=50`];

  await Promise.all(
    orgUrls.map(async (url) => {
      try {
        const res = await fetch(url, { headers, cache: "no-store" });
        if (!res.ok) return;
        const arr = (await res.json()) as Array<{ login: string; avatar_url?: string }>;
        if (Array.isArray(arr)) {
          for (const o of arr) {
            if (o?.login) {
              orgMap.set(o.login.toLowerCase(), {
                login: o.login,
                avatarUrl: o.avatar_url || null,
              });
            }
          }
        }
      } catch {
        // ignore
      }
    })
  );

  // 2. Fetch personal + affiliated repos
  const repoMap = new Map<string, GitHubRepoChoice>();
  const personalUrl = token
    ? "https://api.github.com/user/repos?sort=updated&per_page=100&affiliation=owner,collaborator,organization_member"
    : `https://api.github.com/users/${encodeURIComponent(user.githubUsername)}/repos?sort=updated&per_page=50&type=owner`;

  const ingestRepoArray = (rawList: any[], defaultOrg = false) => {
    if (!Array.isArray(rawList)) return;
    for (const r of rawList) {
      if (!r?.full_name) continue;
      const ownerLogin = String(r.owner?.login || r.full_name.split("/")[0] || "");
      const isOrg =
        defaultOrg ||
        r.owner?.type === "Organization" ||
        ownerLogin.toLowerCase() !== user.githubUsername.toLowerCase();

      if (isOrg && ownerLogin && !orgMap.has(ownerLogin.toLowerCase())) {
        orgMap.set(ownerLogin.toLowerCase(), {
          login: ownerLogin,
          avatarUrl: r.owner?.avatar_url || null,
        });
      }

      repoMap.set(r.full_name.toLowerCase(), {
        id: r.id,
        name: r.name,
        fullName: r.full_name,
        owner: ownerLogin,
        ownerType: isOrg ? "organization" : "personal",
        description: r.description || null,
        language: r.language || null,
        stars: r.stargazers_count || 0,
        isPrivate: Boolean(r.private),
        updatedAt: r.updated_at || new Date().toISOString(),
        alreadyImported: importedSet.has(r.full_name.toLowerCase()),
      });
    }
  };

  try {
    const res = await fetch(personalUrl, { headers, cache: "no-store" });
    if (res.ok) {
      ingestRepoArray(await res.json(), false);
    }
  } catch {
    // ignore
  }

  // 3. Fetch repositories for every discovered organization (ensuring org repos always surface)
  const orgs = Array.from(orgMap.values());
  await Promise.all(
    orgs.map(async (org) => {
      try {
        const res = await fetch(
          `https://api.github.com/orgs/${encodeURIComponent(org.login)}/repos?sort=updated&per_page=50`,
          { headers, cache: "no-store" }
        );
        if (res.ok) {
          ingestRepoArray(await res.json(), true);
        }
      } catch {
        // ignore
      }
    })
  );

  const repos = Array.from(repoMap.values()).sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
  );

  return {
    repos,
    orgs,
    hasOAuthToken: Boolean(token),
  };
}

/**
 * Enforces strict repository ownership / maintainer verification:
 * Users may ONLY import or link repositories owned by their GitHub account
 * OR repositories belonging to a verified GitHub Organization / collaborator repo they have access to.
 */
export async function verifyGitHubRepoOwnership(
  user: AuthenticatedUser,
  rawRepo: string
): Promise<{
  allowed: boolean;
  githubRepo: string;
  token: string | null;
  needsOrgReauth?: boolean;
  reason?: string;
}> {
  const cleaned = rawRepo
    .trim()
    .replace(/^https?:\/\/github\.com\//i, "")
    .replace(/\.git$/i, "")
    .replace(/^\/+|\/+$/g, "");

  const parts = cleaned.split("/");
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    return {
      allowed: false,
      githubRepo: cleaned,
      token: null,
      reason: "Repository must be in valid 'owner/repo' format.",
    };
  }

  const [owner, repo] = parts;
  const canonical = `${owner}/${repo}`;
  const token = await getUserGitHubAccessToken(user.id);

  // 1. Direct personal repository match
  if (owner.toLowerCase() === user.githubUsername.toLowerCase()) {
    return { allowed: true, githubRepo: canonical, token };
  }

  // 2. If user has OAuth token, verify via GitHub /repos/{owner}/{repo} permissions or /user/orgs membership
  if (token) {
    const authHeaders = {
      Accept: "application/vnd.github.v3+json",
      "User-Agent": "DevPulse-HQ/1.0",
      Authorization: `Bearer ${token}`,
    };

    try {
      const repoRes = await fetch(
        `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`,
        { headers: authHeaders, cache: "no-store" }
      );
      if (repoRes.ok) {
        const repoJson = (await repoRes.json()) as {
          permissions?: { admin?: boolean; maintain?: boolean; push?: boolean };
        };
        if (
          repoJson.permissions?.admin ||
          repoJson.permissions?.maintain ||
          repoJson.permissions?.push
        ) {
          return { allowed: true, githubRepo: canonical, token };
        }
      }

      // Also check verified org membership list (covers read:org scopes where repo push perm isn't on token)
      const orgsRes = await fetch("https://api.github.com/user/orgs?per_page=100", {
        headers: authHeaders,
        cache: "no-store",
      });
      if (orgsRes.ok) {
        const orgsJson = (await orgsRes.json()) as Array<{ login?: string }>;
        if (
          Array.isArray(orgsJson) &&
          orgsJson.some((o) => o.login?.toLowerCase() === owner.toLowerCase())
        ) {
          return { allowed: true, githubRepo: canonical, token };
        }
      }
    } catch {
      // fall through cleanly
    }

    return {
      allowed: false,
      githubRepo: canonical,
      token,
      reason: `Access denied: "${canonical}" does not belong to @${user.githubUsername} or your verified GitHub Organizations. Only your own personal & organization repositories can connect DevPulse telemetry.`,
    };
  }

  // 3. No OAuth token stored yet — check public org membership fallback
  try {
    const pubMemRes = await fetch(
      `https://api.github.com/orgs/${encodeURIComponent(owner)}/public_members/${encodeURIComponent(
        user.githubUsername
      )}`,
      { headers: buildAppFallbackHeaders(), cache: "no-store" }
    );
    if (pubMemRes.status === 204) {
      return { allowed: true, githubRepo: canonical, token: null };
    }
  } catch {
    // ignore
  }

  return {
    allowed: false,
    githubRepo: canonical,
    token: null,
    needsOrgReauth: true,
    reason: `Cannot verify membership in "${owner}". Click "Sync GitHub Orgs" to grant GitHub read:org access so organization repositories like ${owner}/* can be verified and imported.`,
  };
}
