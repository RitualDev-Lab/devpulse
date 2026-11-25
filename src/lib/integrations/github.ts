/**
 * GitHub Integration Service
 * Interacts with GitHub Public REST API.
 * Zero token needed for public repos; supports optional user token for 5,000 req/hr.
 */

export interface GitHubRepoStats {
  owner: string;
  repo: string;
  fullName: string;
  description: string;
  stars: number;
  forks: number;
  openIssuesCount: number;
  totalOpenIssuesAndPrs: number;
  openPrCount: number;
  prReviewVelocityHours: number;
  staleIssuesCount: number;
  freshIssuesCount: number;
  dependabotAlertsCount: number;
  defaultBranch: string;
  license?: string;
  latestRelease?: {
    tagName: string;
    publishedAt: string;
    name: string;
  };
  trafficClones?: {
    count: number;
    uniques: number;
    daily: Array<{ date: string; count: number; uniques: number }>;
  };
  trafficViews?: {
    count: number;
    uniques: number;
    daily: Array<{ date: string; count: number; uniques: number }>;
  };
  pulls?: Array<{
    id: number;
    number: number;
    title: string;
    state: string;
    draft: boolean;
    author: string;
    htmlUrl: string;
    headRef: string;
    baseRef: string;
    createdAt: string;
    updatedAt: string;
  }>;
  recentIssues: Array<{
    id: number;
    number: number;
    title: string;
    state: string;
    createdAt: string;
    isPullRequest: boolean;
    author: string;
    htmlUrl: string;
    ageDays: number;
    isStale: boolean;
  }>;
}

export async function fetchGitHubRepoStats(
  repoFullName: string,
  userToken?: string
): Promise<GitHubRepoStats | null> {
  try {
    const [owner, repo] = repoFullName.trim().split("/");
    if (!owner || !repo) return null;

    const headers: Record<string, string> = {
      Accept: "application/vnd.github.v3+json",
      "User-Agent": "DevPulse-RitualDev",
    };

    if (userToken) {
      headers.Authorization = `Bearer ${userToken}`;
    } else if (process.env.GITHUB_TOKEN) {
      headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
    } else if (process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET) {
      const basic = Buffer.from(
        `${process.env.GITHUB_CLIENT_ID}:${process.env.GITHUB_CLIENT_SECRET}`
      ).toString("base64");
      headers.Authorization = `Basic ${basic}`;
    }

    // Parallelize all GitHub API requests instead of 6 sequential roundtrips
    const [repoRes, prsRes, relRes, issuesRes, depRes, clonesRes, viewsRes] = await Promise.all([
      fetch(`https://api.github.com/repos/${owner}/${repo}`, {
        headers,
        next: { revalidate: 1800 },
      }).catch(() => null),
      fetch(`https://api.github.com/repos/${owner}/${repo}/pulls?state=open&per_page=30`, {
        headers,
        next: { revalidate: 600 },
      }).catch(() => null),
      fetch(`https://api.github.com/repos/${owner}/${repo}/releases/latest`, {
        headers,
        next: { revalidate: 3600 },
      }).catch(() => null),
      fetch(`https://api.github.com/repos/${owner}/${repo}/issues?state=open&sort=updated&per_page=15`, {
        headers,
        next: { revalidate: 600 },
      }).catch(() => null),
      fetch(`https://api.github.com/repos/${owner}/${repo}/dependabot/alerts?state=open&per_page=100`, {
        headers,
        next: { revalidate: 1800 },
      }).catch(() => null),
      userToken
        ? fetch(`https://api.github.com/repos/${owner}/${repo}/traffic/clones`, {
            headers,
            next: { revalidate: 900 },
          }).catch(() => null)
        : Promise.resolve(null),
      userToken
        ? fetch(`https://api.github.com/repos/${owner}/${repo}/traffic/views`, {
            headers,
            next: { revalidate: 900 },
          }).catch(() => null)
        : Promise.resolve(null),
    ]);

    if (!repoRes || !repoRes.ok) {
      console.warn(`GitHub API returned ${repoRes?.status ?? "network_err"} for ${repoFullName}`);
      return null;
    }

    const repoData = await repoRes.json();
    const totalOpen = repoData.open_issues_count || 0;

    let openPrCount = 0;
    let prReviewVelocityHours = 0;
    const pulls: NonNullable<GitHubRepoStats["pulls"]> = [];
    if (prsRes?.ok) {
      try {
        const prsData = await prsRes.json();
        if (Array.isArray(prsData)) {
          openPrCount = prsData.length;
          if (prsData.length > 0) {
            const now = Date.now();
            const totalHours = prsData.reduce((acc: number, pr: any) => {
              const diffMs = now - new Date(pr.created_at).getTime();
              return acc + Math.max(0, diffMs / (1000 * 3600));
            }, 0);
            prReviewVelocityHours = Math.round((totalHours / prsData.length) * 10) / 10;
          }
          for (const pr of prsData.slice(0, 15)) {
            pulls.push({
              id: pr.id,
              number: pr.number,
              title: pr.title,
              state: pr.state,
              draft: Boolean(pr.draft),
              author: pr.user?.login || "unknown",
              htmlUrl: pr.html_url,
              headRef: pr.head?.ref || "",
              baseRef: pr.base?.ref || "",
              createdAt: pr.created_at,
              updatedAt: pr.updated_at,
            });
          }
        }
      } catch {
        // PRs optional
      }
    }

    let latestRelease: GitHubRepoStats["latestRelease"] | undefined;
    if (relRes?.ok) {
      try {
        const relData = await relRes.json();
        latestRelease = {
          tagName: relData.tag_name,
          publishedAt: relData.published_at,
          name: relData.name || relData.tag_name,
        };
      } catch {
        // Release optional
      }
    }

    const recentIssues: GitHubRepoStats["recentIssues"] = [];
    let staleIssuesCount = 0;
    let freshIssuesCount = 0;
    if (issuesRes?.ok) {
      try {
        const issuesData = await issuesRes.json();
        if (Array.isArray(issuesData)) {
          const now = Date.now();
          for (const item of issuesData) {
            const ageDays = Math.max(
              0,
              Math.floor((now - new Date(item.created_at).getTime()) / (1000 * 3600 * 24))
            );
            const isStale = ageDays > 14;
            const isPr = !!item.pull_request;

            if (!isPr) {
              if (isStale) staleIssuesCount++;
              else freshIssuesCount++;
            }

            recentIssues.push({
              id: item.id,
              number: item.number,
              title: item.title,
              state: item.state,
              createdAt: item.created_at,
              isPullRequest: isPr,
              author: item.user?.login || "anonymous",
              htmlUrl: item.html_url,
              ageDays,
              isStale,
            });
          }
        }
      } catch {
        // Issues optional
      }
    }

    let dependabotAlertsCount = 0;
    if (depRes?.ok) {
      try {
        const depData = await depRes.json();
        if (Array.isArray(depData)) {
          dependabotAlertsCount = depData.length;
        }
      } catch {
        // Dependabot optional
      }
    }

    let trafficClones: GitHubRepoStats["trafficClones"];
    let trafficViews: GitHubRepoStats["trafficViews"];
    if (userToken) {
      if (clonesRes?.ok) {
        const c = await clonesRes.json().catch(() => null);
        if (c) {
          trafficClones = {
            count: c.count || 0,
            uniques: c.uniques || 0,
            daily: Array.isArray(c.clones)
              ? c.clones.map((d: any) => ({
                  date: String(d.timestamp || "").slice(0, 10),
                  count: d.count || 0,
                  uniques: d.uniques || 0,
                }))
              : [],
          };
        }
      }
      if (viewsRes?.ok) {
        const v = await viewsRes.json().catch(() => null);
        if (v) {
          trafficViews = {
            count: v.count || 0,
            uniques: v.uniques || 0,
            daily: Array.isArray(v.views)
              ? v.views.map((d: any) => ({
                  date: String(d.timestamp || "").slice(0, 10),
                  count: d.count || 0,
                  uniques: d.uniques || 0,
                }))
              : [],
          };
        }
      }
    }

    const pureOpenIssues = Math.max(0, totalOpen - openPrCount);

    return {
      owner,
      repo,
      fullName: repoData.full_name,
      description: repoData.description || "",
      stars: repoData.stargazers_count || 0,
      forks: repoData.forks_count || 0,
      openIssuesCount: pureOpenIssues,
      totalOpenIssuesAndPrs: totalOpen,
      openPrCount,
      prReviewVelocityHours,
      staleIssuesCount,
      freshIssuesCount,
      dependabotAlertsCount,
      defaultBranch: repoData.default_branch || "main",
      license: repoData.license?.spdx_id || repoData.license?.name,
      latestRelease,
      trafficClones,
      trafficViews,
      pulls,
      recentIssues,
    };
  } catch (err) {
    console.error(`Error fetching GitHub repo for ${repoFullName}:`, err);
    return null;
  }
}
