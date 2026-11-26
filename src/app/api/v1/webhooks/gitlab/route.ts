import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { db } from "@/db";
import { deployments, projectConnectors, projectReleases, projects } from "@/db/schema";
import { and, eq, sql } from "drizzle-orm";
import { recordAuditEvent } from "@/lib/security/audit";

export const dynamic = "force-dynamic";

function timingSafeMatch(expected: string, actual: string): boolean {
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(actual, "utf8");
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

export async function POST(req: NextRequest) {
  try {
    const rawBody = await req.text();
    const gitlabToken = req.headers.get("x-gitlab-token") || "";
    const configuredSecret = process.env.GITLAB_WEBHOOK_SECRET?.trim() || "";

    if (!configuredSecret) {
      return NextResponse.json({ error: "GitLab webhook secret is not configured" }, { status: 503 });
    }
    if (!gitlabToken || !timingSafeMatch(configuredSecret, gitlabToken)) {
      return NextResponse.json({ error: "Invalid X-Gitlab-Token header" }, { status: 401 });
    }

    let payload: any = {};
    try {
      payload = JSON.parse(rawBody);
    } catch {
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }

    const repoSlug = String(payload?.project?.path_with_namespace || "").trim();
    if (!repoSlug) {
      return NextResponse.json({ received: true, ignored: "Missing GitLab project.path_with_namespace" });
    }

    const connMatches = await db
      .select({ projectId: projectConnectors.projectId })
      .from(projectConnectors)
      .where(
        and(
          eq(projectConnectors.category, "git"),
          eq(projectConnectors.provider, "gitlab"),
          sql`lower(${projectConnectors.identifier}) = ${repoSlug.toLowerCase()}`
        )
      );

    const matchedIds = new Set(connMatches.map((m) => m.projectId));
    if (matchedIds.size === 0) {
      return NextResponse.json({ received: true, ignored: "No DevPulse project linked to GitLab repository" });
    }

    const objectKind = String(payload?.object_kind || req.headers.get("x-gitlab-event") || "").toLowerCase();

    for (const projectId of matchedIds) {
      const [proj] = await db.select({ userId: projects.userId }).from(projects).where(eq(projects.id, projectId)).limit(1);
      if (!proj) continue;

      if (objectKind === "release" && payload?.tag) {
        const version = String(payload.tag).slice(0, 64);
        const commitSha = payload?.commit?.id ? String(payload.commit.id).slice(0, 64) : null;
        const message = payload?.name || payload?.description?.slice(0, 200) || null;
        const author = payload?.commit?.author?.name || "gitlab-webhook";

        const [existing] = await db
          .select()
          .from(projectReleases)
          .where(and(eq(projectReleases.projectId, projectId), eq(projectReleases.version, version)))
          .limit(1);

        if (!existing) {
          await db.insert(projectReleases).values({
            id: `rel_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`,
            projectId,
            version,
            commitSha,
            commitAuthor: author,
            commitMessage: message,
            source: "github_release",
            totalSessions: 0,
            crashCount: 0,
            releasedAt: payload?.released_at || new Date().toISOString(),
          });
        }

        await recordAuditEvent({
          userId: proj.userId,
          actorUsername: author,
          projectId,
          action: "gitlab.release.published",
          resourceType: "project_release",
          resourceId: version,
          headers: req.headers,
          metadata: { repoSlug, commitSha },
        });
      } else if (objectKind === "pipeline" && payload?.object_attributes?.status) {
        const rawStatus = String(payload.object_attributes.status).toLowerCase();
        const mappedStatus: "success" | "failure" | "pending" =
          rawStatus === "success" ? "success" : rawStatus === "failed" || rawStatus === "canceled" ? "failure" : "pending";
        const ref = String(payload.object_attributes.ref || "main").slice(0, 64);
        const sha = String(payload.object_attributes.sha || "").slice(0, 40) || null;
        await db.insert(deployments).values({
          id: `dep_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`,
          projectId,
          provider: "gitlab_ci",
          version: sha ? sha.slice(0, 7) : `pipeline-${payload.object_attributes.id || "latest"}`,
          commitSha: sha,
          branch: ref,
          environment: "production",
          status: mappedStatus,
          deploymentUrl: payload?.project?.web_url || null,
          deployedAt: new Date().toISOString(),
        });
      } else if (objectKind === "push") {
        await recordAuditEvent({
          userId: proj.userId,
          actorUsername: payload?.user_username || "gitlab-push",
          projectId,
          action: "gitlab.push",
          resourceType: "repository",
          resourceId: repoSlug,
          headers: req.headers,
          metadata: { after: payload?.after, ref: payload?.ref },
        });
      }
    }

    return NextResponse.json({ received: true, provider: "gitlab", objectKind });
  } catch (err) {
    console.error("GitLab webhook error:", err);
    return NextResponse.json({ error: "GitLab webhook processing failed" }, { status: 500 });
  }
}
