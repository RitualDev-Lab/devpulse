import { db } from "@/db";
import {
  projects,
  errorEvents,
  pageviews,
  dashboardWidgets,
  projectReleases,
  uptimeMonitors,
  uptimeChecks,
  projectConnectors,
  dailyMetrics,
  sourceMaps,
} from "@/db/schema";
import { eq, desc, and, gte } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth";
import { withEdgeCache } from "@/lib/integrations/cached";
import { getPlanDefinition } from "@/lib/billing/plans";
import { listAccessibleProjects } from "@/lib/security/rbac";
import { getUserGitHubAccessToken } from "@/lib/security/github-ownership";
import { decryptSecret } from "@/lib/security/crypto";
import { fetchGitHubRepoStats } from "@/lib/integrations/github";
import { fetchNpmStats } from "@/lib/integrations/npm";
import { fetchPyPiStats } from "@/lib/integrations/pypi";
import { fetchRustCrateStats } from "@/lib/integrations/crates";
import { fetchGoModuleStats } from "@/lib/integrations/go";
import { fetchDockerRepoStats } from "@/lib/integrations/docker";
import { fetchVsCodeStats } from "@/lib/integrations/vscode";
import { fetchMcpStats } from "@/lib/integrations/mcp";
import { fetchRevenueStats } from "@/lib/integrations/revenue";
import { computeP95Latency, computeUptimeBasisPoints } from "@/lib/monitors/checker";
import type { ProjectSummary } from "@/components/dashboard/ProjectWorkspaceSwitcher";
import type { DashboardData } from "@/components/dashboard/DragDropGrid";

export interface LoadedWorkspaceReady {
  status: "ready";
  user: any | null;
  activeProject: any;
  initialData: DashboardData & {
    project: DashboardData["project"] & {
      stackPreset?: string;
      hasNpmToken?: boolean;
      hasGithubToken?: boolean;
    };
    connectors?: Array<{
      id: string;
      category: string;
      provider: string;
      label: string;
      targetUrl: string | null;
      identifier: string | null;
      metadataJson: string | null;
      hasCredentials: boolean;
      lastSyncedAt: string | null;
    }>;
    customMetrics?: Array<{
      metricName: string;
      latestValue: number;
      samples: number;
      lastRecordedAt: string;
    }>;
    sourceMaps?: Array<{
      id: string;
      version: string;
      filePath: string;
      sizeBytes: number;
      createdAt: string;
    }>;
    githubHistory?: {
      starsDaily: Array<{ date: string; stars: number }>;
      clonesDaily: Array<{ date: string; count: number; uniques: number }>;
      viewsDaily: Array<{ date: string; count: number; uniques: number }>;
    };
    packageHistory?: Array<{
      date: string;
      npm: number;
      pypi: number;
      crates: number;
      docker: number;
      go: number;
    }>;
    analyticsSummary?: DashboardData["analyticsSummary"] & {
      dau?: number;
      wau?: number;
      mau?: number;
      dailyCohorts?: Array<{ date: string; web: number; appCli: number; total: number }>;
      topPages?: Array<{ path: string; count: number }>;
      topCustomEvents?: Array<{ event: string; count: number }>;
    };
  };
  projects: ProjectSummary[];
  customDomain: string | null;
  storageTier: string;
  accessRole: import("@/lib/security/rbac").OrgRole;
  isDemo: boolean;
}

export type LoadedWorkspaceResult =
  | { status: "auth_gate" }
  | { status: "onboarding"; user: any }
  | LoadedWorkspaceReady;

export async function loadDashboardWorkspace(searchParams?: {
  project?: string;
  demo?: string;
}): Promise<LoadedWorkspaceResult> {
  const requestedProject = searchParams?.project;
  const isDemoRequested = searchParams?.demo === "1";

  const user = await getCurrentUser();

  if (!user && !isDemoRequested) {
    return { status: "auth_gate" };
  }

  let activeProject: any = null;
  let userProjects: any[] = [];
  let isDemoView = false;

  if (user) {
    try {
      userProjects = await listAccessibleProjects(user);
    } catch (dbErr) {
      console.error("Database query error fetching user projects:", dbErr);
      userProjects = [];
    }

    if (userProjects.length === 0) {
      return { status: "onboarding", user };
    }

    if (requestedProject) {
      activeProject =
        userProjects.find(
          (p) => p.slug === requestedProject || p.id === requestedProject
        ) || null;
    }

    if (!activeProject) {
      activeProject = userProjects[0];
    }
  } else if (isDemoRequested) {
    isDemoView = true;
    try {
      const demoRows = await db
        .select()
        .from(projects)
        .where(eq(projects.id, "prj_ritual_core"))
        .limit(1);
      activeProject = demoRows[0] || null;
    } catch {
      activeProject = null;
    }

    if (!activeProject) {
      return { status: "auth_gate" };
    }
  }

  const planDef = getPlanDefinition(user?.storageTier || "free");
  const retentionCutoffIso = new Date(
    Date.now() - planDef.historyDays * 24 * 60 * 60 * 1000
  ).toISOString();

  const userGhToken = user ? await getUserGitHubAccessToken(user.id).catch(() => null) : null;
  const projectGhToken = await decryptSecret(activeProject.githubTokenEncrypted).catch(() => null);
  const effectiveGhToken = projectGhToken || userGhToken;
  const decryptedNpmToken = await decryptSecret(activeProject.npmTokenEncrypted).catch(() => null);
  const decryptedStripeKey = await decryptSecret(activeProject.stripeApiKey).catch(() => null);
  const decryptedDodoKey = await decryptSecret(activeProject.dodoPaymentsApiKey).catch(() => null);

  const rawConnectors = await db
    .select()
    .from(projectConnectors)
    .where(eq(projectConnectors.projectId, activeProject.id))
    .orderBy(desc(projectConnectors.createdAt))
    .limit(30)
    .catch(() => []);

  const decryptedPaymentConnectors = await Promise.all(
    rawConnectors
      .filter((c) => c.category === "payment")
      .map(async (c) => ({
        id: c.id,
        provider: c.provider,
        label: c.label,
        targetUrl: c.targetUrl,
        apiKey: await decryptSecret(c.credentialsEncrypted).catch(() => null),
      }))
  );

  const dockerTokenConn = rawConnectors.find(
    (c) => c.category === "package" && c.provider === "docker" && c.credentialsEncrypted
  );
  const decryptedDockerToken = dockerTokenConn
    ? await decryptSecret(dockerTokenConn.credentialsEncrypted).catch(() => null)
    : null;

  const [
    githubStats,
    npmStats,
    pypiStats,
    rustStats,
    goStats,
    dockerStats,
    vscodeStats,
    mcpStats,
    revenueStats,
    rawErrors,
    rawWidgets,
    rawReleases,
    rawMonitors,
    rawUptimeChecks,
    rawDailyMetrics,
    rawPageviews,
    rawSourceMaps,
  ] = await Promise.all([
    activeProject.githubRepo
      ? withEdgeCache(`gh:${activeProject.githubRepo}:${Boolean(effectiveGhToken)}`, 300, 2600, () =>
          fetchGitHubRepoStats(activeProject.githubRepo!, effectiveGhToken || undefined)
        )
      : Promise.resolve(null),
    activeProject.npmPackage
      ? withEdgeCache(`npm:${activeProject.npmPackage}:${Boolean(decryptedNpmToken)}`, 300, 2600, () =>
          fetchNpmStats(activeProject.npmPackage!, decryptedNpmToken)
        )
      : Promise.resolve(null),
    activeProject.pypiPackage
      ? withEdgeCache(`pypi:${activeProject.pypiPackage}`, 300, 2600, () =>
          fetchPyPiStats(activeProject.pypiPackage!)
        )
      : Promise.resolve(null),
    activeProject.rustCrate
      ? withEdgeCache(`crates:${activeProject.rustCrate}`, 300, 2600, () =>
          fetchRustCrateStats(activeProject.rustCrate!)
        )
      : Promise.resolve(null),
    activeProject.goModule
      ? withEdgeCache(`go:${activeProject.goModule}`, 300, 2600, () =>
          fetchGoModuleStats(activeProject.goModule!)
        )
      : Promise.resolve(null),
    activeProject.dockerImage
      ? withEdgeCache(`docker:${activeProject.dockerImage}:${Boolean(decryptedDockerToken)}`, 300, 2600, () =>
          fetchDockerRepoStats(activeProject.dockerImage!, decryptedDockerToken)
        )
      : Promise.resolve(null),
    activeProject.vscodeExtension
      ? withEdgeCache(`vscode:${activeProject.vscodeExtension}`, 300, 2600, () =>
          fetchVsCodeStats(activeProject.vscodeExtension!)
        )
      : Promise.resolve(null),
    activeProject.mcpServerName
      ? withEdgeCache(
          `mcp:${activeProject.mcpServerName}:${activeProject.githubRepo || ""}`,
          300,
          2600,
          () => fetchMcpStats(activeProject.mcpServerName!, activeProject.githubRepo)
        )
      : Promise.resolve(null),
    withEdgeCache(`rev:${activeProject.id}:${decryptedPaymentConnectors.length}`, 120, 2600, () =>
      fetchRevenueStats({
        stripeKey: decryptedStripeKey,
        dodoKey: decryptedDodoKey,
        dodoEnv: activeProject.dodoPaymentsEnvironment,
        githubSponsorsUsername: activeProject.githubSponsorsUsername,
        modularConnectors: decryptedPaymentConnectors,
      })
    ),
    db
      .select()
      .from(errorEvents)
      .where(
        and(
          eq(errorEvents.projectId, activeProject.id),
          gte(errorEvents.createdAt, retentionCutoffIso)
        )
      )
      .orderBy(desc(errorEvents.createdAt))
      .limit(60)
      .catch(() => []),
    db
      .select()
      .from(dashboardWidgets)
      .where(eq(dashboardWidgets.projectId, activeProject.id))
      .catch(() => []),
    db
      .select()
      .from(projectReleases)
      .where(eq(projectReleases.projectId, activeProject.id))
      .orderBy(desc(projectReleases.releasedAt))
      .limit(10)
      .catch(() => []),
    db
      .select()
      .from(uptimeMonitors)
      .where(eq(uptimeMonitors.projectId, activeProject.id))
      .orderBy(desc(uptimeMonitors.createdAt))
      .limit(15)
      .catch(() => []),
    db
      .select()
      .from(uptimeChecks)
      .where(eq(uptimeChecks.projectId, activeProject.id))
      .orderBy(desc(uptimeChecks.checkedAt))
      .limit(120)
      .catch(() => []),
    db
      .select()
      .from(dailyMetrics)
      .where(eq(dailyMetrics.projectId, activeProject.id))
      .orderBy(desc(dailyMetrics.date))
      .limit(180)
      .catch(() => []),
    db
      .select()
      .from(pageviews)
      .where(
        and(
          eq(pageviews.projectId, activeProject.id),
          gte(pageviews.createdAt, retentionCutoffIso)
        )
      )
      .limit(500)
      .catch(() => []),
    db
      .select()
      .from(sourceMaps)
      .where(eq(sourceMaps.projectId, activeProject.id))
      .orderBy(desc(sourceMaps.createdAt))
      .limit(40)
      .catch(() => []),
  ]);

  const initialLayout = (rawWidgets || []).map((w) => ({
    id: w.widgetType,
    title: w.title,
    x: w.positionX,
    y: w.positionY,
    w: w.width,
    h: w.height,
    isVisible: w.isVisible,
  }));

  const errors = (rawErrors || []).map((err) => ({
    id: err.id,
    errorName: err.errorName,
    message: err.message,
    stackTrace: err.stackTrace,
    runtime: err.runtime,
    version: err.version,
    os: err.os,
    environment: err.environment,
    status: err.status,
    attachmentUrl: err.attachmentUrl,
    r2ObjectKey: err.r2ObjectKey,
    payloadSizeBytes: err.payloadSizeBytes,
    storageProvider: err.storageProvider,
    reporterEmail: err.reporterEmail,
    breadcrumbsJson: err.breadcrumbsJson,
    commitSha: err.commitSha,
    traceId: err.traceId,
    aiGroupKey: err.aiGroupKey,
    aiGroupTitle: err.aiGroupTitle,
    aiRootCause: err.aiRootCause,
    aiFixSuggestion: err.aiFixSuggestion,
    aiCodeSnippet: err.aiCodeSnippet,
    isRegression: err.isRegression,
    affectedUsersCount: err.affectedUsersCount,
    countryCode: err.countryCode,
    routePath: err.routePath,
    estimatedLostRevenueCents: err.estimatedLostRevenueCents,
    impactScore: err.impactScore,
    platform: err.platform,
    errorCategory: err.errorCategory,
    deviceModel: err.deviceModel,
    appBuild: err.appBuild,
    flagKey: err.flagKey,
    flagVariant: err.flagVariant,
    githubIssueNumber: err.githubIssueNumber,
    githubIssueUrl: err.githubIssueUrl,
    githubPrNumber: err.githubPrNumber,
    githubPrUrl: err.githubPrUrl,
    createdAt: err.createdAt,
  }));

  const refMap: Record<string, number> = {};
  const countryMap: Record<string, number> = {};
  const pathMap: Record<string, number> = {};
  const pageOnlyMap: Record<string, number> = {};
  const customEventMap: Record<string, number> = {};
  const osMap: Record<string, number> = {};
  const dailyMap: Record<string, number> = {};
  const cohortMap: Record<string, { web: number; appCli: number; total: number }> = {};
  let desktopCount = 0;
  let mobileCount = 0;
  let webHits = 0;
  let appHits = 0;

  const todayIso = new Date().toISOString().slice(0, 10);
  const weekCutoffIso = new Date(Date.now() - 7 * 86400_000).toISOString().slice(0, 10);
  const monthCutoffIso = new Date(Date.now() - 30 * 86400_000).toISOString().slice(0, 10);
  const dauSet = new Set<string>();
  const wauSet = new Set<string>();
  const mauSet = new Set<string>();

  for (const pv of rawPageviews || []) {
    refMap[pv.referrer] = (refMap[pv.referrer] || 0) + 1;
    countryMap[pv.country] = (countryMap[pv.country] || 0) + 1;
    const isCustom = pv.eventName && pv.eventName !== "pageview";
    const pKey = isCustom ? `event:${pv.eventName}` : pv.path || "/";
    pathMap[pKey] = (pathMap[pKey] || 0) + 1;
    if (isCustom) {
      customEventMap[pv.eventName] = (customEventMap[pv.eventName] || 0) + 1;
    } else {
      pageOnlyMap[pv.path || "/"] = (pageOnlyMap[pv.path || "/"] || 0) + 1;
    }
    const osKey = pv.os || "Unknown";
    osMap[osKey] = (osMap[osKey] || 0) + 1;
    const dayKey = String(pv.createdAt || "").slice(0, 10) || todayIso;
    dailyMap[dayKey] = (dailyMap[dayKey] || 0) + 1;
    if (!cohortMap[dayKey]) cohortMap[dayKey] = { web: 0, appCli: 0, total: 0 };
    cohortMap[dayKey].total += 1;
    if (pv.sourceType && pv.sourceType !== "web") {
      appHits++;
      cohortMap[dayKey].appCli += 1;
    } else {
      webHits++;
      cohortMap[dayKey].web += 1;
    }
    if (pv.device === "mobile" || pv.device === "tablet") mobileCount++;
    else desktopCount++;

    const sig = `${pv.country || ""}:${pv.os || ""}:${pv.browser || ""}:${pv.device || ""}:${pv.sourceType || "web"}`;
    if (dayKey === todayIso) dauSet.add(sig);
    if (dayKey >= weekCutoffIso) wauSet.add(sig);
    if (dayKey >= monthCutoffIso) mauSet.add(sig);
  }

  const analyticsSummary = {
    totalPageviews: rawPageviews.length,
    dau: dauSet.size,
    wau: wauSet.size,
    mau: mauSet.size,
    uniqueReferrers: Object.keys(refMap).length,
    topReferrers: Object.entries(refMap)
      .map(([referrer, count]) => ({ referrer, count }))
      .sort((a, b) => b.count - a.count),
    topCountries: Object.entries(countryMap)
      .map(([country, count]) => ({ country, count }))
      .sort((a, b) => b.count - a.count),
    topPaths: Object.entries(pathMap)
      .map(([path, count]) => ({ path, count }))
      .sort((a, b) => b.count - a.count),
    topPages: Object.entries(pageOnlyMap)
      .map(([path, count]) => ({ path, count }))
      .sort((a, b) => b.count - a.count),
    topCustomEvents: Object.entries(customEventMap)
      .map(([event, count]) => ({ event, count }))
      .sort((a, b) => b.count - a.count),
    topOs: Object.entries(osMap)
      .map(([os, count]) => ({ os, count }))
      .sort((a, b) => b.count - a.count),
    dailySeries: Object.entries(dailyMap)
      .map(([date, hits]) => ({ date, hits }))
      .sort((a, b) => a.date.localeCompare(b.date))
      .slice(-14),
    dailyCohorts: Object.entries(cohortMap)
      .map(([date, c]) => ({ date, ...c }))
      .sort((a, b) => a.date.localeCompare(b.date))
      .slice(-30),
    sources: { web: webHits, app: appHits },
    devices: { desktop: desktopCount, mobile: mobileCount },
  };

  const initialData = {
    project: {
      id: activeProject.id,
      name: activeProject.name,
      slug: activeProject.slug,
      githubRepo: activeProject.githubRepo,
      npmPackage: activeProject.npmPackage,
      pypiPackage: activeProject.pypiPackage,
      rustCrate: activeProject.rustCrate,
      goModule: activeProject.goModule,
      dockerImage: activeProject.dockerImage,
      vscodeExtension: activeProject.vscodeExtension,
      mcpServerName: activeProject.mcpServerName,
      stackPreset: activeProject.stackPreset || "saas",
      hasNpmToken: Boolean(activeProject.npmTokenEncrypted),
      hasGithubToken: Boolean(activeProject.githubTokenEncrypted),
      telemetryApiKey: activeProject.telemetryApiKey,
      discordWebhookUrl: activeProject.discordWebhookUrl,
      slackWebhookUrl: activeProject.slackWebhookUrl,
      telegramBotToken: activeProject.telegramBotToken,
      telegramChatId: activeProject.telegramChatId,
      genericWebhookUrl: activeProject.genericWebhookUrl,
      pagerdutyRoutingKey: activeProject.pagerdutyRoutingKey,
      hasOpsgenieApiKey: Boolean(activeProject.opsgenieApiKeyEncrypted),
      teamsWebhookUrl: activeProject.teamsWebhookUrl,
      notificationEmail: activeProject.notificationEmail,
      emailProvider: activeProject.emailProvider,
      hasEmailApiKey: Boolean(activeProject.emailApiKeyEncrypted),
      digestEnabled: activeProject.digestEnabled,
      stripeApiKey: activeProject.stripeApiKey ? "••••••••" : null,
      dodoPaymentsApiKey: activeProject.dodoPaymentsApiKey ? "••••••••" : null,
      theme: activeProject.theme,
      customCss: activeProject.customCss,
    },
    githubStats,
    npmStats,
    pypiStats,
    rustStats,
    goStats,
    dockerStats,
    vscodeStats,
    mcpStats,
    revenueStats,
    analyticsSummary,
    uptimeSummary: {
      monitors: (rawMonitors || []).map((m) => ({
        id: m.id,
        name: m.name,
        url: m.url,
        lastStatus: m.lastStatus,
        lastStatusCode: m.lastStatusCode,
        lastLatencyMs: m.lastLatencyMs,
        p95LatencyMs: m.p95LatencyMs,
        uptimePercent: (m.uptimeBasisPoints / 100).toFixed(2),
        lastCheckedAt: m.lastCheckedAt,
      })),
      recentChecks: (rawUptimeChecks || []).slice(0, 100).reverse(),
      overallP95Ms: computeP95Latency((rawUptimeChecks || []).map((c) => c.latencyMs)),
      overallUptimePercent: (
        computeUptimeBasisPoints((rawUptimeChecks || []).map((c) => c.status)) / 100
      ).toFixed(2),
    },
    sourceMaps: (rawSourceMaps || []).map((s) => ({
      id: s.id,
      version: s.version,
      filePath: s.filePath,
      sizeBytes: s.sizeBytes,
      createdAt: s.createdAt,
    })),
    githubHistory: (() => {
      const starsDaily: Array<{ date: string; stars: number }> = [];
      const clonesDaily: Array<{ date: string; count: number; uniques: number }> = [];
      const viewsDaily: Array<{ date: string; count: number; uniques: number }> = [];
      for (const m of rawDailyMetrics || []) {
        if (m.source !== "github") continue;
        let meta: any = {};
        try {
          meta = m.metadataJson ? JSON.parse(m.metadataJson) : {};
        } catch {
          meta = {};
        }
        if (m.metricType === "stars") starsDaily.push({ date: m.date, stars: m.value });
        if (m.metricType === "clones") clonesDaily.push({ date: m.date, count: m.value, uniques: Number(meta.uniques || 0) });
        if (m.metricType === "views") viewsDaily.push({ date: m.date, count: m.value, uniques: Number(meta.uniques || 0) });
      }
      return {
        starsDaily: starsDaily.sort((a, b) => a.date.localeCompare(b.date)),
        clonesDaily: clonesDaily.sort((a, b) => a.date.localeCompare(b.date)),
        viewsDaily: viewsDaily.sort((a, b) => a.date.localeCompare(b.date)),
      };
    })(),
    packageHistory: (() => {
      const dayMap: Record<string, { date: string; npm: number; pypi: number; crates: number; docker: number; go: number }> = {};
      const ensure = (d: string) => {
        if (!dayMap[d]) dayMap[d] = { date: d, npm: 0, pypi: 0, crates: 0, docker: 0, go: 0 };
        return dayMap[d];
      };
      for (const h of npmStats?.dailyHistory || []) {
        ensure(h.date).npm = h.downloads;
      }
      for (const m of rawDailyMetrics || []) {
        if (m.source === "npm" && !ensure(m.date).npm) ensure(m.date).npm = m.value;
        if (m.source === "pypi") ensure(m.date).pypi = m.value;
        if (m.source === "crates") ensure(m.date).crates = m.value;
        if (m.source === "docker") ensure(m.date).docker = m.value;
        if (m.source === "go") ensure(m.date).go = m.value;
      }
      return Object.values(dayMap).sort((a, b) => a.date.localeCompare(b.date)).slice(-30);
    })(),
    connectors: (rawConnectors || []).map((c) => ({
      id: c.id,
      category: c.category,
      provider: c.provider,
      label: c.label,
      targetUrl: c.targetUrl,
      identifier: c.identifier,
      metadataJson: c.metadataJson,
      hasCredentials: Boolean(c.credentialsEncrypted),
      lastSyncedAt: c.lastSyncedAt,
    })),
    customMetrics: (() => {
      const map = new Map<string, { metricName: string; latestValue: number; samples: number; lastRecordedAt: string }>();
      for (const m of rawDailyMetrics || []) {
        if (!m.metadataJson) continue;
        try {
          const meta = JSON.parse(m.metadataJson);
          if (meta?.kind !== "custom_metric" || !meta.metricName) continue;
          const prev = map.get(meta.metricName);
          if (!prev) {
            map.set(meta.metricName, {
              metricName: String(meta.metricName),
              latestValue: Number(meta.metricValue ?? m.value),
              samples: 1,
              lastRecordedAt: m.createdAt,
            });
          } else {
            prev.samples += 1;
          }
        } catch {
          // ignore malformed metadataJson
        }
      }
      return Array.from(map.values());
    })(),
    errors,
    releases: (rawReleases || []).map((r) => {
      const sessions = Math.max(r.totalSessions, r.crashCount);
      const crashFreeRate =
        sessions > 0
          ? Number(Math.max(0, ((sessions - r.crashCount) / sessions) * 100).toFixed(2))
          : 100;
      return {
        id: r.id,
        version: r.version,
        commitSha: r.commitSha,
        commitAuthor: r.commitAuthor,
        commitMessage: r.commitMessage,
        branch: r.branch,
        source: r.source,
        totalSessions: r.totalSessions,
        crashCount: r.crashCount,
        crashFreeRate,
        releasedAt: r.releasedAt,
      };
    }),
    initialLayout,
  };

  const projectSummaries: ProjectSummary[] = userProjects.map((p) => ({
    id: p.id,
    name: p.name,
    slug: p.slug,
    githubRepo: p.githubRepo,
    npmPackage: p.npmPackage,
    pypiPackage: p.pypiPackage,
    rustCrate: p.rustCrate,
    goModule: p.goModule,
    dockerImage: p.dockerImage,
    telemetryApiKey: p.telemetryApiKey,
  }));

  return {
    status: "ready",
    user,
    activeProject,
    initialData,
    projects: projectSummaries,
    customDomain: user?.customDomainVerified ? user.customDomain : null,
    storageTier: user?.storageTier || "free",
    accessRole: (activeProject?.accessRole as import("@/lib/security/rbac").OrgRole) || "owner",
    isDemo: isDemoView,
  };
}
