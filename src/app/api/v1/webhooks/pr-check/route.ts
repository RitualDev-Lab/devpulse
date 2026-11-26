import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { dailyMetrics, errorEvents, projectConnectors, projects } from "@/db/schema";
import { and, desc, eq, gte } from "drizzle-orm";
import { verifyTelemetryApiKey } from "@/lib/security/api-keys";
import { getCurrentUser } from "@/lib/auth";
import { resolveProjectAccess } from "@/lib/security/rbac";
import { decryptSecret } from "@/lib/security/crypto";
import { getUserGitHubAccessToken } from "@/lib/security/github-ownership";
import { readProjectSnapshots } from "@/lib/dashboard/snapshots";
import { buildProjectSbomReport } from "@/lib/security/sbom";
import { aggregateWebVitals, type RawWebVitalSample } from "@/lib/analytics/rum-vitals";
import { resolveProjectGitConfig } from "@/lib/integrations/git-provider";
import {
  buildPrIntelligenceComment,
  postGitHubPrComment,
  postGitLabMrNote,
} from "@/lib/integrations/pr-bot";
import { recordAuditEvent } from "@/lib/security/audit";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const rawKey =
      req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ||
      (typeof body.apiKey === "string" ? body.apiKey : "");

    let proj: typeof projects.$inferSelect | undefined;
    let actorUserId: string;
    let actorName = "devpulse-ci-bot";

    if (rawKey.trim()) {
      const verified = await verifyTelemetryApiKey(rawKey.trim());
      if (!verified) return NextResponse.json({ error: "Invalid telemetry API key" }, { status: 401 });
      const [row] = await db.select().from(projects).where(eq(projects.id, verified.id)).limit(1);
      proj = row;
      actorUserId = verified.userId;
    } else {
      const projectId = String(body.projectId || "");
      if (!projectId) return NextResponse.json({ error: "Missing projectId" }, { status: 400 });
      const user = await getCurrentUser();
      if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      const access = await resolveProjectAccess(projectId, user);
      if (!access || !access.canWrite) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      proj = access.project;
      actorUserId = user.id;
      actorName = user.githubUsername;
    }

    if (!proj) return NextResponse.json({ error: "Project not found" }, { status: 404 });

    const prNumber = Number(body.prNumber || 0);
    if (!Number.isFinite(prNumber) || prNumber <= 0) {
      return NextResponse.json({ error: "Valid prNumber is required" }, { status: 400 });
    }

    const branch = body.branch ? String(body.branch).slice(0, 120) : null;
    const previewUrl = body.previewUrl ? String(body.previewUrl).slice(0, 300) : null;
    const postComment = body.postComment !== false;
    const cutoffDate = new Date(Date.now() - 7 * 86400_000).toISOString().slice(0, 10);

    const [snap, recentMetrics, openCrashes, gitConnectors] = await Promise.all([
      readProjectSnapshots(proj.id),
      db
        .select({ value: dailyMetrics.value, metadataJson: dailyMetrics.metadataJson })
        .from(dailyMetrics)
        .where(and(eq(dailyMetrics.projectId, proj.id), gte(dailyMetrics.date, cutoffDate)))
        .limit(400),
      db
        .select({ errorName: errorEvents.errorName, stackTrace: errorEvents.stackTrace })
        .from(errorEvents)
        .where(and(eq(errorEvents.projectId, proj.id), eq(errorEvents.status, "unresolved")))
        .orderBy(desc(errorEvents.createdAt))
        .limit(200),
      db
        .select({
          category: projectConnectors.category,
          provider: projectConnectors.provider,
          identifier: projectConnectors.identifier,
          targetUrl: projectConnectors.targetUrl,
          credentialsEncrypted: projectConnectors.credentialsEncrypted,
        })
        .from(projectConnectors)
        .where(and(eq(projectConnectors.projectId, proj.id), eq(projectConnectors.category, "git"))),
    ]);

    const vitalSamples: RawWebVitalSample[] = [];
    for (const m of recentMetrics) {
      if (!m.metadataJson) continue;
      try {
        const meta = JSON.parse(m.metadataJson);
        if (meta?.kind === "web_vital" && meta.vitalMetric) {
          const metric = String(meta.vitalMetric).toUpperCase();
          if (metric === "LCP" || metric === "INP" || metric === "CLS" || metric === "TTFB") {
            vitalSamples.push({
              metric,
              value: Number(meta.vitalValue ?? m.value),
              route: typeof meta.route === "string" ? meta.route : "/",
              country: typeof meta.country === "string" ? meta.country : "Global",
              browser: typeof meta.browser === "string" ? meta.browser : "other",
              release: typeof meta.release === "string" ? meta.release : "unreleased",
            });
          }
        }
      } catch {
        // ignore invalid metadata
      }
    }

    const vitals = aggregateWebVitals(vitalSamples);
    const sbom = await buildProjectSbomReport({
      project: {
        npmPackage: proj.npmPackage,
        pypiPackage: proj.pypiPackage,
        rustCrate: proj.rustCrate,
        goModule: proj.goModule,
      },
      packageSecurity: snap.packageSecurity,
      extraPackages: snap.extraPackages,
      skipRemoteOsv: true,
    });

    const vulnList = sbom.packages.flatMap((p) =>
      p.vulnerabilities.map((v) => ({
        packageName: p.packageName,
        ecosystem: p.ecosystem,
        severity: v.severity,
        id: v.id,
      }))
    );

    const crashMap = new Map<string, { errorName: string; count: number; topFrame: string | null }>();
    for (const c of openCrashes) {
      const existing = crashMap.get(c.errorName) || {
        errorName: c.errorName,
        count: 0,
        topFrame: c.stackTrace?.split("\n")[1]?.trim().slice(0, 80) || null,
      };
      existing.count++;
      crashMap.set(c.errorName, existing);
    }

    const commentMarkdown = buildPrIntelligenceComment({
      projectName: proj.name,
      projectSlug: proj.slug,
      prNumber,
      branch,
      previewUrl,
      webVitalsDelta: {
        lcpMs: vitals.metrics.LCP?.p75 ?? null,
        inpMs: vitals.metrics.INP?.p75 ?? null,
        cls: vitals.metrics.CLS?.p75 ?? null,
      },
      vulnerabilities: vulnList,
      touchedCrashes: Array.from(crashMap.values()).sort((a, b) => b.count - a.count),
    });

    let posted = false;
    let commentUrl: string | undefined;

    const gitCfg = resolveProjectGitConfig({
      githubRepo: proj.githubRepo,
      connectors: gitConnectors,
    });

    if (postComment && gitCfg) {
      if (gitCfg.provider === "gitlab") {
        const glConnector = gitConnectors.find((c) => c.provider === "gitlab");
        const glToken = glConnector?.credentialsEncrypted
          ? await decryptSecret(glConnector.credentialsEncrypted).catch(() => null)
          : null;
        if (glToken) {
          const glRes = await postGitLabMrNote({
            baseUrl: gitCfg.baseUrl,
            projectPath: gitCfg.repoSlug,
            mrIid: prNumber,
            token: glToken,
            body: commentMarkdown,
          });
          posted = glRes.ok;
        }
      } else if (gitCfg.provider === "github") {
        const ghToken =
          (proj.githubTokenEncrypted
            ? await decryptSecret(proj.githubTokenEncrypted).catch(() => null)
            : null) || (await getUserGitHubAccessToken(proj.userId));
        if (ghToken) {
          const ghRes = await postGitHubPrComment({
            repo: gitCfg.repoSlug,
            prNumber,
            token: ghToken,
            body: commentMarkdown,
          });
          posted = ghRes.ok;
          commentUrl = ghRes.commentUrl;
        }
      }
    }

    await recordAuditEvent({
      userId: actorUserId,
      actorUsername: actorName,
      organizationId: proj.organizationId,
      workspaceId: proj.workspaceId,
      projectId: proj.id,
      action: "pr_bot.commented",
      resourceType: "pull_request",
      resourceId: `#${prNumber}`,
      headers: req.headers,
      metadata: { prNumber, posted, commentUrl: commentUrl || null },
    });

    return NextResponse.json({
      success: true,
      posted,
      commentUrl: commentUrl || null,
      commentMarkdown,
    });
  } catch (err) {
    console.error("POST /api/v1/webhooks/pr-check error:", err);
    return NextResponse.json({ error: "PR Intelligence check failed" }, { status: 500 });
  }
}
