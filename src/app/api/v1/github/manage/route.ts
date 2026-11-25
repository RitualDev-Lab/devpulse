import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { resolveProjectAccess } from "@/lib/security/rbac";
import { decryptSecret } from "@/lib/security/crypto";
import { getUserGitHubAccessToken } from "@/lib/security/github-ownership";
import { recordAuditEvent } from "@/lib/security/audit";

export const dynamic = "force-dynamic";

async function resolveGitHubTokenForProject(userId: string, encryptedProjectToken?: string | null) {
  const projectToken = await decryptSecret(encryptedProjectToken).catch(() => null);
  if (projectToken) return projectToken;
  return await getUserGitHubAccessToken(userId).catch(() => null);
}

export async function GET(req: NextRequest) {
  try {
    const projectId = req.nextUrl.searchParams.get("projectId");
    const state = req.nextUrl.searchParams.get("state") === "closed" ? "closed" : "open";
    if (!projectId) {
      return NextResponse.json({ error: "Missing projectId" }, { status: 400 });
    }

    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const access = await resolveProjectAccess(projectId, user);
    if (!access) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const repoSlug = access.project.githubRepo;
    if (!repoSlug || !repoSlug.includes("/")) {
      return NextResponse.json({ error: "No GitHub repository linked to this project" }, { status: 400 });
    }

    const token = await resolveGitHubTokenForProject(user.id, access.project.githubTokenEncrypted);
    const headers: Record<string, string> = {
      Accept: "application/vnd.github.v3+json",
      "User-Agent": "DevPulse-RitualDev",
    };
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }

    const [issuesRes, prsRes, clonesRes, viewsRes] = await Promise.all([
      fetch(`https://api.github.com/repos/${repoSlug}/issues?state=${state}&per_page=30`, { headers }),
      fetch(`https://api.github.com/repos/${repoSlug}/pulls?state=${state}&per_page=30`, { headers }),
      token
        ? fetch(`https://api.github.com/repos/${repoSlug}/traffic/clones`, { headers }).catch(() => null)
        : Promise.resolve(null),
      token
        ? fetch(`https://api.github.com/repos/${repoSlug}/traffic/views`, { headers }).catch(() => null)
        : Promise.resolve(null),
    ]);

    const rawIssues = issuesRes.ok ? await issuesRes.json() : [];
    const rawPrs = prsRes.ok ? await prsRes.json() : [];
    const clonesJson = clonesRes && clonesRes.ok ? await clonesRes.json() : null;
    const viewsJson = viewsRes && viewsRes.ok ? await viewsRes.json() : null;

    return NextResponse.json({
      repo: repoSlug,
      htmlUrl: `https://github.com/${repoSlug}`,
      hasWriteToken: Boolean(token),
      issues: Array.isArray(rawIssues)
        ? rawIssues
            .filter((i: any) => !i.pull_request)
            .map((i: any) => ({
              id: i.id,
              number: i.number,
              title: i.title,
              state: i.state,
              comments: i.comments || 0,
              author: i.user?.login || "unknown",
              avatarUrl: i.user?.avatar_url || null,
              labels: Array.isArray(i.labels) ? i.labels.map((l: any) => ({ name: l.name, color: l.color })) : [],
              htmlUrl: i.html_url,
              createdAt: i.created_at,
              updatedAt: i.updated_at,
            }))
        : [],
      pulls: Array.isArray(rawPrs)
        ? rawPrs.map((p: any) => ({
            id: p.id,
            number: p.number,
            title: p.title,
            state: p.state,
            draft: Boolean(p.draft),
            author: p.user?.login || "unknown",
            avatarUrl: p.user?.avatar_url || null,
            headRef: p.head?.ref || "",
            baseRef: p.base?.ref || "",
            htmlUrl: p.html_url,
            createdAt: p.created_at,
            updatedAt: p.updated_at,
          }))
        : [],
      trafficClones: clonesJson
        ? {
            count: clonesJson.count || 0,
            uniques: clonesJson.uniques || 0,
            daily: Array.isArray(clonesJson.clones)
              ? clonesJson.clones.map((d: any) => ({
                  date: String(d.timestamp || "").slice(0, 10),
                  count: d.count || 0,
                  uniques: d.uniques || 0,
                }))
              : [],
          }
        : null,
      trafficViews: viewsJson
        ? {
            count: viewsJson.count || 0,
            uniques: viewsJson.uniques || 0,
            daily: Array.isArray(viewsJson.views)
              ? viewsJson.views.map((d: any) => ({
                  date: String(d.timestamp || "").slice(0, 10),
                  count: d.count || 0,
                  uniques: d.uniques || 0,
                }))
              : [],
          }
        : null,
    });
  } catch (err: any) {
    console.error("GET /api/v1/github/manage error:", err);
    return NextResponse.json({ error: "Failed to load GitHub data" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const projectId = String(body.projectId || "");
    const action = String(body.action || "");
    const itemNumber = Number(body.number || 0);

    if (!projectId || !itemNumber) {
      return NextResponse.json({ error: "Missing projectId or issue/PR number" }, { status: 400 });
    }

    const access = await resolveProjectAccess(projectId, user);
    if (!access || !access.canWrite) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const repoSlug = access.project.githubRepo;
    if (!repoSlug) {
      return NextResponse.json({ error: "No GitHub repository linked" }, { status: 400 });
    }

    const token = await resolveGitHubTokenForProject(user.id, access.project.githubTokenEncrypted);
    if (!token) {
      return NextResponse.json(
        {
          error: "A GitHub Personal Access Token or write-scoped GitHub sign-in is required to modify issues/PRs. Add one in Settings -> Quick Connect.",
          code: "GITHUB_TOKEN_REQUIRED",
        },
        { status: 403 }
      );
    }

    const headers = {
      Accept: "application/vnd.github.v3+json",
      "User-Agent": "DevPulse-RitualDev",
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    };

    let ghRes: Response;
    if (action === "close_issue" || action === "reopen_issue") {
      ghRes = await fetch(`https://api.github.com/repos/${repoSlug}/issues/${itemNumber}`, {
        method: "PATCH",
        headers,
        body: JSON.stringify({ state: action === "close_issue" ? "closed" : "open" }),
      });
    } else if (action === "comment") {
      const commentBody = String(body.body || "").trim();
      if (!commentBody) {
        return NextResponse.json({ error: "Comment cannot be empty" }, { status: 400 });
      }
      ghRes = await fetch(`https://api.github.com/repos/${repoSlug}/issues/${itemNumber}/comments`, {
        method: "POST",
        headers,
        body: JSON.stringify({ body: commentBody }),
      });
    } else if (action === "merge_pr") {
      ghRes = await fetch(`https://api.github.com/repos/${repoSlug}/pulls/${itemNumber}/merge`, {
        method: "PUT",
        headers,
        body: JSON.stringify({ merge_method: body.mergeMethod || "squash" }),
      });
    } else {
      return NextResponse.json({ error: "Unsupported GitHub action" }, { status: 400 });
    }

    const data = await ghRes.json().catch(() => ({}));
    if (!ghRes.ok) {
      return NextResponse.json(
        {
          error:
            data.message ||
            `GitHub returned ${ghRes.status}. Ensure your PAT/OAuth token has repo write permission or open directly on GitHub.`,
        },
        { status: ghRes.status }
      );
    }

    await recordAuditEvent({
      userId: user.id,
      actorUsername: user.githubUsername,
      organizationId: access.project.organizationId,
      projectId,
      action: `github.${action}`,
      resourceType: "github_issue_pr",
      resourceId: `${repoSlug}#${itemNumber}`,
      headers: req.headers,
    });

    return NextResponse.json({ success: true, data });
  } catch (err: any) {
    console.error("POST /api/v1/github/manage error:", err);
    return NextResponse.json({ error: "GitHub action failed" }, { status: 500 });
  }
}
