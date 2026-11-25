import { cache } from "react";
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
import {
  listAccessibleProjects,
  roleAllowsSecurityAdmin,
  roleAllowsWrite,
  type OrgRole,
} from "@/lib/security/rbac";
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
import { readProjectSnapshots, refreshProjectSnapshots } from "@/lib/dashboard/snapshots";
import { loadAnalyticsSummarySql } from "@/lib/analytics/rollup";
import type { ProjectSummary } from "@/components/dashboard/ProjectWorkspaceSwitcher";
import type { DashboardData } from "@/components/dashboard/DragDropGrid";
import { DEMO_PROJECT_ID, isPublicDemoProject } from "@/lib/security/demo-project";

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
    staleSnapshots?: boolean;
    snapshotUpdatedAt?: string | null;
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

export type DashboardLoadScope =
  | "full"
  | "overview"
  | "github"
  | "packages"
  | "analytics"
  | "crashes"
  | "uptime"
  | "revenue"
  | "settings"
  | "minimal";

export interface DashboardShellMeta {
  user: {
    id: string;
    githubUsername: string;
    storageTier: string;
    customDomain: string | null;
    customDomainVerified: boolean;
  } | null;
  projects: ProjectSummary[];
  demoProject: ProjectSummary | null;
  storageTier: string;
  customDomain: string | null;
}

function toProjectSummary(p: any, includeTelemetryKey = false): ProjectSummary {
  return {
    id: p.id,
    name: p.name,
    slug: p.slug,
    githubRepo: p.githubRepo,
    npmPackage: p.npmPackage,
    pypiPackage: p.pypiPackage,
    rustCrate: p.rustCrate,
    goModule: p.goModule,
    dockerImage: p.dockerImage,
    telemetryApiKey: includeTelemetryKey ? p.telemetryApiKey : null,
  };
}

/**
 * Lightweight per-request deduplicated loader for `dashboard/layout.tsx`.
 * Zero external API calls and zero heavy telemetry queries so switching
 * sidebar tabs keeps the sidebar mounted with minimal latency.
 */
export const loadDashboardShellMeta = cache(async (): Promise<DashboardShellMeta> => {
  const user = await getCurrentUser();

  if (user) {
    const userProjects = await listAccessibleProjects(user).catch(() => []);
    return {
      user: {
        id: user.id,
        githubUsername: user.githubUsername,
        storageTier: user.storageTier || "free",
        customDomain: user.customDomain,
        customDomainVerified: user.customDomainVerified,
      },
      projects: userProjects.map((p) =>
        toProjectSummary(p, roleAllowsSecurityAdmin((p as any).accessRole || "viewer"))
      ),
      demoProject: null,
      storageTier: user.storageTier || "free",
      customDomain: user.customDomainVerified ? user.customDomain : null,
    };
  }

  const demoRows = isPublicDemoProject(DEMO_PROJECT_ID)
    ? await db
        .select()
        .from(projects)
        .where(eq(projects.id, DEMO_PROJECT_ID))
        .limit(1)
        .catch(() => [])
    : [];

  return {
    user: null,
    projects: [],
    demoProject: demoRows[0] ? toProjectSummary(demoRows[0], false) : null,
    storageTier: "free",
    customDomain: null,
  };
});

export async function loadDashboardWorkspace(
  searchParams?: {
    project?: string;
    demo?: string;
  },
  options?: {
    scope?: DashboardLoadScope;
  }
): Promise<LoadedWorkspaceResult> {
  const scope: DashboardLoadScope = options?.scope || "full";
  const requestedProject = searchParams?.project;
  const PUBLIC_SHOWCASE_SLUGS = new Set(["devpulse", "devshelf"]);
  const isDemoRequested =
    searchParams?.demo === "1" ||
    Boolean(requestedProject && PUBLIC_SHOWCASE_SLUGS.has(requestedProject.toLowerCase()));

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
      const targetSlug = requestedProject?.toLowerCase();
      if (targetSlug && PUBLIC_SHOWCASE_SLUGS.has(targetSlug)) {
        const matched = await db
          .select()
          .from(projects)
          .where(and(eq(projects.slug, targetSlug), eq(projects.isPublic, true)))
          .limit(1);
        activeProject = matched[0] || null;
      }
      if (!activeProject && isPublicDemoProject(DEMO_PROJECT_ID)) {
        const demoRows = await db
          .select()
          .from(projects)
          .where(eq(projects.id, DEMO_PROJECT_ID))
          .limit(1);
        activeProject = demoRows[0] || null;
      }
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

  const needAll = scope === "full" || scope === "overview";
  const needGithub = needAll || scope === "github";
  const needPackages = needAll || scope === "packages";
  const needAnalytics = needAll || scope === "analytics";
  const needCrashes = needAll || scope === "crashes";
  const needUptime = needAll || scope === "uptime";
  const needRevenue = needAll || scope === "revenue";
  const needSettings = needAll || scope === "settings";
  const needConnectors = needRevenue || needPackages || needSettings;
  const needDailyMetrics = needGithub || needPackages || needRevenue;
  const needExternal = needGithub || needPackages || needRevenue;

  // Single parallel DB wave (~40-100ms total): snapshots + connectors + hot indexed telemetry tables
  const [
    initialSnapshotBundle,
    rawConnectors,
    rawErrors,
    rawWidgets,
    rawReleases,
    rawMonitors,
    rawUptimeChecks,
    rawDailyMetrics,
    analyticsSummarySql,
    rawSourceMaps,
  ] = await Promise.all([
    needExternal ? readProjectSnapshots(activeProject.id) : Promise.resolve(null),
    needConnectors
      ? db
          .select()
          .from(projectConnectors)
          .where(eq(projectConnectors.projectId, activeProject.id))
          .orderBy(desc(projectConnectors.createdAt))
          .limit(30)
          .catch(() => [])
      : Promise.resolve([]),
    needCrashes
      ? db
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
          .catch(() => [])
      : Promise.resolve([]),
    needAll
      ? db
          .select()
          .from(dashboardWidgets)
          .where(eq(dashboardWidgets.projectId, activeProject.id))
          .catch(() => [])
      : Promise.resolve([]),
    needGithub || needCrashes
      ? db
          .select()
          .from(projectReleases)
          .where(eq(projectReleases.projectId, activeProject.id))
          .orderBy(desc(projectReleases.releasedAt))
          .limit(10)
          .catch(() => [])
      : Promise.resolve([]),
    needUptime
      ? db
          .select()
          .from(uptimeMonitors)
          .where(eq(uptimeMonitors.projectId, activeProject.id))
          .orderBy(desc(uptimeMonitors.createdAt))
          .limit(15)
          .catch(() => [])
      : Promise.resolve([]),
    needUptime
      ? db
          .select()
          .from(uptimeChecks)
          .where(eq(uptimeChecks.projectId, activeProject.id))
          .orderBy(desc(uptimeChecks.checkedAt))
          .limit(120)
          .catch(() => [])
      : Promise.resolve([]),
    needDailyMetrics
      ? db
          .select()
          .from(dailyMetrics)
          .where(eq(dailyMetrics.projectId, activeProject.id))
          .orderBy(desc(dailyMetrics.date))
          .limit(180)
          .catch(() => [])
      : Promise.resolve([]),
    needAnalytics
      ? loadAnalyticsSummarySql(activeProject.id, retentionCutoffIso).catch(() => null)
      : Promise.resolve(null),
    needCrashes || needSettings
      ? db
          .select()
          .from(sourceMaps)
          .where(eq(sourceMaps.projectId, activeProject.id))
          .orderBy(desc(sourceMaps.createdAt))
          .limit(40)
          .catch(() => [])
      : Promise.resolve([]),
  ]);

  // Serve Turso DB snapshots immediately when present; only warm inline once for brand-new projects
  let snapshotBundle = initialSnapshotBundle;
  if (needExternal && (!snapshotBundle || snapshotBundle.presentKeys.size === 0)) {
    snapshotBundle = await refreshProjectSnapshots(activeProject, {
      userIdForOAuth: user?.id || null,
    }).catch(() => snapshotBundle);
  }

  const githubStats = needGithub ? snapshotBundle?.githubStats ?? null : null;
  const npmStats = needPackages ? snapshotBundle?.npmStats ?? null : null;
  const pypiStats = needPackages ? snapshotBundle?.pypiStats ?? null : null;
  const rustStats = needPackages ? snapshotBundle?.rustStats ?? null : null;
  const goStats = needPackages ? snapshotBundle?.goStats ?? null : null;
  const dockerStats = needPackages ? snapshotBundle?.dockerStats ?? null : null;
  const vscodeStats = needPackages ? snapshotBundle?.vscodeStats ?? null : null;
  const mcpStats = needPackages ? snapshotBundle?.mcpStats ?? null : null;
  const revenueStats = needRevenue ? snapshotBundle?.revenueStats ?? null : null;
  const staleSnapshots = Boolean(needExternal && snapshotBundle?.isStale);
  const snapshotUpdatedAt = snapshotBundle?.snapshotUpdatedAt ?? null;

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

  const analyticsSummary = analyticsSummarySql || {
    totalPageviews: 0,
    dau: 0,
    wau: 0,
    mau: 0,
    uniqueReferrers: 0,
    topReferrers: [],
    topCountries: [],
    topPaths: [],
    topPages: [],
    topCustomEvents: [],
    topOs: [],
    dailySeries: [],
    dailyCohorts: [],
    sources: { web: 0, app: 0 },
    devices: { desktop: 0, mobile: 0 },
  };

  const effectiveRole: OrgRole = isDemoView
    ? "viewer"
    : ((activeProject?.accessRole as OrgRole) || "owner");
  const canManageSecrets = !isDemoView && roleAllowsSecurityAdmin(effectiveRole);
  const canSeeWebhookStatus = !isDemoView && roleAllowsWrite(effectiveRole);

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
      hasNpmToken: canSeeWebhookStatus ? Boolean(activeProject.npmTokenEncrypted) : false,
      hasGithubToken: canSeeWebhookStatus ? Boolean(activeProject.githubTokenEncrypted) : false,
      telemetryApiKey: canManageSecrets ? activeProject.telemetryApiKey : null,
      publicWriteKey: activeProject.publicWriteKey || activeProject.slug,
      hasTelemetryApiKey: Boolean(activeProject.telemetryApiKey),
      // Strictly gate raw webhook URLs, bot tokens, routing keys, and billing keys out of RSC payloads
      discordWebhookUrl: null,
      slackWebhookUrl: null,
      telegramBotToken: null,
      telegramChatId: null,
      genericWebhookUrl: null,
      pagerdutyRoutingKey: null,
      teamsWebhookUrl: null,
      notificationEmail: null,
      hasDiscordWebhook: canSeeWebhookStatus ? Boolean(activeProject.discordWebhookUrl) : false,
      hasSlackWebhook: canSeeWebhookStatus ? Boolean(activeProject.slackWebhookUrl) : false,
      hasTelegramWebhook: canSeeWebhookStatus
        ? Boolean(activeProject.telegramBotToken && activeProject.telegramChatId)
        : false,
      hasGenericWebhook: canSeeWebhookStatus ? Boolean(activeProject.genericWebhookUrl) : false,
      hasPagerDuty: canSeeWebhookStatus ? Boolean(activeProject.pagerdutyRoutingKey) : false,
      hasOpsgenieApiKey: canSeeWebhookStatus ? Boolean(activeProject.opsgenieApiKeyEncrypted) : false,
      hasTeamsWebhook: canSeeWebhookStatus ? Boolean(activeProject.teamsWebhookUrl) : false,
      hasNotificationEmail: canSeeWebhookStatus ? Boolean(activeProject.notificationEmail) : false,
      emailProvider: canSeeWebhookStatus ? activeProject.emailProvider : "resend",
      hasEmailApiKey: canSeeWebhookStatus ? Boolean(activeProject.emailApiKeyEncrypted) : false,
      digestEnabled: canSeeWebhookStatus ? activeProject.digestEnabled : false,
      stripeApiKey: canManageSecrets && activeProject.stripeApiKey ? "••••••••" : null,
      dodoPaymentsApiKey: canManageSecrets && activeProject.dodoPaymentsApiKey ? "••••••••" : null,
      hasStripeKey: canManageSecrets ? Boolean(activeProject.stripeApiKey) : false,
      hasDodoKey: canManageSecrets ? Boolean(activeProject.dodoPaymentsApiKey) : false,
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
    staleSnapshots,
    snapshotUpdatedAt,
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
          : null;
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

  const projectSummaries: ProjectSummary[] = userProjects.map((p) =>
    toProjectSummary(p, !isDemoView && roleAllowsSecurityAdmin((p as any).accessRole || "viewer"))
  );

  return {
    status: "ready",
    user,
    activeProject: initialData.project,
    initialData,
    projects: projectSummaries,
    customDomain: user?.customDomainVerified ? user.customDomain : null,
    storageTier: user?.storageTier || "free",
    accessRole: effectiveRole,
    isDemo: isDemoView,
  };
}
