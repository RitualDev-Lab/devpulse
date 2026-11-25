import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { featureRequests, featureVotes, projects, deployments } from "@/db/schema";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import {
  checkRateLimit,
  getClientIp,
  verifyTurnstileToken,
} from "@/lib/security/rate-limit";
import { getCurrentUser } from "@/lib/auth";
import { resolveProjectAccess } from "@/lib/security/rbac";
import { recordAuditEvent } from "@/lib/security/audit";

export const dynamic = "force-dynamic";

async function computeVoterHash(req: NextRequest): Promise<string> {
  const ip = getClientIp(req.headers);
  const ua = req.headers.get("user-agent") || "unknown";
  const digest = await globalThis.crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`${ip}|${ua.slice(0, 120)}`)
  );
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 32);
}

/**
 * GET /api/v1/feedback?projectSlug=... | ?projectId=...
 * Publicly lists feature requests ordered by voteCount + linked release versions.
 */
export async function GET(req: NextRequest) {
  try {
    const projectSlug = req.nextUrl.searchParams.get("projectSlug")?.trim();
    const projectIdInput = req.nextUrl.searchParams.get("projectId")?.trim();

    if (!projectSlug && !projectIdInput) {
      return NextResponse.json({ error: "Missing projectSlug or projectId" }, { status: 400 });
    }

    const [project] = await db
      .select({ id: projects.id, name: projects.name, slug: projects.slug })
      .from(projects)
      .where(projectIdInput ? eq(projects.id, projectIdInput) : eq(projects.slug, projectSlug!))
      .limit(1);

    if (!project) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    const voterHash = await computeVoterHash(req);

    const [items, releaseList] = await Promise.all([
      db
        .select()
        .from(featureRequests)
        .where(eq(featureRequests.projectId, project.id))
        .orderBy(desc(featureRequests.voteCount), desc(featureRequests.createdAt))
        .limit(100),
      db
        .select({ version: deployments.version, createdAt: deployments.deployedAt })
        .from(deployments)
        .where(eq(deployments.projectId, project.id))
        .orderBy(desc(deployments.deployedAt))
        .limit(15),
    ]);

    let votedIds = new Set<string>();
    if (items.length > 0) {
      const myVotes = await db
        .select({ featureId: featureVotes.featureId })
        .from(featureVotes)
        .where(
          and(
            inArray(
              featureVotes.featureId,
              items.map((i) => i.id)
            ),
            eq(featureVotes.voterHash, voterHash)
          )
        );
      votedIds = new Set(myVotes.map((v) => v.featureId));
    }

    return NextResponse.json({
      project,
      releases: releaseList.map((r) => r.version),
      items: items.map((item) => ({
        ...item,
        viewerVoted: votedIds.has(item.id),
      })),
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: "Failed to load feature requests", details: err?.message },
      { status: 500 }
    );
  }
}

/**
 * POST /api/v1/feedback
 *  - action === "upvote": toggles deduplicated upvote by IP/UA hash
 *  - default ("create"): submits a new public feature request tied optionally to a target release
 */
export async function POST(req: NextRequest) {
  try {
    const clientIp = getClientIp(req.headers);
    const rl = await checkRateLimit({
      key: `feedback:${clientIp}`,
      limit: 30,
      windowSeconds: 300,
    });
    if (!rl.allowed) {
      return NextResponse.json(
        { error: "Rate limit exceeded. Please wait before submitting again." },
        { status: 429 }
      );
    }

    let body: any = {};
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const voterHash = await computeVoterHash(req);
    const action = String(body.action || "create");

    if (action === "upvote") {
      const featureId = String(body.featureId || "").trim();
      if (!featureId) {
        return NextResponse.json({ error: "Missing featureId" }, { status: 400 });
      }

      const [feat] = await db
        .select()
        .from(featureRequests)
        .where(eq(featureRequests.id, featureId))
        .limit(1);

      if (!feat) {
        return NextResponse.json({ error: "Feature request not found" }, { status: 404 });
      }

      const [existingVote] = await db
        .select()
        .from(featureVotes)
        .where(and(eq(featureVotes.featureId, featureId), eq(featureVotes.voterHash, voterHash)))
        .limit(1);

      let voted = true;
      let nextCount = feat.voteCount;

      if (existingVote) {
        await db.delete(featureVotes).where(eq(featureVotes.id, existingVote.id));
        nextCount = Math.max(0, feat.voteCount - 1);
        await db
          .update(featureRequests)
          .set({ voteCount: sql`max(0, ${featureRequests.voteCount} - 1)` })
          .where(eq(featureRequests.id, featureId));
        voted = false;
      } else {
        await db.insert(featureVotes).values({
          id: `fv_${crypto.randomUUID().replace(/-/g, "").slice(0, 14)}`,
          featureId,
          voterHash,
        });
        nextCount = feat.voteCount + 1;
        await db
          .update(featureRequests)
          .set({ voteCount: sql`${featureRequests.voteCount} + 1` })
          .where(eq(featureRequests.id, featureId));
        voted = true;
      }

      return NextResponse.json({ success: true, featureId, voted, voteCount: nextCount });
    }

    // Create new feature request
    const turnstileOk = await verifyTurnstileToken(body.turnstileToken, clientIp);
    if (!turnstileOk.ok) {
      return NextResponse.json(
        { error: turnstileOk.error || "CAPTCHA verification failed" },
        { status: 403 }
      );
    }

    const projectSlug = String(body.projectSlug || "").trim();
    const projectIdInput = String(body.projectId || "").trim();
    const title = String(body.title || "").trim().slice(0, 140);
    const description = String(body.description || "").trim().slice(0, 2000);
    const categoryRaw = String(body.category || "feature").toLowerCase();
    const category = (["feature", "improvement", "integration", "sdk"].includes(categoryRaw)
      ? categoryRaw
      : "feature") as "feature" | "improvement" | "integration" | "sdk";
    const targetVersion = body.targetVersion ? String(body.targetVersion).trim().slice(0, 40) : null;
    const authorName = body.authorName ? String(body.authorName).trim().slice(0, 80) : null;
    const authorEmail = body.authorEmail ? String(body.authorEmail).trim().slice(0, 160) : null;

    if (!title || title.length < 3 || !description || description.length < 5) {
      return NextResponse.json(
        { error: "Title (>= 3 chars) and description (>= 5 chars) are required." },
        { status: 400 }
      );
    }

    const [project] = await db
      .select({ id: projects.id, name: projects.name, slug: projects.slug })
      .from(projects)
      .where(projectIdInput ? eq(projects.id, projectIdInput) : eq(projects.slug, projectSlug))
      .limit(1);

    if (!project) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    const featureId = `feat_${crypto.randomUUID().replace(/-/g, "").slice(0, 14)}`;
    await db.insert(featureRequests).values({
      id: featureId,
      projectId: project.id,
      title,
      description,
      category,
      status: "open",
      targetVersion,
      voteCount: 1,
      authorName,
      authorEmail,
    });

    await db.insert(featureVotes).values({
      id: `fv_${crypto.randomUUID().replace(/-/g, "").slice(0, 14)}`,
      featureId,
      voterHash,
    });

    return NextResponse.json(
      {
        success: true,
        item: {
          id: featureId,
          projectId: project.id,
          title,
          description,
          category,
          status: "open",
          targetVersion,
          voteCount: 1,
          authorName,
          viewerVoted: true,
          createdAt: new Date().toISOString(),
        },
      },
      { status: 201 }
    );
  } catch (err: any) {
    return NextResponse.json(
      { error: "Failed to submit feedback", details: err?.message },
      { status: 500 }
    );
  }
}

/**
 * PATCH /api/v1/feedback
 * Authenticated maintainer triage: update roadmap status or target release version.
 */
export async function PATCH(req: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await req.json();
    const projectId = String(body.projectId || "");
    const featureId = String(body.featureId || "");
    const status = String(body.status || "");
    const targetVersion = body.targetVersion !== undefined ? String(body.targetVersion || "").trim() || null : undefined;

    if (!projectId || !featureId) {
      return NextResponse.json({ error: "Missing projectId or featureId" }, { status: 400 });
    }

    const access = await resolveProjectAccess(projectId, user);
    if (!access || !access.canWrite) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const validStatuses = ["open", "planned", "in_progress", "shipped"];
    const updates: Partial<typeof featureRequests.$inferInsert> = {};
    if (status && validStatuses.includes(status)) {
      updates.status = status as "open" | "planned" | "in_progress" | "shipped";
    }
    if (targetVersion !== undefined) {
      updates.targetVersion = targetVersion;
    }

    await db
      .update(featureRequests)
      .set(updates)
      .where(and(eq(featureRequests.id, featureId), eq(featureRequests.projectId, projectId)));

    await recordAuditEvent({
      userId: user.id,
      actorUsername: user.githubUsername,
      organizationId: access.project.organizationId,
      workspaceId: access.project.workspaceId,
      projectId,
      action: "feedback.triaged",
      resourceType: "feature_request",
      resourceId: featureId,
      headers: req.headers,
      metadata: updates,
    });

    return NextResponse.json({ success: true });
  } catch (err: any) {
    return NextResponse.json(
      { error: "Failed to update feature request", details: err?.message },
      { status: 500 }
    );
  }
}
