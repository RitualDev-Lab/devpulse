import { db } from "@/db";
import { alertRules, errorEvents, projects } from "@/db/schema";
import { and, eq, isNotNull } from "drizzle-orm";
import { decryptSecret } from "@/lib/security/crypto";
import { getUserGitHubAccessToken } from "@/lib/security/github-ownership";
import { recordAuditEvent } from "@/lib/security/audit";

function ruleWantsGitHubAutoIssue(channelsJson: string | null): boolean {
  if (!channelsJson) return false;
  try {
    const parsed = JSON.parse(channelsJson);
    if (Array.isArray(parsed)) {
      return parsed.some((c) => String(c).toLowerCase() === "github_issue");
    }
  } catch {
    // ignore malformed json
  }
  return false;
}

/**
 * Rule-Triggered & Regression GitHub Auto-Issue Escalation.
 * Fires when an enabled alert rule includes `"github_issue"` or when an already-seen crash group
 * regresses / crosses a major occurrence milestone (>= 10) without an open linked issue.
 */
export async function maybeAutoEscalateGitHubIssue(params: {
  project: { id: string; userId: string; name: string; slug: string; organizationId?: string | null; workspaceId?: string | null };
  eventId: string;
  fingerprint: string;
  occurrenceCount: number;
  isRegression: boolean;
  errorName: string;
  message: string;
  stackPreview: string | null;
  runtime: string;
  version: string | null;
  environment: string;
  routePath?: string | null;
  r2ObjectKey?: string | null;
}): Promise<{ created: boolean; issueNumber?: number; issueUrl?: string }> {
  const [project] = await db
    .select({
      id: projects.id,
      userId: projects.userId,
      name: projects.name,
      slug: projects.slug,
      organizationId: projects.organizationId,
      workspaceId: projects.workspaceId,
      githubRepo: projects.githubRepo,
      githubTokenEncrypted: projects.githubTokenEncrypted,
    })
    .from(projects)
    .where(eq(projects.id, params.project.id))
    .limit(1);

  if (!project || !project.githubRepo || !project.githubRepo.includes("/")) {
    return { created: false };
  }

  // Avoid duplicate GitHub issues for the same fingerprint group
  const [alreadyLinked] = await db
    .select({
      id: errorEvents.id,
      githubIssueNumber: errorEvents.githubIssueNumber,
      githubIssueUrl: errorEvents.githubIssueUrl,
    })
    .from(errorEvents)
    .where(
      and(
        eq(errorEvents.projectId, project.id),
        eq(errorEvents.fingerprint, params.fingerprint),
        isNotNull(errorEvents.githubIssueNumber)
      )
    )
    .limit(1);

  if (alreadyLinked?.githubIssueNumber) {
    return {
      created: false,
      issueNumber: alreadyLinked.githubIssueNumber,
      issueUrl: alreadyLinked.githubIssueUrl || undefined,
    };
  }

  const rules = await db
    .select({
      id: alertRules.id,
      isEnabled: alertRules.isEnabled,
      channelsJson: alertRules.channelsJson,
    })
    .from(alertRules)
    .where(and(eq(alertRules.projectId, project.id), eq(alertRules.isEnabled, true)));

  const hasAutoIssueRule = rules.some((r) => ruleWantsGitHubAutoIssue(r.channelsJson));
  const shouldEscalate =
    hasAutoIssueRule && (params.isRegression || params.occurrenceCount === 1 || params.occurrenceCount >= 10);

  if (!shouldEscalate) {
    return { created: false };
  }

  const token =
    (await decryptSecret(project.githubTokenEncrypted).catch(() => null)) ||
    (await getUserGitHubAccessToken(project.userId).catch(() => null));

  if (!token) {
    return { created: false };
  }

  const title = `[DevPulse Auto-Issue] ${params.errorName}: ${params.message.slice(0, 72)}`;
  const body = [
    `### Automated Crash Escalation`,
    `- **Project:** ${project.name} (\`${project.slug}\`)`,
    `- **Error:** \`${params.errorName}\``,
    `- **Runtime / Env:** \`${params.runtime}\` / \`${params.environment}\``,
    `- **Release:** \`${params.version || "N/A"}\``,
    `- **Occurrences:** ${params.occurrenceCount}`,
    params.routePath ? `- **Route:** \`${params.routePath}\`` : null,
    params.isRegression ? `- **Regression:** Re-appeared after resolution` : null,
    params.r2ObjectKey ? `- **Full R2 Stack Dump Key:** \`${params.r2ObjectKey}\`` : null,
    "",
    `### Message`,
    "```",
    params.message,
    "```",
    params.stackPreview
      ? `\n### Stack Trace Preview\n\`\`\`\n${params.stackPreview.slice(0, 2000)}\n\`\`\``
      : null,
    `\n[Inspect Full Trace & AI Root Cause in DevPulse](https://devpulse.ritualdev.in/dashboard/crashes?project=${encodeURIComponent(project.slug)})`,
  ]
    .filter(Boolean)
    .join("\n");

  const ghRes = await fetch(`https://api.github.com/repos/${project.githubRepo}/issues`, {
    method: "POST",
    headers: {
      Accept: "application/vnd.github.v3+json",
      "User-Agent": "DevPulse-RitualDev",
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      title,
      body,
      labels: params.isRegression ? ["bug", "regression", "devpulse"] : ["bug", "devpulse"],
    }),
  });

  if (!ghRes.ok) {
    return { created: false };
  }

  const ghData = (await ghRes.json()) as { number?: number; html_url?: string };
  if (!ghData.number) {
    return { created: false };
  }

  await db
    .update(errorEvents)
    .set({
      githubIssueNumber: ghData.number,
      githubIssueUrl: ghData.html_url || null,
    })
    .where(and(eq(errorEvents.projectId, project.id), eq(errorEvents.fingerprint, params.fingerprint)))
    .catch(() => {});

  await recordAuditEvent({
    userId: project.userId,
    actorUsername: "github-auto-escalation",
    organizationId: project.organizationId,
    workspaceId: project.workspaceId,
    projectId: project.id,
    action: "crash.github_auto_issue_created",
    resourceType: "github_issue",
    resourceId: String(ghData.number),
    metadata: {
      fingerprint: params.fingerprint,
      occurrenceCount: params.occurrenceCount,
      issueUrl: ghData.html_url,
    },
  });

  return {
    created: true,
    issueNumber: ghData.number,
    issueUrl: ghData.html_url,
  };
}
