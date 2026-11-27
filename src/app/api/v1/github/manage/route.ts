import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { dailyMetrics } from "@/db/schema";
import { and, asc, eq, sql } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth";
import { resolveProjectAccess } from "@/lib/security/rbac";
import { decryptSecret } from "@/lib/security/crypto";
import { getUserGitHubAccessToken } from "@/lib/security/github-ownership";
import { recordAuditEvent } from "@/lib/security/audit";
import { apiError } from "@/lib/security/api-error";

export const dynamic = "force-dynamic";

async function resolveGitHubTokenForProject(userId: string, encryptedProjectToken?: string | null) {
  const projectToken = await decryptSecret(encryptedProjectToken).catch(() => null);
  if (projectToken) return projectToken;
  return await getUserGitHubAccessToken(userId).catch(() => null);
}

export async function GET(req: NextRequest) {
  try {
    const projectId = req.nextUrl.searchParams.get("projectId");
    const mode = req.nextUrl.searchParams.get("mode");
    const issueNumber = req.nextUrl.searchParams.get("number");
    const state = req.nextUrl.searchParams.get("state") === "closed" ? "closed" : "open";
    const filterQ = (req.nextUrl.searchParams.get("q") || "").trim().toLowerCase();

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

    // Inspect Issue / PR Thread Mode
    if (mode === "thread" && issueNumber) {
      const [issueRes, commentsRes] = await Promise.all([
        fetch(`https://api.github.com/repos/${repoSlug}/issues/${Number(issueNumber)}`, { headers }),
        fetch(`https://api.github.com/repos/${repoSlug}/issues/${Number(issueNumber)}/comments?per_page=30`, { headers }),
      ]);
      const issueData = issueRes.ok ? await issueRes.json() : null;
      const commentsData = commentsRes.ok ? await commentsRes.json() : [];
      if (!issueData) {
        return NextResponse.json({ error: "Issue or PR not found" }, { status: 404 });
      }
      return NextResponse.json({
        number: issueData.number,
        title: issueData.title,
        body: issueData.body || "",
        state: issueData.state,
        author: issueData.user?.login || "unknown",
        htmlUrl: issueData.html_url,
        labels: Array.isArray(issueData.labels)
          ? issueData.labels.map((l: any) => ({ name: l.name, color: l.color }))
          : [],
        comments: Array.isArray(commentsData)
          ? commentsData.map((c: any) => ({
              id: c.id,
              author: c.user?.login || "unknown",
              body: c.body || "",
              createdAt: c.created_at,
              htmlUrl: c.html_url,
            }))
          : [],
      });
    }

    const [issuesRes, prsRes, clonesRes, viewsRes, storedMetrics] = await Promise.all([
      fetch(`https://api.github.com/repos/${repoSlug}/issues?state=${state}&per_page=40`, { headers }),
      fetch(`https://api.github.com/repos/${repoSlug}/pulls?state=${state}&per_page=40`, { headers }),
      token
        ? fetch(`https://api.github.com/repos/${repoSlug}/traffic/clones`, { headers }).catch(() => null)
        : Promise.resolve(null),
      token
        ? fetch(`https://api.github.com/repos/${repoSlug}/traffic/views`, { headers }).catch(() => null)
        : Promise.resolve(null),
      db
        .select()
        .from(dailyMetrics)
        .where(and(eq(dailyMetrics.projectId, projectId), eq(dailyMetrics.source, "github")))
        .orderBy(asc(dailyMetrics.date))
        .limit(180)
        .catch(() => []),
    ]);

    const rawIssues = issuesRes.ok ? await issuesRes.json() : [];
    const rawPrs = prsRes.ok ? await prsRes.json() : [];
    const clonesJson = clonesRes && clonesRes.ok ? await clonesRes.json() : null;
    const viewsJson = viewsRes && viewsRes.ok ? await viewsRes.json() : null;

    // Persist live 14d traffic snapshots to daily_metrics so GitHub traffic history never expires
    const clonesMap = new Map<string, { date: string; count: number; uniques: number }>();
    const viewsMap = new Map<string, { date: string; count: number; uniques: number }>();
    const starsMap = new Map<string, { date: string; stars: number }>();

    for (const row of storedMetrics) {
      let meta: any = {};
      try {
        meta = row.metadataJson ? JSON.parse(row.metadataJson) : {};
      } catch {
        meta = {};
      }
      if (row.metricType === "clones") {
        clonesMap.set(row.date, { date: row.date, count: row.value, uniques: Number(meta.uniques || 0) });
      } else if (row.metricType === "views") {
        viewsMap.set(row.date, { date: row.date, count: row.value, uniques: Number(meta.uniques || 0) });
      } else if (row.metricType === "stars") {
        starsMap.set(row.date, { date: row.date, stars: row.value });
      }
    }

    if (Array.isArray(clonesJson?.clones)) {
      for (const d of clonesJson.clones) {
        const dt = String(d.timestamp || "").slice(0, 10);
        if (!dt) continue;
        const incomingCount = Number(d.count || 0);
        const incomingUniques = Number(d.uniques || 0);
        const prev = clonesMap.get(dt);
        const mergedCount = Math.max(prev?.count || 0, incomingCount);
        const mergedUniques = Math.max(prev?.uniques || 0, incomingUniques);
        clonesMap.set(dt, { date: dt, count: mergedCount, uniques: mergedUniques });
        db.insert(dailyMetrics)
          .values({
            id: `met_gh_clones_${projectId}_${dt}`,
            projectId,
            source: "github",
            metricType: "clones",
            date: dt,
            value: incomingCount,
            metadataJson: JSON.stringify({ uniques: incomingUniques, estimated: true }),
          })
          .onConflictDoUpdate({
            target: dailyMetrics.id,
            set: {
              value: sql`max(${dailyMetrics.value}, ${incomingCount})`,
              metadataJson: JSON.stringify({ uniques: mergedUniques, estimated: true }),
            },
          })
          .catch(() => {});
      }
    }

    if (Array.isArray(viewsJson?.views)) {
      for (const d of viewsJson.views) {
        const dt = String(d.timestamp || "").slice(0, 10);
        if (!dt) continue;
        const incomingCount = Number(d.count || 0);
        const incomingUniques = Number(d.uniques || 0);
        const prev = viewsMap.get(dt);
        const mergedCount = Math.max(prev?.count || 0, incomingCount);
        const mergedUniques = Math.max(prev?.uniques || 0, incomingUniques);
        viewsMap.set(dt, { date: dt, count: mergedCount, uniques: mergedUniques });
        db.insert(dailyMetrics)
          .values({
            id: `met_gh_views_${projectId}_${dt}`,
            projectId,
            source: "github",
            metricType: "views",
            date: dt,
            value: incomingCount,
            metadataJson: JSON.stringify({ uniques: incomingUniques, estimated: true }),
          })
          .onConflictDoUpdate({
            target: dailyMetrics.id,
            set: {
              value: sql`max(${dailyMetrics.value}, ${incomingCount})`,
              metadataJson: JSON.stringify({ uniques: mergedUniques, estimated: true }),
            },
          })
          .catch(() => {});
      }
    }

    const clonesDaily = Array.from(clonesMap.values()).sort((a, b) => a.date.localeCompare(b.date));
    const viewsDaily = Array.from(viewsMap.values()).sort((a, b) => a.date.localeCompare(b.date));
    const starsDaily = Array.from(starsMap.values()).sort((a, b) => a.date.localeCompare(b.date));

    const matchQuery = (title: string, author: string, num: number) =>
      !filterQ ||
      title.toLowerCase().includes(filterQ) ||
      author.toLowerCase().includes(filterQ) ||
      String(num).includes(filterQ);

    return NextResponse.json({
      repo: repoSlug,
      htmlUrl: `https://github.com/${repoSlug}`,
      hasWriteToken: Boolean(token),
      issues: Array.isArray(rawIssues)
        ? rawIssues
            .filter((i: any) => !i.pull_request && matchQuery(i.title || "", i.user?.login || "", i.number))
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
        ? rawPrs
            .filter((p: any) => matchQuery(p.title || "", p.user?.login || "", p.number))
            .map((p: any) => ({
              id: p.id,
              number: p.number,
              title: p.title,
              state: p.state,
              draft: Boolean(p.draft),
              author: p.user?.login || "unknown",
              avatarUrl: p.user?.avatar_url || null,
              labels: Array.isArray(p.labels) ? p.labels.map((l: any) => ({ name: l.name, color: l.color })) : [],
              headRef: p.head?.ref || "",
              baseRef: p.base?.ref || "",
              htmlUrl: p.html_url,
              createdAt: p.created_at,
              updatedAt: p.updated_at,
            }))
        : [],
      trafficClones:
        clonesDaily.length > 0 || clonesJson
          ? {
              count: clonesJson?.count ?? clonesDaily.reduce((s, d) => s + d.count, 0),
              uniques: clonesJson?.uniques ?? clonesDaily.reduce((s, d) => s + d.uniques, 0),
              daily: clonesDaily,
            }
          : null,
      trafficViews:
        viewsDaily.length > 0 || viewsJson
          ? {
              count: viewsJson?.count ?? viewsDaily.reduce((s, d) => s + d.count, 0),
              uniques: viewsJson?.uniques ?? viewsDaily.reduce((s, d) => s + d.uniques, 0),
              daily: viewsDaily,
            }
          : null,
      starsDaily,
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
    } else if (action === "add_label") {
      const labelName = String(body.label || "").trim().slice(0, 50);
      if (!labelName) {
        return NextResponse.json({ error: "Label name is required" }, { status: 400 });
      }
      ghRes = await fetch(`https://api.github.com/repos/${repoSlug}/issues/${itemNumber}/labels`, {
        method: "POST",
        headers,
        body: JSON.stringify({ labels: [labelName] }),
      });
    } else if (action === "remove_label") {
      const labelName = String(body.label || "").trim().slice(0, 50);
      ghRes = await fetch(
        `https://api.github.com/repos/${repoSlug}/issues/${itemNumber}/labels/${encodeURIComponent(labelName)}`,
        { method: "DELETE", headers }
      );
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
      return apiError(
        data,
        `GitHub returned ${ghRes.status}. Ensure your PAT/OAuth token has repo write permission or open directly on GitHub.`,
        ghRes.status
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
