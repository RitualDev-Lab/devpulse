import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import {
  deployments,
  errorEvents,
  featureFlags,
  flagExposures,
  projectConnectors,
  projectReleases,
} from "@/db/schema";
import { and, desc, eq } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth";
import { resolveProjectAccess } from "@/lib/security/rbac";
import { decryptSecret } from "@/lib/security/crypto";
import { getUserGitHubAccessToken } from "@/lib/security/github-ownership";
import { resolveProjectGitConfig } from "@/lib/integrations/git-provider";
import { resolveUserStorageContext } from "@/lib/storage/quota";
import { getR2ObjectText } from "@/lib/storage/r2";
import { isValidProjectR2ObjectKey } from "@/lib/security/ssrf";
import { analyzeCrashWithGemini } from "@/lib/ai/crash-analyzer";
import { recordAuditEvent } from "@/lib/security/audit";

export const dynamic = "force-dynamic";

async function fetchCommitDiffSummary(params: {
  provider: "github" | "gitlab" | "bitbucket" | "gitea";
  baseUrl: string;
  repoSlug: string;
  commitSha: string;
  token?: string | null;
}): Promise<{ commitUrl: string | null; author: string | null; message: string | null; files: Array<{ filename: string; status: string; patch?: string }> }> {
  const { provider, baseUrl, repoSlug, commitSha, token } = params;
  try {
    if (provider === "github") {
      const headers: Record<string, string> = { Accept: "application/vnd.github.v3+json", "User-Agent": "DevPulse-HQ/1.0" };
      if (token) headers.Authorization = `Bearer ${token}`;
      const res = await fetch(`https://api.github.com/repos/${repoSlug}/commits/${encodeURIComponent(commitSha)}`, {
        headers,
        signal: AbortSignal.timeout(4500),
        cache: "no-store",
      }).catch(() => null);
      if (res && res.ok) {
        const json = await res.json();
        return {
          commitUrl: json.html_url || `https://github.com/${repoSlug}/commit/${commitSha}`,
          author: json.commit?.author?.name || json.author?.login || null,
          message: json.commit?.message || null,
          files: Array.isArray(json.files)
            ? json.files.slice(0, 8).map((f: any) => ({
                filename: String(f.filename || ""),
                status: String(f.status || "modified"),
                patch: f.patch ? String(f.patch).slice(0, 400) : undefined,
              }))
            : [],
        };
      }
    } else if (provider === "gitlab") {
      const headers: Record<string, string> = { "User-Agent": "DevPulse-HQ/1.0" };
      if (token) headers["PRIVATE-TOKEN"] = token;
      const enc = encodeURIComponent(repoSlug);
      const [metaRes, diffRes] = await Promise.all([
        fetch(`${baseUrl}/api/v4/projects/${enc}/repository/commits/${encodeURIComponent(commitSha)}`, { headers, signal: AbortSignal.timeout(4000) }).catch(() => null),
        fetch(`${baseUrl}/api/v4/projects/${enc}/repository/commits/${encodeURIComponent(commitSha)}/diff`, { headers, signal: AbortSignal.timeout(4000) }).catch(() => null),
      ]);
      const meta = metaRes && metaRes.ok ? await metaRes.json().catch(() => null) : null;
      const diffs = diffRes && diffRes.ok ? await diffRes.json().catch(() => []) : [];
      return {
        commitUrl: meta?.web_url || `${baseUrl}/${repoSlug}/-/commit/${commitSha}`,
        author: meta?.author_name || null,
        message: meta?.title || meta?.message || null,
        files: Array.isArray(diffs)
          ? diffs.slice(0, 8).map((d: any) => ({
              filename: String(d.new_path || d.old_path || ""),
              status: d.new_file ? "added" : d.deleted_file ? "removed" : "modified",
              patch: d.diff ? String(d.diff).slice(0, 400) : undefined,
            }))
          : [],
      };
    }
  } catch {
    // Non-blocking commit lookup
  }
  return { commitUrl: null, author: null, message: null, files: [] };
}

export async function POST(req: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await req.json();
    const projectId = String(body.projectId || "");
    const action = String(body.action || "diagnose");
    if (!projectId) return NextResponse.json({ error: "Missing projectId" }, { status: 400 });

    const access = await resolveProjectAccess(projectId, user);
    if (!access || !access.canWrite) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    if (action === "rollback_flag") {
      const flagKey = String(body.flagKey || "").trim();
      if (!flagKey) return NextResponse.json({ error: "Missing flagKey" }, { status: 400 });

      await db
        .update(featureFlags)
        .set({
          isEnabled: false,
          rolloutPercent: 0,
          status: "rolled_back",
          rollbackReason: "1-click regression rollback from Commit-to-Crash Diagnosis",
          updatedAt: new Date().toISOString(),
        })
        .where(and(eq(featureFlags.projectId, projectId), eq(featureFlags.key, flagKey)));

      await recordAuditEvent({
        userId: user.id,
        actorUsername: user.githubUsername,
        organizationId: access.project.organizationId,
        workspaceId: access.project.workspaceId,
        projectId,
        action: "flag.manual_rollback",
        resourceType: "feature_flag",
        resourceId: flagKey,
        headers: req.headers,
        metadata: { source: "commit_crash_diagnosis" },
      });

      return NextResponse.json({ success: true, flagKey, rolledBack: true });
    }

    const errorId = String(body.errorId || "");
    if (!errorId) return NextResponse.json({ error: "Missing errorId" }, { status: 400 });

    const [err] = await db
      .select()
      .from(errorEvents)
      .where(and(eq(errorEvents.id, errorId), eq(errorEvents.projectId, projectId)))
      .limit(1);

    if (!err) return NextResponse.json({ error: "Crash event not found" }, { status: 404 });

    // Correlate deployment, release, Git commit diff, and feature flag exposure
    const [recentDeploys, matchingReleases, gitConns, exposureRows, flagRow] = await Promise.all([
      db.select().from(deployments).where(eq(deployments.projectId, projectId)).orderBy(desc(deployments.deployedAt)).limit(10),
      err.version
        ? db.select().from(projectReleases).where(and(eq(projectReleases.projectId, projectId), eq(projectReleases.version, err.version))).limit(1)
        : Promise.resolve([]),
      db.select().from(projectConnectors).where(and(eq(projectConnectors.projectId, projectId), eq(projectConnectors.category, "git"))).limit(2),
      err.flagKey
        ? db.select({ variant: flagExposures.variant }).from(flagExposures).where(and(eq(flagExposures.projectId, projectId), eq(flagExposures.flagKey, err.flagKey))).limit(200)
        : Promise.resolve([]),
      err.flagKey
        ? db.select().from(featureFlags).where(and(eq(featureFlags.projectId, projectId), eq(featureFlags.key, err.flagKey))).limit(1)
        : Promise.resolve([]),
    ]);

    const release = matchingReleases[0] || null;
    const matchedDeploy =
      recentDeploys.find((d) => (err.commitSha && d.commitSha === err.commitSha) || (err.version && d.version === err.version)) ||
      recentDeploys[0] ||
      null;
    const suspectedSha = err.commitSha || release?.commitSha || matchedDeploy?.commitSha || null;

    let fullStack = err.stackTrace || "";
    if (err.r2ObjectKey) {
      const storageCtx = await resolveUserStorageContext(access.project.userId).catch(() => null);
      if (storageCtx?.credentials && isValidProjectR2ObjectKey(err.r2ObjectKey, projectId, access.project.userId)) {
        const txt = await getR2ObjectText(storageCtx.credentials, err.r2ObjectKey).catch(() => null);
        if (txt) fullStack = txt.slice(0, 10_000);
      }
    }

    let diffSummary = { commitUrl: null as string | null, author: null as string | null, message: null as string | null, files: [] as Array<{ filename: string; status: string; patch?: string }> };
    if (suspectedSha) {
      const primaryGit = gitConns[0];
      const gitConnectorToken = primaryGit?.credentialsEncrypted
        ? await decryptSecret(primaryGit.credentialsEncrypted).catch(() => null)
        : null;
      const projGhToken = access.project.githubTokenEncrypted
        ? await decryptSecret(access.project.githubTokenEncrypted).catch(() => null)
        : null;
      const userGhToken = projGhToken || (await getUserGitHubAccessToken(user.id).catch(() => null));
      const gitCfg = resolveProjectGitConfig({
        githubRepo: access.project.githubRepo,
        githubToken: userGhToken,
        connectors: gitConns,
        gitConnectorToken,
      });
      if (gitCfg) {
        diffSummary = await fetchCommitDiffSummary({
          provider: gitCfg.provider,
          baseUrl: gitCfg.baseUrl,
          repoSlug: gitCfg.repoSlug,
          commitSha: suspectedSha,
          token: gitCfg.token,
        });
      }
    }

    const enrichedContext = [
      fullStack,
      suspectedSha ? `\nSuspected Commit: ${suspectedSha}` : "",
      matchedDeploy ? `Deploy: ${matchedDeploy.version} (${matchedDeploy.provider}) at ${matchedDeploy.deployedAt}` : "",
      diffSummary.files.length > 0 ? `Changed Files: ${diffSummary.files.map((f) => f.filename).join(", ")}` : "",
      err.flagKey ? `Correlated Feature Flag: ${err.flagKey}=${err.flagVariant || "variant"} (${exposureRows.length} exposures)` : "",
    ]
      .filter(Boolean)
      .join("\n");

    const ai = await analyzeCrashWithGemini({
      errorName: err.errorName,
      message: err.message,
      stackTrace: enrichedContext,
      runtime: err.runtime,
      version: err.version,
      routePath: err.routePath,
    });

    await db
      .update(errorEvents)
      .set({
        aiGroupTitle: ai.aiGroupTitle,
        aiRootCause: ai.aiRootCause,
        aiFixSuggestion: ai.aiFixSuggestion,
        aiCodeSnippet: ai.aiCodeSnippet,
        commitSha: suspectedSha || err.commitSha,
      })
      .where(eq(errorEvents.id, err.id));

    return NextResponse.json({
      success: true,
      diagnosis: {
        errorId: err.id,
        commitSha: suspectedSha,
        commitUrl: diffSummary.commitUrl,
        commitAuthor: diffSummary.author || release?.commitAuthor || matchedDeploy?.deployer || null,
        commitMessage: diffSummary.message || release?.commitMessage || null,
        deploy: matchedDeploy
          ? {
              version: matchedDeploy.version,
              provider: matchedDeploy.provider,
              status: matchedDeploy.status,
              deployedAt: matchedDeploy.deployedAt,
            }
          : null,
        changedFiles: diffSummary.files,
        flagCorrelation: err.flagKey
          ? {
              flagKey: err.flagKey,
              flagVariant: err.flagVariant || "variant",
              exposures: exposureRows.length,
              isEnabled: flagRow[0]?.isEnabled ?? false,
              status: flagRow[0]?.status || "unknown",
            }
          : null,
        rootCause: ai.aiRootCause,
        fixSuggestion: ai.aiFixSuggestion,
        codeSnippet: ai.aiCodeSnippet,
      },
    });
  } catch (err) {
    console.error("POST /api/v1/crashes/diagnose error:", err);
    return NextResponse.json({ error: "Regression diagnosis failed" }, { status: 500 });
  }
}
