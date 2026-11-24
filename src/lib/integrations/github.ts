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
  defaultBranch: string;
  license?: string;
  latestRelease?: {
    tagName: string;
    publishedAt: string;
    name: string;
  };
  recentIssues: Array<{
    id: number;
    number: number;
    title: string;
    state: string;
    createdAt: string;
    isPullRequest: boolean;
    author: string;
    htmlUrl: string;
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
    }

    // 1. Fetch Repo Info
    const repoRes = await fetch(`https://api.github.com/repos/${owner}/${repo}`, {
      headers,
      next: { revalidate: 1800 }, // 30 min cache
    });

    if (!repoRes.ok) {
      console.warn(`GitHub API returned ${repoRes.status} for ${repoFullName}`);
      return null;
    }

    const repoData = await repoRes.json();

    // 2. Fetch Latest Release
    let latestRelease: GitHubRepoStats["latestRelease"] | undefined;
    try {
      const relRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/releases/latest`, {
        headers,
        next: { revalidate: 3600 },
      });
      if (relRes.ok) {
        const relData = await relRes.json();
        latestRelease = {
          tagName: relData.tag_name,
          publishedAt: relData.published_at,
          name: relData.name || relData.tag_name,
        };
      }
    } catch {
      // Release is optional
    }

    // 3. Fetch Recent Issues & PRs
    const recentIssues: GitHubRepoStats["recentIssues"] = [];
    try {
      const issuesRes = await fetch(
        `https://api.github.com/repos/${owner}/${repo}/issues?state=open&sort=updated&per_page=8`,
        { headers, next: { revalidate: 600 } }
      );
      if (issuesRes.ok) {
        const issuesData = await issuesRes.json();
        if (Array.isArray(issuesData)) {
          for (const item of issuesData) {
            recentIssues.push({
              id: item.id,
              number: item.number,
              title: item.title,
              state: item.state,
              createdAt: item.created_at,
              isPullRequest: !!item.pull_request,
              author: item.user?.login || "anonymous",
              htmlUrl: item.html_url,
            });
          }
        }
      }
    } catch {
      // Issues optional
    }

    return {
      owner,
      repo,
      fullName: repoData.full_name,
      description: repoData.description || "",
      stars: repoData.stargazers_count || 0,
      forks: repoData.forks_count || 0,
      openIssuesCount: repoData.open_issues_count || 0,
      defaultBranch: repoData.default_branch || "main",
      license: repoData.license?.spdx_id || repoData.license?.name,
      latestRelease,
      recentIssues,
    };
  } catch (err) {
    console.error(`Error fetching GitHub repo for ${repoFullName}:`, err);
    return null;
  }
}
