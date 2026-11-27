/**
 * Separates formal GitHub Releases & Tag pushes from ordinary branch commits & deployments
 * so synthetic `sha-...` commits never pollute `project_releases` metrics.
 */

export type ClassifiedGitHubWebhook =
  | {
      kind: "formal_release";
      version: string;
      commitSha: string | null;
      author: string | null;
      message: string | null;
      releasedAt: string;
    }
  | {
      kind: "tag_release";
      version: string;
      commitSha: string;
      author: string | null;
      message: string;
      tagName: string;
      releasedAt: string;
    }
  | {
      kind: "branch_commit";
      branch: string;
      commitSha: string;
      author: string | null;
      message: string;
      committedAt: string;
    }
  | {
      kind: "deployment_status";
      environment: string;
      status: "success" | "failure" | "pending";
      commitSha: string | null;
      version: string;
      deployer: string | null;
      deploymentUrl: string | null;
    }
  | { kind: "other" };

export function classifyGitHubWebhookEvent(
  ghEvent: string,
  payload: any
): ClassifiedGitHubWebhook {
  if (ghEvent === "release" && payload?.release?.tag_name) {
    return {
      kind: "formal_release",
      version: String(payload.release.tag_name).slice(0, 64),
      commitSha: payload.release.target_commitish
        ? String(payload.release.target_commitish).slice(0, 64)
        : null,
      author: payload.release.author?.login || payload.sender?.login || null,
      message: payload.release.name || payload.release.body?.slice(0, 200) || null,
      releasedAt: payload.release.published_at || new Date().toISOString(),
    };
  }

  if (ghEvent === "push" && payload?.head_commit?.id) {
    const ref = String(payload.ref || "");
    const sha = String(payload.head_commit.id);
    const author =
      payload.head_commit.author?.username ||
      payload.head_commit.author?.name ||
      payload.pusher?.name ||
      null;
    const message = String(payload.head_commit.message || "").split("\n")[0].slice(0, 200);
    const timestamp = payload.head_commit.timestamp || new Date().toISOString();

    if (ref.startsWith("refs/tags/")) {
      const tagName = ref.replace(/^refs\/tags\//, "").slice(0, 64);
      return {
        kind: "tag_release",
        version: tagName,
        tagName,
        commitSha: sha,
        author,
        message,
        releasedAt: timestamp,
      };
    }

    const branch = ref.replace(/^refs\/heads\//, "").slice(0, 120) || "main";
    return {
      kind: "branch_commit",
      branch,
      commitSha: sha,
      author,
      message,
      committedAt: timestamp,
    };
  }

  if (ghEvent === "deployment_status" && payload?.deployment_status) {
    const rawState = String(payload.deployment_status.state || "").toLowerCase();
    const status =
      rawState === "success" ? "success" : rawState === "failure" || rawState === "error" ? "failure" : "pending";
    return {
      kind: "deployment_status",
      environment: String(payload.deployment_status.environment || payload.deployment?.environment || "production").slice(0, 48),
      status,
      commitSha: payload.deployment?.sha ? String(payload.deployment.sha).slice(0, 64) : null,
      version: String(payload.deployment?.ref || payload.deployment?.sha?.slice(0, 7) || "deploy").slice(0, 64),
      deployer: payload.deployment_status.creator?.login || payload.sender?.login || null,
      deploymentUrl: payload.deployment_status.target_url || null,
    };
  }

  return { kind: "other" };
}
