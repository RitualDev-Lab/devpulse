export interface ParsedDeployEvent {
  provider: "github_actions" | "vercel" | "railway" | "fly" | "manual";
  version: string;
  commitSha: string | null;
  branch: string | null;
  deployer: string | null;
  environment: string;
  status: "success" | "failure" | "pending";
  changelogSummary: string | null;
  deploymentUrl: string | null;
}

/**
 * Parses deployment webhook payloads from GitHub Actions, Vercel, Railway, Fly.io, or generic CI.
 */
export function parseProviderDeployWebhook(
  headers: Headers,
  body: any
): ParsedDeployEvent | null {
  const ghEvent = headers.get("x-github-event");

  // 1. GitHub Actions / GitHub Deployment Status
  if (ghEvent === "deployment_status" && body?.deployment_status) {
    const ds = body.deployment_status;
    const dep = body.deployment || {};
    const state = String(ds.state || "success");
    return {
      provider: "github_actions",
      version: dep.ref || `sha-${String(dep.sha || "").slice(0, 7)}` || "v1.0.0",
      commitSha: dep.sha || null,
      branch: dep.ref || null,
      deployer: body.sender?.login || dep.creator?.login || "github-actions",
      environment: ds.environment || dep.environment || "production",
      status: state === "success" ? "success" : state === "pending" ? "pending" : "failure",
      changelogSummary: ds.description || dep.description || null,
      deploymentUrl: ds.target_url || ds.environment_url || null,
    };
  }

  if (ghEvent === "workflow_run" && body?.workflow_run) {
    const wr = body.workflow_run;
    const conclusion = String(wr.conclusion || "success");
    return {
      provider: "github_actions",
      version: `${wr.head_branch || "main"}-${String(wr.head_sha || "").slice(0, 7)}`,
      commitSha: wr.head_sha || null,
      branch: wr.head_branch || null,
      deployer: wr.actor?.login || body.sender?.login || "github-actions",
      environment: "production",
      status:
        wr.status !== "completed"
          ? "pending"
          : conclusion === "success"
          ? "success"
          : "failure",
      changelogSummary: wr.display_title || wr.name || null,
      deploymentUrl: wr.html_url || null,
    };
  }

  // 2. Vercel Deployment Webhook
  if (body?.payload?.deployment || String(body?.type || "").startsWith("deployment.")) {
    const d = body.payload?.deployment || body.deployment || {};
    const meta = d.meta || {};
    const type = String(body.type || "deployment.succeeded");
    return {
      provider: "vercel",
      version:
        meta.githubCommitRef && meta.githubCommitSha
          ? `${meta.githubCommitRef}-${String(meta.githubCommitSha).slice(0, 7)}`
          : d.name || d.id || "vercel-deploy",
      commitSha: meta.githubCommitSha || null,
      branch: meta.githubCommitRef || null,
      deployer: meta.githubCommitAuthorLogin || body.user?.username || "vercel",
      environment: d.target || body.payload?.target || "production",
      status: type.includes("error") || type.includes("canceled") ? "failure" : "success",
      changelogSummary: meta.githubCommitMessage || null,
      deploymentUrl: d.url ? (d.url.startsWith("http") ? d.url : `https://${d.url}`) : null,
    };
  }

  // 3. Railway Webhook
  if (body?.type === "DEPLOY" || body?.deployment?.meta || (body?.project?.id && body?.environment?.name)) {
    const dep = body.deployment || {};
    const meta = dep.meta || {};
    const st = String(body.status || dep.status || "SUCCESS").toUpperCase();
    return {
      provider: "railway",
      version: meta.commitHash ? `sha-${String(meta.commitHash).slice(0, 7)}` : dep.id || "railway-deploy",
      commitSha: meta.commitHash || null,
      branch: meta.branch || "main",
      deployer: meta.commitAuthor || "railway",
      environment: body.environment?.name || "production",
      status: st === "FAILED" || st === "CRASHED" ? "failure" : st === "BUILDING" ? "pending" : "success",
      changelogSummary: meta.commitMessage || null,
      deploymentUrl: dep.url || null,
    };
  }

  // 4. Fly.io Webhook / Generic CI Deploy JSON
  if (body?.version || body?.commitSha || body?.app?.name) {
    const isFly = Boolean(body.app?.name || body.provider === "fly");
    const st = String(body.status || "success").toLowerCase();
    return {
      provider: isFly ? "fly" : (body.provider || "manual"),
      version: String(body.version || `v${body.release?.version || "1.0.0"}`),
      commitSha: body.commitSha || body.sha || null,
      branch: body.branch || "main",
      deployer: body.deployer || body.actor || body.user?.email || "ci-runner",
      environment: body.environment || "production",
      status: st === "failure" || st === "failed" ? "failure" : st === "pending" ? "pending" : "success",
      changelogSummary: body.changelogSummary || body.message || null,
      deploymentUrl: body.deploymentUrl || body.url || null,
    };
  }

  return null;
}
