import { db } from "@/db";
import { projectReleases } from "@/db/schema";
import { desc, eq } from "drizzle-orm";
import { loadPortalData } from "@/lib/domains/portal-loader";
import { decryptSecret } from "@/lib/security/crypto";
import { getUserGitHubAccessToken } from "@/lib/security/github-ownership";

export interface MergedPrItem {
  number: number;
  title: string;
  author: string;
  mergedAt: string;
  htmlUrl: string;
  labels: string[];
}

export interface ChangelogReleaseGroup {
  version: string;
  releasedAt: string;
  commitSha: string | null;
  commitAuthor: string | null;
  commitMessage: string | null;
  crashCount: number;
  totalSessions: number;
  pullRequests: MergedPrItem[];
}

export async function loadPortalChangelog(hostKey: string, requestedProjectSlug?: string) {
  const portal = await loadPortalData(hostKey, requestedProjectSlug);
  if (!portal) return null;

  const active = portal.activeProject;
  if (!active) {
    return {
      portal,
      releases: [] as ChangelogReleaseGroup[],
      unreleasedPrs: [] as MergedPrItem[],
    };
  }

  const rawReleases = await db
    .select()
    .from(projectReleases)
    .where(eq(projectReleases.projectId, active.id))
    .orderBy(desc(projectReleases.releasedAt))
    .limit(20)
    .catch(() => []);

  let mergedPrs: MergedPrItem[] = [];
  if (active.githubRepo && active.githubRepo.includes("/")) {
    const projectToken = await decryptSecret(active.githubTokenEncrypted).catch(() => null);
    const userToken = projectToken || (await getUserGitHubAccessToken(active.userId).catch(() => null));

    const headers: Record<string, string> = {
      Accept: "application/vnd.github.v3+json",
      "User-Agent": "DevPulse-Changelog/1.0",
    };
    if (userToken) headers.Authorization = `Bearer ${userToken}`;

    const prsRes = await fetch(
      `https://api.github.com/repos/${active.githubRepo}/pulls?state=closed&sort=updated&direction=desc&per_page=40`,
      { headers, next: { revalidate: 900 } }
    ).catch(() => null);

    if (prsRes?.ok) {
      const prsData = await prsRes.json();
      if (Array.isArray(prsData)) {
        mergedPrs = prsData
          .filter((pr: any) => Boolean(pr.merged_at))
          .map((pr: any) => ({
            number: pr.number,
            title: pr.title,
            author: pr.user?.login || "contributor",
            mergedAt: pr.merged_at,
            htmlUrl: pr.html_url,
            labels: Array.isArray(pr.labels) ? pr.labels.map((l: any) => String(l.name)) : [],
          }));
      }
    }
  }

  // Group merged PRs into chronological release buckets
  const sortedReleases = [...rawReleases].sort(
    (a, b) => new Date(b.releasedAt).getTime() - new Date(a.releasedAt).getTime()
  );

  const grouped: ChangelogReleaseGroup[] = sortedReleases.map((r, idx) => {
    const upperBoundMs = new Date(r.releasedAt).getTime();
    const lowerBoundMs =
      idx + 1 < sortedReleases.length
        ? new Date(sortedReleases[idx + 1].releasedAt).getTime()
        : 0;

    const bucketPrs = mergedPrs.filter((pr) => {
      const t = new Date(pr.mergedAt).getTime();
      return t <= upperBoundMs && t > lowerBoundMs;
    });

    return {
      version: r.version,
      releasedAt: r.releasedAt,
      commitSha: r.commitSha,
      commitAuthor: r.commitAuthor,
      commitMessage: r.commitMessage,
      crashCount: r.crashCount,
      totalSessions: r.totalSessions,
      pullRequests: bucketPrs,
    };
  });

  const latestReleaseMs =
    sortedReleases.length > 0 ? new Date(sortedReleases[0].releasedAt).getTime() : 0;
  const unreleasedPrs = mergedPrs.filter(
    (pr) => new Date(pr.mergedAt).getTime() > latestReleaseMs
  );

  return {
    portal,
    releases: grouped,
    unreleasedPrs,
  };
}
