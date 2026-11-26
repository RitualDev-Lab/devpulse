import { fetchGitHubRepoStats, type GitHubRepoStats } from "@/lib/integrations/github";
import { PUBLIC_APP_URL } from "@/lib/config/app-url";

export type GitProviderId = "github" | "gitlab" | "bitbucket" | "gitea";

export interface GitProviderConfig {
  provider: GitProviderId;
  baseUrl: string;
  repoSlug: string;
  token?: string | null;
}

export interface GitPipelineStatus {
  status: string;
  ref?: string | null;
  webUrl?: string | null;
  updatedAt?: string | null;
}

export interface GitRepoStats extends GitHubRepoStats {
  provider: GitProviderId;
  baseUrl: string;
  webUrl: string;
  pipelineStatus?: GitPipelineStatus | null;
}

const UA = `DevPulse-HQ/1.0 (${PUBLIC_APP_URL})`;

export function normalizeGitProvider(raw?: string | null): GitProviderId | null {
  const s = (raw || "").trim().toLowerCase();
  if (s === "github" || s === "gitlab" || s === "bitbucket" || s === "gitea") return s;
  if (s === "codeberg" || s === "forgejo") return "gitea";
  return null;
}

export function defaultGitBaseUrl(provider: GitProviderId, rawUrl?: string | null): string {
  const clean = (rawUrl || "").trim().replace(/\/+$/, "");
  if (clean && /^https:\/\//i.test(clean)) return clean;
  if (provider === "gitlab") return "https://gitlab.com";
  if (provider === "bitbucket") return "https://bitbucket.org";
  if (provider === "gitea") return "https://codeberg.org";
  return "https://github.com";
}

export function gitProviderLabel(provider: GitProviderId, baseUrl?: string | null): string {
  if (provider === "gitlab") return baseUrl && !baseUrl.includes("gitlab.com") ? "GitLab (Self-Hosted)" : "GitLab";
  if (provider === "bitbucket") return "Bitbucket";
  if (provider === "gitea") return baseUrl?.includes("codeberg.org") ? "Codeberg" : "Gitea / Forgejo";
  return "GitHub";
}

export function buildGitRepoWebUrl(provider: GitProviderId, baseUrl: string, repoSlug: string): string {
  const cleanBase = defaultGitBaseUrl(provider, baseUrl);
  return `${cleanBase}/${repoSlug.replace(/^\/+/, "")}`;
}

export function resolveProjectGitConfig(params: {
  githubRepo?: string | null;
  githubToken?: string | null;
  connectors?: Array<{
    category: string;
    provider: string;
    identifier?: string | null;
    targetUrl?: string | null;
    metadataJson?: string | null;
  }>;
  gitConnectorToken?: string | null;
}): GitProviderConfig | null {
  const gitConn = (params.connectors || []).find((c) => {
    const prov = normalizeGitProvider(c.provider);
    return c.category === "git" && Boolean(prov) && Boolean((c.identifier || "").trim());
  });

  if (gitConn) {
    const prov = normalizeGitProvider(gitConn.provider)!;
    let baseHint = gitConn.targetUrl || null;
    if (!baseHint && gitConn.metadataJson) {
      try {
        const meta = JSON.parse(gitConn.metadataJson);
        baseHint = meta.gitBaseUrl || null;
      } catch {
        // ignore
      }
    }
    return {
      provider: prov,
      baseUrl: defaultGitBaseUrl(prov, baseHint),
      repoSlug: gitConn.identifier!.trim(),
      token: params.gitConnectorToken || null,
    };
  }

  if (params.githubRepo && params.githubRepo.trim()) {
    return {
      provider: "github",
      baseUrl: "https://github.com",
      repoSlug: params.githubRepo.trim(),
      token: params.githubToken || null,
    };
  }

  return null;
}

function splitOwnerRepo(slug: string): { owner: string; repo: string } {
  const clean = slug.trim().replace(/^\/+|\/+$/g, "");
  const parts = clean.split("/");
  const repo = parts[parts.length - 1] || clean;
  const owner = parts.slice(0, -1).join("/") || repo;
  return { owner, repo };
}

async function fetchJsonSafe<T>(url: string, headers: Record<string, string>): Promise<T | null> {
  try {
    const res = await fetch(url, {
      headers: { Accept: "application/json", "User-Agent": UA, ...headers },
      signal: AbortSignal.timeout(4500),
      cache: "no-store",
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

async function fetchGitLabRepoStats(cfg: GitProviderConfig): Promise<GitRepoStats | null> {
  const encodedPath = encodeURIComponent(cfg.repoSlug);
  const apiBase = `${cfg.baseUrl}/api/v4/projects/${encodedPath}`;
  const headers: Record<string, string> = {};
  if (cfg.token) headers["PRIVATE-TOKEN"] = cfg.token;

  const [proj, mrs, issues, releases, pipelines] = await Promise.all([
    fetchJsonSafe<any>(apiBase, headers),
    fetchJsonSafe<any[]>(`${apiBase}/merge_requests?state=opened&per_page=25`, headers),
    fetchJsonSafe<any[]>(`${apiBase}/issues?state=opened&per_page=15`, headers),
    fetchJsonSafe<any[]>(`${apiBase}/releases?per_page=1`, headers),
    fetchJsonSafe<any[]>(`${apiBase}/pipelines?per_page=1`, headers),
  ]);

  if (!proj?.id) return null;

  const { owner, repo } = splitOwnerRepo(proj.path_with_namespace || cfg.repoSlug);
  const nowMs = Date.now();
  const mrList = Array.isArray(mrs) ? mrs : [];
  const issueList = Array.isArray(issues) ? issues : [];

  const recentIssues: GitRepoStats["recentIssues"] = [
    ...mrList.slice(0, 6).map((mr) => {
      const ageDays = Math.floor((nowMs - new Date(mr.created_at).getTime()) / (1000 * 60 * 60 * 24));
      return {
        id: Number(mr.id || mr.iid),
        number: Number(mr.iid),
        title: String(mr.title || "MR"),
        state: String(mr.state || "opened"),
        createdAt: String(mr.created_at),
        isPullRequest: true,
        author: String(mr.author?.username || "contributor"),
        htmlUrl: String(mr.web_url || cfg.baseUrl),
        ageDays: Math.max(0, ageDays),
        isStale: ageDays > 14,
      };
    }),
    ...issueList.slice(0, 8).map((iss) => {
      const ageDays = Math.floor((nowMs - new Date(iss.created_at).getTime()) / (1000 * 60 * 60 * 24));
      return {
        id: Number(iss.id || iss.iid),
        number: Number(iss.iid),
        title: String(iss.title || "Issue"),
        state: String(iss.state || "opened"),
        createdAt: String(iss.created_at),
        isPullRequest: false,
        author: String(iss.author?.username || "reporter"),
        htmlUrl: String(iss.web_url || cfg.baseUrl),
        ageDays: Math.max(0, ageDays),
        isStale: ageDays > 14,
      };
    }),
  ];

  const staleIssuesCount = recentIssues.filter((i) => !i.isPullRequest && i.isStale).length;
  const freshIssuesCount = recentIssues.filter((i) => !i.isPullRequest && !i.isStale).length;
  const latestRel = Array.isArray(releases) && releases[0] ? releases[0] : null;
  const latestPipe = Array.isArray(pipelines) && pipelines[0] ? pipelines[0] : null;

  return {
    provider: "gitlab",
    baseUrl: cfg.baseUrl,
    webUrl: String(proj.web_url || buildGitRepoWebUrl("gitlab", cfg.baseUrl, cfg.repoSlug)),
    owner,
    repo,
    fullName: String(proj.path_with_namespace || cfg.repoSlug),
    description: String(proj.description || ""),
    stars: Number(proj.star_count || 0),
    forks: Number(proj.forks_count || 0),
    openIssuesCount: Number(proj.open_issues_count ?? issueList.length),
    totalOpenIssuesAndPrs: Number(proj.open_issues_count ?? issueList.length) + mrList.length,
    openPrCount: mrList.length,
    prReviewVelocityHours: 0,
    staleIssuesCount,
    freshIssuesCount,
    dependabotAlertsCount: 0,
    defaultBranch: String(proj.default_branch || "main"),
    latestRelease: latestRel?.tag_name
      ? {
          tagName: String(latestRel.tag_name),
          publishedAt: String(latestRel.released_at || latestRel.created_at || new Date().toISOString()),
          name: String(latestRel.name || latestRel.tag_name),
        }
      : undefined,
    pipelineStatus: latestPipe
      ? {
          status: String(latestPipe.status || "unknown"),
          ref: latestPipe.ref ? String(latestPipe.ref) : null,
          webUrl: latestPipe.web_url ? String(latestPipe.web_url) : null,
          updatedAt: latestPipe.updated_at ? String(latestPipe.updated_at) : null,
        }
      : null,
    pulls: mrList.slice(0, 20).map((mr) => ({
      id: Number(mr.id || mr.iid),
      number: Number(mr.iid),
      title: String(mr.title || ""),
      state: String(mr.state || "opened"),
      draft: Boolean(mr.work_in_progress || mr.draft),
      author: String(mr.author?.username || "contributor"),
      htmlUrl: String(mr.web_url || cfg.baseUrl),
      headRef: String(mr.source_branch || "branch"),
      baseRef: String(mr.target_branch || "main"),
      createdAt: String(mr.created_at),
      updatedAt: String(mr.updated_at || mr.created_at),
    })),
    recentIssues,
  };
}

async function fetchBitbucketRepoStats(cfg: GitProviderConfig): Promise<GitRepoStats | null> {
  const { owner, repo } = splitOwnerRepo(cfg.repoSlug);
  const apiBase = `https://api.bitbucket.org/2.0/repositories/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
  const headers: Record<string, string> = {};
  if (cfg.token) headers.Authorization = `Bearer ${cfg.token}`;

  const [repoData, prsJson, issuesJson, pipesJson, tagsJson] = await Promise.all([
    fetchJsonSafe<any>(apiBase, headers),
    fetchJsonSafe<any>(`${apiBase}/pullrequests?state=OPEN&pagelen=25`, headers),
    fetchJsonSafe<any>(`${apiBase}/issues?q=state%3D%22open%22&pagelen=15`, headers),
    fetchJsonSafe<any>(`${apiBase}/pipelines/?sort=-created_on&pagelen=1`, headers),
    fetchJsonSafe<any>(`${apiBase}/refs/tags?sort=-target.date&pagelen=1`, headers),
  ]);

  if (!repoData?.uuid && !repoData?.full_name) return null;

  const nowMs = Date.now();
  const prList: any[] = Array.isArray(prsJson?.values) ? prsJson.values : [];
  const issueList: any[] = Array.isArray(issuesJson?.values) ? issuesJson.values : [];
  const pipe = pipesJson?.values?.[0] || null;
  const latestTag = tagsJson?.values?.[0] || null;

  const recentIssues: GitRepoStats["recentIssues"] = [
    ...prList.slice(0, 6).map((pr) => {
      const ageDays = Math.floor((nowMs - new Date(pr.created_on).getTime()) / (1000 * 60 * 60 * 24));
      return {
        id: Number(pr.id),
        number: Number(pr.id),
        title: String(pr.title || "PR"),
        state: String(pr.state || "OPEN"),
        createdAt: String(pr.created_on),
        isPullRequest: true,
        author: String(pr.author?.nickname || pr.author?.display_name || "contributor"),
        htmlUrl: String(pr.links?.html?.href || cfg.baseUrl),
        ageDays: Math.max(0, ageDays),
        isStale: ageDays > 14,
      };
    }),
    ...issueList.slice(0, 8).map((iss) => {
      const ageDays = Math.floor((nowMs - new Date(iss.created_on).getTime()) / (1000 * 60 * 60 * 24));
      return {
        id: Number(iss.id),
        number: Number(iss.id),
        title: String(iss.title || "Issue"),
        state: String(iss.state || "open"),
        createdAt: String(iss.created_on),
        isPullRequest: false,
        author: String(iss.reporter?.nickname || "reporter"),
        htmlUrl: String(iss.links?.html?.href || cfg.baseUrl),
        ageDays: Math.max(0, ageDays),
        isStale: ageDays > 14,
      };
    }),
  ];

  return {
    provider: "bitbucket",
    baseUrl: cfg.baseUrl,
    webUrl: String(repoData.links?.html?.href || buildGitRepoWebUrl("bitbucket", cfg.baseUrl, cfg.repoSlug)),
    owner,
    repo,
    fullName: String(repoData.full_name || cfg.repoSlug),
    description: String(repoData.description || ""),
    stars: 0,
    forks: 0,
    openIssuesCount: Number(issuesJson?.size ?? issueList.length),
    totalOpenIssuesAndPrs: Number(issuesJson?.size ?? issueList.length) + Number(prsJson?.size ?? prList.length),
    openPrCount: Number(prsJson?.size ?? prList.length),
    prReviewVelocityHours: 0,
    staleIssuesCount: recentIssues.filter((i) => !i.isPullRequest && i.isStale).length,
    freshIssuesCount: recentIssues.filter((i) => !i.isPullRequest && !i.isStale).length,
    dependabotAlertsCount: 0,
    defaultBranch: String(repoData.mainbranch?.name || "main"),
    latestRelease: latestTag?.name
      ? {
          tagName: String(latestTag.name),
          publishedAt: String(latestTag.target?.date || new Date().toISOString()),
          name: String(latestTag.name),
        }
      : undefined,
    pipelineStatus: pipe
      ? {
          status: String(pipe.state?.result?.name || pipe.state?.name || "unknown").toLowerCase(),
          ref: pipe.target?.ref_name ? String(pipe.target.ref_name) : null,
          webUrl: null,
          updatedAt: pipe.completed_on || pipe.created_on || null,
        }
      : null,
    pulls: prList.slice(0, 20).map((pr) => ({
      id: Number(pr.id),
      number: Number(pr.id),
      title: String(pr.title || ""),
      state: String(pr.state || "OPEN").toLowerCase(),
      draft: false,
      author: String(pr.author?.nickname || "contributor"),
      htmlUrl: String(pr.links?.html?.href || cfg.baseUrl),
      headRef: String(pr.source?.branch?.name || "branch"),
      baseRef: String(pr.destination?.branch?.name || "main"),
      createdAt: String(pr.created_on),
      updatedAt: String(pr.updated_on || pr.created_on),
    })),
    recentIssues,
  };
}

async function fetchGiteaRepoStats(cfg: GitProviderConfig): Promise<GitRepoStats | null> {
  const { owner, repo } = splitOwnerRepo(cfg.repoSlug);
  const apiBase = `${cfg.baseUrl}/api/v1/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
  const headers: Record<string, string> = {};
  if (cfg.token) headers.Authorization = `token ${cfg.token}`;

  const [repoData, prs, issues, latestRel] = await Promise.all([
    fetchJsonSafe<any>(apiBase, headers),
    fetchJsonSafe<any[]>(`${apiBase}/pulls?state=open&limit=25`, headers),
    fetchJsonSafe<any[]>(`${apiBase}/issues?state=open&type=issues&limit=15`, headers),
    fetchJsonSafe<any>(`${apiBase}/releases/latest`, headers),
  ]);

  if (!repoData?.id) return null;

  const nowMs = Date.now();
  const prList = Array.isArray(prs) ? prs : [];
  const issueList = Array.isArray(issues) ? issues : [];

  const recentIssues: GitRepoStats["recentIssues"] = [
    ...prList.slice(0, 6).map((pr) => {
      const ageDays = Math.floor((nowMs - new Date(pr.created_at).getTime()) / (1000 * 60 * 60 * 24));
      return {
        id: Number(pr.id || pr.number),
        number: Number(pr.number),
        title: String(pr.title || "PR"),
        state: String(pr.state || "open"),
        createdAt: String(pr.created_at),
        isPullRequest: true,
        author: String(pr.user?.login || "contributor"),
        htmlUrl: String(pr.html_url || cfg.baseUrl),
        ageDays: Math.max(0, ageDays),
        isStale: ageDays > 14,
      };
    }),
    ...issueList.slice(0, 8).map((iss) => {
      const ageDays = Math.floor((nowMs - new Date(iss.created_at).getTime()) / (1000 * 60 * 60 * 24));
      return {
        id: Number(iss.id || iss.number),
        number: Number(iss.number),
        title: String(iss.title || "Issue"),
        state: String(iss.state || "open"),
        createdAt: String(iss.created_at),
        isPullRequest: false,
        author: String(iss.user?.login || "reporter"),
        htmlUrl: String(iss.html_url || cfg.baseUrl),
        ageDays: Math.max(0, ageDays),
        isStale: ageDays > 14,
      };
    }),
  ];

  return {
    provider: "gitea",
    baseUrl: cfg.baseUrl,
    webUrl: String(repoData.html_url || buildGitRepoWebUrl("gitea", cfg.baseUrl, cfg.repoSlug)),
    owner,
    repo,
    fullName: String(repoData.full_name || cfg.repoSlug),
    description: String(repoData.description || ""),
    stars: Number(repoData.stars_count || 0),
    forks: Number(repoData.forks_count || 0),
    openIssuesCount: Number(repoData.open_issues_count ?? issueList.length),
    totalOpenIssuesAndPrs: Number(repoData.open_issues_count ?? issueList.length) + Number(repoData.open_pr_counter ?? prList.length),
    openPrCount: Number(repoData.open_pr_counter ?? prList.length),
    prReviewVelocityHours: 0,
    staleIssuesCount: recentIssues.filter((i) => !i.isPullRequest && i.isStale).length,
    freshIssuesCount: recentIssues.filter((i) => !i.isPullRequest && !i.isStale).length,
    dependabotAlertsCount: 0,
    defaultBranch: String(repoData.default_branch || "main"),
    latestRelease: latestRel?.tag_name
      ? {
          tagName: String(latestRel.tag_name),
          publishedAt: String(latestRel.published_at || latestRel.created_at || new Date().toISOString()),
          name: String(latestRel.name || latestRel.tag_name),
        }
      : undefined,
    pulls: prList.slice(0, 20).map((pr) => ({
      id: Number(pr.id || pr.number),
      number: Number(pr.number),
      title: String(pr.title || ""),
      state: String(pr.state || "open"),
      draft: false,
      author: String(pr.user?.login || "contributor"),
      htmlUrl: String(pr.html_url || cfg.baseUrl),
      headRef: String(pr.head?.ref || "branch"),
      baseRef: String(pr.base?.ref || "main"),
      createdAt: String(pr.created_at),
      updatedAt: String(pr.updated_at || pr.created_at),
    })),
    recentIssues,
  };
}

export async function fetchGitRepoStats(config: GitProviderConfig): Promise<GitRepoStats | null> {
  if (config.provider === "gitlab") return await fetchGitLabRepoStats(config);
  if (config.provider === "bitbucket") return await fetchBitbucketRepoStats(config);
  if (config.provider === "gitea") return await fetchGiteaRepoStats(config);

  const gh = await fetchGitHubRepoStats(config.repoSlug, config.token || undefined);
  if (!gh) return null;
  return {
    ...gh,
    provider: "github",
    baseUrl: "https://github.com",
    webUrl: `https://github.com/${gh.fullName}`,
    pipelineStatus: null,
  };
}

export async function listGitRepoRootFiles(config: GitProviderConfig): Promise<string[]> {
  if (config.provider === "gitlab") {
    const encoded = encodeURIComponent(config.repoSlug);
    const headers: Record<string, string> = {};
    if (config.token) headers["PRIVATE-TOKEN"] = config.token;
    const tree = await fetchJsonSafe<Array<{ name?: string; type?: string }>>(
      `${config.baseUrl}/api/v4/projects/${encoded}/repository/tree?per_page=100`,
      headers
    );
    return Array.isArray(tree) ? tree.map((i) => String(i.name || "")).filter(Boolean) : [];
  }

  if (config.provider === "bitbucket") {
    const { owner, repo } = splitOwnerRepo(config.repoSlug);
    const headers: Record<string, string> = {};
    if (config.token) headers.Authorization = `Bearer ${cfgToken(config.token)}`;
    const src = await fetchJsonSafe<{ values?: Array<{ path?: string }> }>(
      `https://api.bitbucket.org/2.0/repositories/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/src?pagelen=100`,
      headers
    );
    return Array.isArray(src?.values) ? src.values.map((v) => String(v.path || "")).filter(Boolean) : [];
  }

  if (config.provider === "gitea") {
    const { owner, repo } = splitOwnerRepo(config.repoSlug);
    const headers: Record<string, string> = {};
    if (config.token) headers.Authorization = `token ${config.token}`;
    const contents = await fetchJsonSafe<Array<{ name?: string }>>(
      `${config.baseUrl}/api/v1/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents`,
      headers
    );
    return Array.isArray(contents) ? contents.map((i) => String(i.name || "")).filter(Boolean) : [];
  }

  const headers: Record<string, string> = { Accept: "application/vnd.github.v3+json" };
  if (config.token) headers.Authorization = `Bearer ${config.token}`;
  const items = await fetchJsonSafe<Array<{ name?: string }>>(
    `https://api.github.com/repos/${config.repoSlug}/contents`,
    headers
  );
  return Array.isArray(items) ? items.map((i) => String(i.name || "")).filter(Boolean) : [];
}

function cfgToken(t: string): string {
  return t.trim();
}

export async function fetchGitRepoRawFile(
  config: GitProviderConfig,
  fileName: string,
  defaultBranch = "main"
): Promise<string | null> {
  try {
    if (config.provider === "gitlab") {
      const encoded = encodeURIComponent(config.repoSlug);
      const headers: Record<string, string> = { "User-Agent": UA };
      if (config.token) headers["PRIVATE-TOKEN"] = config.token;
      const res = await fetch(
        `${config.baseUrl}/api/v4/projects/${encoded}/repository/files/${encodeURIComponent(fileName)}/raw?ref=${encodeURIComponent(defaultBranch)}`,
        { headers, signal: AbortSignal.timeout(4000), cache: "no-store" }
      ).catch(() => null);
      return res && res.ok ? await res.text() : null;
    }

    if (config.provider === "bitbucket") {
      const { owner, repo } = splitOwnerRepo(config.repoSlug);
      const headers: Record<string, string> = { "User-Agent": UA };
      if (config.token) headers.Authorization = `Bearer ${config.token}`;
      const res = await fetch(
        `https://api.bitbucket.org/2.0/repositories/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/src/${encodeURIComponent(defaultBranch)}/${encodeURIComponent(fileName)}`,
        { headers, signal: AbortSignal.timeout(4000), cache: "no-store" }
      ).catch(() => null);
      return res && res.ok ? await res.text() : null;
    }

    if (config.provider === "gitea") {
      const { owner, repo } = splitOwnerRepo(config.repoSlug);
      const headers: Record<string, string> = { Accept: "application/json", "User-Agent": UA };
      if (config.token) headers.Authorization = `token ${config.token}`;
      const res = await fetch(
        `${config.baseUrl}/api/v1/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/raw/${encodeURIComponent(fileName)}`,
        { headers, signal: AbortSignal.timeout(4000), cache: "no-store" }
      ).catch(() => null);
      return res && res.ok ? await res.text() : null;
    }

    const headers: Record<string, string> = { Accept: "application/vnd.github.v3+json", "User-Agent": UA };
    if (config.token) headers.Authorization = `Bearer ${config.token}`;
    const res = await fetch(
      `https://api.github.com/repos/${config.repoSlug}/contents/${fileName}`,
      { headers, signal: AbortSignal.timeout(4000), cache: "no-store" }
    ).catch(() => null);
    if (!res || !res.ok) return null;
    const data = await res.json().catch(() => null);
    if (data?.content && data?.encoding === "base64") {
      return Buffer.from(data.content, "base64").toString("utf-8");
    }
    return null;
  } catch {
    return null;
  }
}
