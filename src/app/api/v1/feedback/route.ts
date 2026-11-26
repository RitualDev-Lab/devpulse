import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { featureRequests, featureVotes, projects, deployments, statusSubscribers } from "@/db/schema";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import {
  checkRateLimit,
  getClientIp,
  verifyTurnstileToken,
} from "@/lib/security/rate-limit";
import { getCurrentUser } from "@/lib/auth";
import { resolveProjectAccess } from "@/lib/security/rbac";
import { recordAuditEvent } from "@/lib/security/audit";
import { apiError } from "@/lib/security/api-error";
import { verifyTelemetryApiKey } from "@/lib/security/api-keys";
import { resolveDecryptedWebhookConfig, dispatchCrashAlerts } from "@/lib/alerts/webhook";
import { sendTransactionalEmail } from "@/lib/alerts/email";
import { decryptSecret } from "@/lib/security/crypto";
import { PUBLIC_APP_URL } from "@/lib/config/app-url";

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
    let projectIdInput = req.nextUrl.searchParams.get("projectId")?.trim();
    const apiKey = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim();
    if (apiKey) {
      const verified = await verifyTelemetryApiKey(apiKey);
      if (!verified) return NextResponse.json({ error: "Invalid API key" }, { status: 401 });
      projectIdInput = verified.id;
    }

    if (!projectSlug && !projectIdInput) {
      return NextResponse.json({ error: "Missing projectSlug or projectId" }, { status: 400 });
    }

    const [project] = await db
      .select({ id: projects.id, name: projects.name, slug: projects.slug, isPublic: projects.isPublic })
      .from(projects)
      .where(projectIdInput ? eq(projects.id, projectIdInput) : eq(projects.slug, projectSlug!))
      .limit(1);

    if (!project) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }
    if (!project.isPublic && !apiKey) {
      const user = await getCurrentUser();
      if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      const access = await resolveProjectAccess(project.id, user);
      if (!access) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
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
        .select({ version: deployments.version, createdAt: deployments.deployedAt, url: deployments.deploymentUrl })
        .from(deployments)
        .where(and(eq(deployments.projectId, project.id), eq(deployments.status, "success")))
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
      project: { id: project.id, name: project.name, slug: project.slug },
      releases: releaseList.map((r) => ({ version: r.version, url: r.url })),
      items: items.map((item) => ({
        ...item,
        viewerVoted: votedIds.has(item.id),
      })),
    });
  } catch (err) {
    return apiError(err, "Failed to load feature requests", 500);
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

    let body: Record<string, unknown> = {};
    try {
      const parsed: unknown = await req.json();
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
      }
      body = parsed as Record<string, unknown>;
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
      const [featureProject] = await db
        .select({ id: projects.id, isPublic: projects.isPublic })
        .from(projects)
        .where(eq(projects.id, feat.projectId))
        .limit(1);
      if (!featureProject?.isPublic) {
        const user = await getCurrentUser();
        if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        const access = await resolveProjectAccess(feat.projectId, user);
        if (!access) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
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
    const turnstileOk = await verifyTurnstileToken(typeof body.turnstileToken === "string" ? body.turnstileToken : undefined, clientIp);
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
      .select({ id: projects.id, name: projects.name, slug: projects.slug, isPublic: projects.isPublic })
      .from(projects)
      .where(projectIdInput ? eq(projects.id, projectIdInput) : eq(projects.slug, projectSlug))
      .limit(1);

    if (!project) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }
    if (!project.isPublic) {
      const user = await getCurrentUser();
      if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      const access = await resolveProjectAccess(project.id, user);
      if (!access?.canWrite) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
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
  } catch (err) {
    return apiError(err, "Failed to submit feedback", 500);
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
    const releaseUrl = body.releaseUrl !== undefined ? String(body.releaseUrl || "").trim() || null : undefined;
    if (releaseUrl !== undefined && releaseUrl !== null) {
      try {
        const url = new URL(releaseUrl);
        if (url.protocol !== "https:" || url.username || url.password) throw new Error("invalid");
      } catch {
        return NextResponse.json({ error: "releaseUrl must be a valid HTTPS URL" }, { status: 400 });
      }
    }

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
      updates.targetVersion = targetVersion?.slice(0, 64) || null;
    }
    if (releaseUrl !== undefined) {
      updates.releaseUrl = releaseUrl?.slice(0, 2048) || null;
    }

    if (Object.keys(updates).length === 0) return NextResponse.json({ error: "No valid feedback updates provided" }, { status: 400 });

    const [existingFeature] = await db
      .select()
      .from(featureRequests)
      .where(and(eq(featureRequests.id, featureId), eq(featureRequests.projectId, projectId)))
      .limit(1);

    if (!existingFeature) {
      return NextResponse.json({ error: "Feature request not found" }, { status: 404 });
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

    const justShipped = existingFeature.status !== "shipped" && updates.status === "shipped";
    if (justShipped) {
      try {
        const [projRow] = await db
          .select()
          .from(projects)
          .where(eq(projects.id, projectId))
          .limit(1);

        if (projRow) {
          const shippedVersion = updates.targetVersion ?? existingFeature.targetVersion ?? "latest";
          const shippedReleaseUrl =
            updates.releaseUrl ??
            existingFeature.releaseUrl ??
            `${PUBLIC_APP_URL}/report/${encodeURIComponent(projRow.slug)}`;

          const webhookCfg = await resolveDecryptedWebhookConfig(projRow).catch(() => null);
          if (webhookCfg) {
            await dispatchCrashAlerts(webhookCfg, {
              projectName: projRow.name,
              projectSlug: projRow.slug,
              errorName: "FeatureShipped",
              message: `Shipped "${existingFeature.title}" (${shippedVersion}) — ${shippedReleaseUrl}`,
              runtime: "roadmap",
              version: shippedVersion,
              dashboardUrl: shippedReleaseUrl,
            }).catch(() => {});
          }

          const subscribers = await db
            .select({ email: statusSubscribers.email })
            .from(statusSubscribers)
            .where(and(eq(statusSubscribers.projectId, projectId), eq(statusSubscribers.isActive, true)))
            .limit(20)
            .catch(() => []);

          const recipients = new Set<string>();
          if (existingFeature.authorEmail) recipients.add(existingFeature.authorEmail.trim().toLowerCase());
          if (projRow.notificationEmail) recipients.add(projRow.notificationEmail.trim().toLowerCase());
          for (const sub of subscribers) {
            if (sub.email) recipients.add(sub.email.trim().toLowerCase());
          }

          if (recipients.size > 0) {
            const emailApiKey = projRow.emailApiKeyEncrypted
              ? await decryptSecret(projRow.emailApiKeyEncrypted).catch(() => null)
              : null;
            const subject = `[${projRow.name}] Shipped: ${existingFeature.title}`;
            const text = `${existingFeature.title} has shipped${shippedVersion ? ` in ${shippedVersion}` : ""}. Details: ${shippedReleaseUrl}`;
            const html = `<p><strong>${projRow.name}</strong> shipped a requested feature:</p><p><strong>${existingFeature.title}</strong> (${shippedVersion})</p><p><a href="${shippedReleaseUrl}">View release &amp; feedback portal</a></p>`;

            await Promise.allSettled(
              Array.from(recipients)
                .slice(0, 25)
                .map((to) =>
                  sendTransactionalEmail({
                    to,
                    subject,
                    text,
                    html,
                    provider: (projRow.emailProvider as any) || undefined,
                    apiKey: emailApiKey || undefined,
                  })
                )
            );
          }
        }
      } catch {
        // Non-blocking shipped notification dispatch
      }
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    return apiError(err, "Failed to update feature request", 500);
  }
}
