import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { projects, projectReleases } from "@/db/schema";
import { eq, and, sql } from "drizzle-orm";
import { recordAuditEvent } from "@/lib/security/audit";

export const dynamic = "force-dynamic";

async function verifyGitHubSignature(rawBody: string, sigHeader: string | null): Promise<boolean> {
  const secret = process.env.GITHUB_WEBHOOK_SECRET?.trim();
  if (!secret) return true; // Optional secret: when unset, strictly scopes only to matched projects
  if (!sigHeader || !sigHeader.startsWith("sha256=")) return false;

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const digest = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawBody));
  const expected =
    "sha256=" +
    Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");

  return expected === sigHeader;
}

export async function POST(req: NextRequest) {
  try {
    const rawBody = await req.text();
    const ghEvent = req.headers.get("x-github-event") || "ping";
    const ghSig = req.headers.get("x-hub-signature-256");

    if (!(await verifyGitHubSignature(rawBody, ghSig))) {
      return NextResponse.json({ error: "Invalid GitHub webhook signature" }, { status: 401 });
    }

    if (ghEvent === "ping") {
      return NextResponse.json({ received: true, event: "ping" });
    }

    let payload: any = {};
    try {
      payload = JSON.parse(rawBody);
    } catch {
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }

    const repoFullName: string | undefined = payload?.repository?.full_name;
    if (!repoFullName) {
      return NextResponse.json({ received: true, ignored: "Missing repository" });
    }

    const matchedProjects = await db
      .select()
      .from(projects)
      .where(sql`lower(${projects.githubRepo}) = ${repoFullName.toLowerCase()}`);

    if (matchedProjects.length === 0) {
      return NextResponse.json({ received: true, ignored: "No DevPulse project linked to repo" });
    }

    for (const proj of matchedProjects) {
      if (ghEvent === "release" && payload.release?.tag_name) {
        const version = String(payload.release.tag_name).slice(0, 64);
        const commitSha = payload.release.target_commitish
          ? String(payload.release.target_commitish).slice(0, 64)
          : null;
        const author = payload.release.author?.login || payload.sender?.login || null;
        const message = payload.release.name || payload.release.body?.slice(0, 200) || null;

        const [existing] = await db
          .select()
          .from(projectReleases)
          .where(and(eq(projectReleases.projectId, proj.id), eq(projectReleases.version, version)))
          .limit(1);

        if (!existing) {
          await db.insert(projectReleases).values({
            id: `rel_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`,
            projectId: proj.id,
            version,
            commitSha,
            commitAuthor: author,
            commitMessage: message,
            source: "github_release",
            totalSessions: 0,
            crashCount: 0,
            releasedAt: payload.release.published_at || new Date().toISOString(),
          });
        } else {
          await db
            .update(projectReleases)
            .set({
              commitSha: commitSha || existing.commitSha,
              commitAuthor: author || existing.commitAuthor,
              commitMessage: message || existing.commitMessage,
              source: "github_release",
            })
            .where(eq(projectReleases.id, existing.id));
        }

        await recordAuditEvent({
          userId: proj.userId,
          actorUsername: author || "github-webhook",
          projectId: proj.id,
          action: "release.published",
          resourceType: "project_release",
          resourceId: version,
          headers: req.headers,
          metadata: { commitSha, repo: repoFullName },
        });
      } else if (ghEvent === "push" && payload.head_commit?.id) {
        const ref = String(payload.ref || "");
        const branch = ref.replace(/^refs\/heads\//, "").replace(/^refs\/tags\//, "");
        const sha = String(payload.head_commit.id);
        const version = ref.startsWith("refs/tags/") ? branch : `sha-${sha.slice(0, 7)}`;
        const author =
          payload.head_commit.author?.username ||
          payload.head_commit.author?.name ||
          payload.pusher?.name ||
          null;
        const message = String(payload.head_commit.message || "").split("\n")[0].slice(0, 200);

        const [existing] = await db
          .select()
          .from(projectReleases)
          .where(and(eq(projectReleases.projectId, proj.id), eq(projectReleases.version, version)))
          .limit(1);

        if (!existing) {
          await db.insert(projectReleases).values({
            id: `rel_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`,
            projectId: proj.id,
            version,
            commitSha: sha,
            commitAuthor: author,
            commitMessage: message,
            branch,
            source: "github_push",
            totalSessions: 0,
            crashCount: 0,
            releasedAt: payload.head_commit.timestamp || new Date().toISOString(),
          });
        }
      }
    }

    return NextResponse.json({
      received: true,
      event: ghEvent,
      repo: repoFullName,
      projectsUpdated: matchedProjects.length,
    });
  } catch (err: any) {
    console.error("POST /api/v1/webhooks/github error:", err);
    return NextResponse.json({ error: "GitHub webhook failed" }, { status: 500 });
  }
}
