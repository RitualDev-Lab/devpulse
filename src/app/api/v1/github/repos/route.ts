import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { db } from "@/db";
import { projects } from "@/db/schema";
import { eq } from "drizzle-orm";

export const dynamic = "force-dynamic";

export interface GitHubRepoChoice {
  id: number;
  name: string;
  fullName: string;
  description: string | null;
  language: string | null;
  stars: number;
  isPrivate: boolean;
  updatedAt: string;
  alreadyImported: boolean;
}

export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const supabase = await createClient();
    const { data: sessionData } = await supabase.auth.getSession();
    const providerToken = sessionData?.session?.provider_token;

    const headers: Record<string, string> = {
      Accept: "application/vnd.github.v3+json",
      "User-Agent": "DevPulse-HQ/1.0",
    };

    if (providerToken) {
      headers.Authorization = `Bearer ${providerToken}`;
    } else if (process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET) {
      const basic = Buffer.from(
        `${process.env.GITHUB_CLIENT_ID}:${process.env.GITHUB_CLIENT_SECRET}`
      ).toString("base64");
      headers.Authorization = `Basic ${basic}`;
    }

    const endpoint = providerToken
      ? "https://api.github.com/user/repos?sort=updated&per_page=40&affiliation=owner,collaborator,organization_member"
      : `https://api.github.com/users/${encodeURIComponent(
          user.githubUsername
        )}/repos?sort=updated&per_page=30&type=all`;

    const ghRes = await fetch(endpoint, { headers, cache: "no-store" });
    if (!ghRes.ok) {
      return NextResponse.json({
        repos: [],
        githubUsername: user.githubUsername,
        note: `GitHub API returned ${ghRes.status}`,
      });
    }

    const rawRepos = (await ghRes.json()) as Array<{
      id: number;
      name: string;
      full_name: string;
      description: string | null;
      language: string | null;
      stargazers_count: number;
      private: boolean;
      updated_at: string;
      fork: boolean;
    }>;

    const existing = await db
      .select({ githubRepo: projects.githubRepo })
      .from(projects)
      .where(eq(projects.userId, user.id));

    const importedSet = new Set(
      existing.map((e) => (e.githubRepo || "").toLowerCase()).filter(Boolean)
    );

    const repos: GitHubRepoChoice[] = (Array.isArray(rawRepos) ? rawRepos : []).map((r) => ({
      id: r.id,
      name: r.name,
      fullName: r.full_name,
      description: r.description,
      language: r.language,
      stars: r.stargazers_count || 0,
      isPrivate: Boolean(r.private),
      updatedAt: r.updated_at,
      alreadyImported: importedSet.has(r.full_name.toLowerCase()),
    }));

    return NextResponse.json({
      repos,
      githubUsername: user.githubUsername,
    });
  } catch (err: any) {
    console.error("GET /api/v1/github/repos error:", err);
    return NextResponse.json({ repos: [], error: err?.message || "Failed to list repositories" }, { status: 500 });
  }
}
