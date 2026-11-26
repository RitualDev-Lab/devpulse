import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { db } from "@/db";
import { deployments, projectConnectors, projectReleases, projects } from "@/db/schema";
import { and, eq, inArray, sql } from "drizzle-orm";
import { verifyGitHubSignature } from "@/lib/security/github-webhook";
import { recordAuditEvent } from "@/lib/security/audit";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const rawBody = await req.text();
    const giteaEvent = req.headers.get("x-gitea-event") || req.headers.get("x-forgejo-event");
    const bitbucketEvent = req.headers.get("x-event-key");
    const sig = req.headers.get("x-gitea-signature") || req.headers.get("x-hub-signature-256");
    const secret = process.env.GIT_WEBHOOK_SECRET?.trim() || process.env.GITHUB_WEBHOOK_SECRET?.trim() || "";

    if (!secret) {
      return NextResponse.json({ error: "Git webhook secret is not configured" }, { status: 503 });
    }

    if (sig) {
      const normalized = sig.startsWith("sha256=") ? sig : `sha256=${sig}`;
      if (!(await verifyGitHubSignature(rawBody, normalized, secret))) {
        return NextResponse.json({ error: "Invalid webhook signature" }, { status: 401 });
      }
    } else {
      const bearerToken = req.headers.get("x-webhook-token") || "";
      if (!bearerToken || bearerToken.length !== secret.length || !crypto.timingSafeEqual(Buffer.from(bearerToken), Buffer.from(secret))) {
        return NextResponse.json({ error: "Missing or invalid webhook authentication" }, { status: 401 });
      }
    }

    let payload: any = {};
    try {
      payload = JSON.parse(rawBody);
    } catch {
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }

    const provider = bitbucketEvent ? "bitbucket" : "gitea";
    const repoSlug = String(payload?.repository?.full_name || "").trim();
    if (!repoSlug) {
      return NextResponse.json({ received: true, ignored: "Missing repository.full_name" });
    }

    const matches = await db
      .select({ projectId: projectConnectors.projectId })
      .from(projectConnectors)
      .where(
        and(
          eq(projectConnectors.category, "git"),
          inArray(projectConnectors.provider, [provider, "codeberg", "forgejo"]),
          sql`lower(${projectConnectors.identifier}) = ${repoSlug.toLowerCase()}`
        )
      );

    if (matches.length === 0) {
      return NextResponse.json({ received: true, ignored: "No matching DevPulse project connector" });
    }

    for (const m of matches) {
      const [proj] = await db.select({ userId: projects.userId }).from(projects).where(eq(projects.id, m.projectId)).limit(1);
      if (!proj) continue;

      if (giteaEvent === "release" && payload?.release?.tag_name) {
        const version = String(payload.release.tag_name).slice(0, 64);
        await db.insert(projectReleases).values({
          id: `rel_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`,
          projectId: m.projectId,
          version,
          commitSha: payload.release.target_commitish ? String(payload.release.target_commitish).slice(0, 64) : null,
          commitAuthor: payload.release.author?.login || "gitea-release",
          commitMessage: payload.release.name || null,
          source: "github_release",
          totalSessions: 0,
          crashCount: 0,
          releasedAt: payload.release.published_at || new Date().toISOString(),
        }).onConflictDoNothing();
      } else if (bitbucketEvent?.startsWith("repo:commit_status")) {
        const rawState = String(payload?.commit_status?.state || "INPROGRESS").toUpperCase();
        const mappedStatus: "success" | "failure" | "pending" =
          rawState === "SUCCESSFUL" ? "success" : rawState === "FAILED" || rawState === "STOPPED" ? "failure" : "pending";
        const sha = payload?.commit_status?.commit?.hash ? String(payload.commit_status.commit.hash).slice(0, 40) : null;
        await db.insert(deployments).values({
          id: `dep_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`,
          projectId: m.projectId,
          provider: "bitbucket_pipelines",
          version: sha ? sha.slice(0, 7) : "pipeline",
          commitSha: sha,
          environment: "production",
          status: mappedStatus,
          deploymentUrl: payload?.commit_status?.url || null,
          deployedAt: new Date().toISOString(),
        });
      }

      await recordAuditEvent({
        userId: proj.userId,
        actorUsername: `${provider}-webhook`,
        projectId: m.projectId,
        action: `${provider}.webhook.${giteaEvent || bitbucketEvent || "event"}`,
        resourceType: "repository",
        resourceId: repoSlug,
        headers: req.headers,
      });
    }

    return NextResponse.json({ received: true, provider });
  } catch (err) {
    console.error("Unified Git webhook error:", err);
    return NextResponse.json({ error: "Git webhook processing failed" }, { status: 500 });
  }
}
