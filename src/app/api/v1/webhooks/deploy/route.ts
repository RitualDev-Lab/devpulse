import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { deployments, projectReleases } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { verifyTelemetryApiKey } from "@/lib/security/api-keys";
import { recordAuditEvent } from "@/lib/security/audit";
import { parseProviderDeployWebhook } from "@/lib/deployments/webhook-parser";
import { scrubTelemetryText, scrubTelemetryValue } from "@/lib/security/ingest-scrub";

export const dynamic = "force-dynamic";

/**
 * POST /api/v1/webhooks/deploy
 * Unified deployment tracker webhook for GitHub Actions, Vercel, Railway, and Fly.io.
 */
export async function POST(req: NextRequest) {
  try {
    const rawKey =
      req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ||
      req.headers.get("x-devpulse-key") ||
      "";

    if (!rawKey.trim()) {
      return NextResponse.json(
        { error: "Missing telemetry API key (Authorization: Bearer <key> or X-DevPulse-Key)" },
        { status: 401 }
      );
    }

    const project = await verifyTelemetryApiKey(rawKey);
    if (!project) {
      return NextResponse.json({ error: "Invalid or revoked API key" }, { status: 403 });
    }

    const body = await req.json();
    const parsed = parseProviderDeployWebhook(req.headers, body);
    if (!parsed) {
      return NextResponse.json({ ignored: true, reason: "Unrecognized deploy event payload" });
    }

    const depId = `dep_${crypto.randomUUID().replace(/-/g, "").slice(0, 14)}`;
    await db.insert(deployments).values({
      id: depId,
      projectId: project.id,
      provider: parsed.provider,
      version: parsed.version,
      commitSha: parsed.commitSha,
      branch: parsed.branch,
      deployer: parsed.deployer == null ? null : scrubTelemetryText(String(parsed.deployer)),
      environment: parsed.environment,
      status: parsed.status,
      changelogSummary: parsed.changelogSummary == null ? null : scrubTelemetryText(String(parsed.changelogSummary)),
      deploymentUrl: parsed.deploymentUrl,
      totalSessions: 0,
      crashCount: 0,
    });

    const [existingRel] = await db
      .select({ id: projectReleases.id })
      .from(projectReleases)
      .where(
        and(
          eq(projectReleases.projectId, project.id),
          eq(projectReleases.version, parsed.version)
        )
      )
      .limit(1);

    if (!existingRel) {
      await db
        .insert(projectReleases)
        .values({
          id: `rel_${crypto.randomUUID().replace(/-/g, "").slice(0, 14)}`,
          projectId: project.id,
          version: parsed.version,
          commitSha: parsed.commitSha,
          commitAuthor: parsed.deployer == null ? parsed.deployer : scrubTelemetryText(String(parsed.deployer)),
          commitMessage: parsed.changelogSummary == null ? parsed.changelogSummary : scrubTelemetryText(String(parsed.changelogSummary)),
          branch: parsed.branch,
          source: parsed.provider,
          totalSessions: 0,
          crashCount: 0,
        })
        .catch(() => {});
    }

    await recordAuditEvent({
      userId: project.userId,
      actorUsername: parsed.deployer || parsed.provider,
      organizationId: project.organizationId,
      workspaceId: project.workspaceId,
      projectId: project.id,
      action: "deployment.recorded",
      resourceType: "deployment",
      resourceId: depId,
      metadata: {
        provider: parsed.provider,
        version: parsed.version,
        commitSha: parsed.commitSha,
        status: parsed.status,
      },
    });

    return NextResponse.json({ success: true, deploymentId: depId, parsed }, { status: 201 });
  } catch (err) {
    console.error("POST /api/v1/webhooks/deploy error:", err);
    return NextResponse.json({ error: "Failed to ingest deployment webhook" }, { status: 500 });
  }
}
