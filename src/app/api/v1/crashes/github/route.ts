import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { errorEvents } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth";
import { resolveProjectAccess } from "@/lib/security/rbac";
import { decryptSecret } from "@/lib/security/crypto";
import { getUserGitHubAccessToken } from "@/lib/security/github-ownership";
import { recordAuditEvent } from "@/lib/security/audit";
import { apiError } from "@/lib/security/api-error";
import { PUBLIC_APP_URL } from "@/lib/config/app-url";

export const dynamic = "force-dynamic";

async function resolveGitHubTokenForProject(userId: string, encryptedProjectToken?: string | null) {
  const projectToken = await decryptSecret(encryptedProjectToken).catch(() => null);
  if (projectToken) return projectToken;
  return await getUserGitHubAccessToken(userId).catch(() => null);
}

/**
 * POST /api/v1/crashes/github
 * Full Two-Way GitHub Integration:
 *  - create_issue: Creates a GitHub Issue directly from a crash in DevPulse
 *  - link_pr: Links a PR # to a crash (auto-closes crash when PR merges)
 *  - comment_stats: Posts live crash occurrences, users & MRR impact onto linked Issue/PR
 */
export async function POST(req: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await req.json();
    const projectId = String(body.projectId || "");
    const errorId = String(body.errorId || "");
    const action = String(body.action || "");

    if (!projectId || !errorId) {
      return NextResponse.json({ error: "Missing projectId or errorId" }, { status: 400 });
    }

    const access = await resolveProjectAccess(projectId, user);
    if (!access || !access.canWrite) {
      return NextResponse.json(
        { error: "Forbidden: Developer, Admin, or Owner permissions required." },
        { status: 403 }
      );
    }

    const repoSlug = access.project.githubRepo;
    if (!repoSlug || !repoSlug.includes("/")) {
      return NextResponse.json(
        { error: "No GitHub repository linked to this project" },
        { status: 400 }
      );
    }

    const token = await resolveGitHubTokenForProject(
      user.id,
      access.project.githubTokenEncrypted
    );
    if (!token) {
      return NextResponse.json(
        { error: "Connect GitHub OAuth or add a repo PAT in Quick Connect to perform GitHub writes." },
        { status: 401 }
      );
    }

    const [errRow] = await db
      .select()
      .from(errorEvents)
      .where(and(eq(errorEvents.id, errorId), eq(errorEvents.projectId, projectId)))
      .limit(1);

    if (!errRow) {
      return NextResponse.json({ error: "Crash event not found" }, { status: 404 });
    }

    const ghHeaders = {
      Accept: "application/vnd.github.v3+json",
      "User-Agent": "DevPulse-RitualDev",
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    };

    const groupWhere = errRow.aiGroupKey
      ? and(eq(errorEvents.projectId, projectId), eq(errorEvents.aiGroupKey, errRow.aiGroupKey))
      : and(eq(errorEvents.projectId, projectId), eq(errorEvents.id, errRow.id));

    if (action === "create_issue") {
      const title = `[DevPulse] ${errRow.aiGroupTitle || `${errRow.errorName}: ${errRow.message.slice(0, 72)}`}`;
      const lostUsd = Math.round((errRow.estimatedLostRevenueCents || 0) / 100);
      const issueBody = [
        `### Crash Summary`,
        `- **Error:** \`${errRow.errorName}\``,
        `- **Platform / Runtime:** \`${errRow.platform}\` / \`${errRow.runtime}\``,
        `- **Release:** \`${errRow.version || "N/A"}\``,
        `- **Business Impact:** ${errRow.affectedUsersCount || 1} user(s) • est. \$${lostUsd} lost MRR`,
        errRow.routePath ? `- **Route:** \`${errRow.routePath}\`` : null,
        errRow.isRegression ? `- **Status Flag:** REGRESSION (re-appeared after earlier fix)` : null,
        "",
        `### Message`,
        "```",
        errRow.message,
        "```",
        errRow.aiRootCause ? `\n### AI Root Cause\n${errRow.aiRootCause}` : null,
        errRow.aiFixSuggestion ? `\n### Suggested Fix\n${errRow.aiFixSuggestion}` : null,
        errRow.stackTrace
          ? `\n### Stack Trace\n\`\`\`\n${errRow.stackTrace.slice(0, 2000)}\n\`\`\``
          : null,
        `\n[Inspect in DevPulse](${PUBLIC_APP_URL}/dashboard/crashes?project=${access.project.slug})`,
      ]
        .filter(Boolean)
        .join("\n");

      const ghRes = await fetch(`https://api.github.com/repos/${repoSlug}/issues`, {
        method: "POST",
        headers: ghHeaders,
        body: JSON.stringify({
          title,
          body: issueBody,
          labels: errRow.isRegression ? ["bug", "regression"] : ["bug"],
        }),
      });
      const ghData = await ghRes.json();
      if (!ghRes.ok) {
        return apiError(ghData, "Failed to create GitHub issue", ghRes.status);
      }

      await db
        .update(errorEvents)
        .set({
          githubIssueNumber: ghData.number,
          githubIssueUrl: ghData.html_url,
        })
        .where(groupWhere);

      await recordAuditEvent({
        userId: user.id,
        actorUsername: user.githubUsername,
        organizationId: access.project.organizationId,
        workspaceId: access.project.workspaceId,
        projectId,
        action: "crash.github_issue_created",
        resourceType: "error_event",
        resourceId: errRow.id,
        headers: req.headers,
        metadata: { issueNumber: ghData.number, issueUrl: ghData.html_url },
      });

      return NextResponse.json({
        success: true,
        issueNumber: ghData.number,
        issueUrl: ghData.html_url,
      });
    }

    if (action === "link_pr") {
      const prNumber = Number(String(body.prNumber || "").replace(/^#/, ""));
      if (!Number.isFinite(prNumber) || prNumber <= 0) {
        return NextResponse.json({ error: "Valid PR number required" }, { status: 400 });
      }

      const prRes = await fetch(`https://api.github.com/repos/${repoSlug}/pulls/${prNumber}`, {
        headers: ghHeaders,
      });
      const prData = await prRes.json();
      if (!prRes.ok) {
        return apiError(prData, `PR #${prNumber} not found in ${repoSlug}`, prRes.status);
      }

      await db
        .update(errorEvents)
        .set({
          githubPrNumber: prData.number,
          githubPrUrl: prData.html_url,
        })
        .where(groupWhere);

      await recordAuditEvent({
        userId: user.id,
        actorUsername: user.githubUsername,
        organizationId: access.project.organizationId,
        workspaceId: access.project.workspaceId,
        projectId,
        action: "crash.github_pr_linked",
        resourceType: "error_event",
        resourceId: errRow.id,
        headers: req.headers,
        metadata: { prNumber: prData.number, prUrl: prData.html_url },
      });

      return NextResponse.json({
        success: true,
        prNumber: prData.number,
        prUrl: prData.html_url,
        merged: Boolean(prData.merged),
      });
    }

    if (action === "comment_stats") {
      const targetNumber =
        Number(body.targetNumber) || errRow.githubIssueNumber || errRow.githubPrNumber;
      if (!targetNumber) {
        return NextResponse.json(
          { error: "No linked GitHub Issue or PR number to comment on." },
          { status: 400 }
        );
      }

      const groupEvents = errRow.aiGroupKey
        ? await db
            .select()
            .from(errorEvents)
            .where(
              and(eq(errorEvents.projectId, projectId), eq(errorEvents.aiGroupKey, errRow.aiGroupKey))
            )
        : [errRow];

      const totalOccurrences = groupEvents.length;
      const totalUsers = groupEvents.reduce(
        (s, e) => s + Math.max(1, e.affectedUsersCount || 1),
        0
      );
      const totalLostUsd = Math.round(
        groupEvents.reduce((s, e) => s + (e.estimatedLostRevenueCents || 0), 0) / 100
      );
      const versions = Array.from(
        new Set(groupEvents.map((e) => e.version).filter(Boolean))
      ).join(", ");

      const commentBody = [
        `### 📊 DevPulse Live Crash Telemetry Update`,
        `- **Occurrences:** ${totalOccurrences}`,
        `- **Affected Users:** ${totalUsers.toLocaleString()}`,
        `- **Estimated Lost MRR:** \$${totalLostUsd.toLocaleString()}`,
        `- **Seen In Releases:** ${versions || "N/A"}`,
        `- **Latest Seen:** ${errRow.createdAt}`,
      ].join("\n");

      const cRes = await fetch(
        `https://api.github.com/repos/${repoSlug}/issues/${targetNumber}/comments`,
        {
          method: "POST",
          headers: ghHeaders,
          body: JSON.stringify({ body: commentBody }),
        }
      );
      const cData = await cRes.json();
      if (!cRes.ok) {
        return apiError(cData, "Failed to post GitHub comment", cRes.status);
      }

      return NextResponse.json({
        success: true,
        commentUrl: cData.html_url,
      });
    }

    if (action === "suspect_commits") {
      const headSha = String(body.commitSha || errRow.commitSha || "").trim();
      const baseSha = String(body.baseCommitSha || "").trim();
      if (!headSha) {
        return NextResponse.json({ suspectCommits: [] });
      }
      const compareEndpoint = baseSha
        ? `https://api.github.com/repos/${repoSlug}/compare/${encodeURIComponent(baseSha)}...${encodeURIComponent(headSha)}`
        : `https://api.github.com/repos/${repoSlug}/commits/${encodeURIComponent(headSha)}`;
      const ghRes = await fetch(compareEndpoint, { headers: ghHeaders });
      if (!ghRes.ok) {
        return NextResponse.json({ suspectCommits: [] });
      }
      const data = await ghRes.json();
      const commits = Array.isArray(data?.commits)
        ? data.commits.slice(-10).map((c: any) => ({
            sha: String(c.sha || "").slice(0, 7),
            message: String(c.commit?.message || "").split("\n")[0],
            author: c.commit?.author?.name || c.author?.login || "unknown",
            date: c.commit?.author?.date || "",
            htmlUrl: c.html_url || "",
          }))
        : data?.sha
        ? [
            {
              sha: String(data.sha).slice(0, 7),
              message: String(data.commit?.message || "").split("\n")[0],
              author: data.commit?.author?.name || data.author?.login || "unknown",
              date: data.commit?.author?.date || "",
              htmlUrl: data.html_url || "",
            },
          ]
        : [];
      return NextResponse.json({ success: true, suspectCommits: commits });
    }

    return NextResponse.json({ error: "Unsupported GitHub crash action" }, { status: 400 });
  } catch (err) {
    console.error("POST /api/v1/crashes/github error:", err);
    return NextResponse.json({ error: "Two-way GitHub sync failed" }, { status: 500 });
  }
}
