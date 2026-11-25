import { db } from "@/db";
import { projects, errorEvents, users, pageviews, dashboardWidgets, projectReleases } from "@/db/schema";
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
import { DashboardClientView } from "@/components/dashboard/DashboardClientView";
import { DashboardAuthGate } from "@/components/dashboard/DashboardAuthGate";
import { DashboardOnboardingView } from "@/components/dashboard/DashboardOnboardingView";
import type { ProjectSummary } from "@/components/dashboard/ProjectWorkspaceSwitcher";

export const dynamic = "force-dynamic";

interface DashboardPageProps {
  searchParams?: Promise<{
    project?: string;
    demo?: string;
  }>;
}

export default async function DashboardPage(props: DashboardPageProps) {
  const params = (await props.searchParams) || {};
  const requestedProject = params.project;
  const isDemoRequested = params.demo === "1";

  // 1. Authenticate user session bound to real GitHub identity
  const user = await getCurrentUser();

  // 2. Unauthenticated Gate: If not logged in and not viewing demo, show Auth Gate
  if (!user && !isDemoRequested) {
    return <DashboardAuthGate />;
  }

  let activeProject: any = null;
  let userProjects: any[] = [];
  let isDemoView = false;

  if (user) {
    // 3. Strict Tenant & Org RBAC Scoping: Query owned + organization-shared projects
    try {
      userProjects = await listAccessibleProjects(user);
    } catch (dbErr) {
      console.error("Database query error fetching user projects:", dbErr);
      userProjects = [];
    }

    // 4. Onboarding Gate: If logged-in user has 0 projects, render 1-click import onboarding
    if (userProjects.length === 0) {
      return <DashboardOnboardingView user={user} />;
    }

    // 5. Select active project from maintainer's project list
    if (requestedProject) {
      activeProject =
        userProjects.find(
          (p) => p.slug === requestedProject || p.id === requestedProject
        ) || null;
    }

    // Fall back to the user's first/most recent project
    if (!activeProject) {
      activeProject = userProjects[0];
    }
  } else if (isDemoRequested) {
    // Read-only public demo preview
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
      return <DashboardAuthGate />;
    }
  }

  // Enforce tier-based analytics & telemetry retention window (Free: 7d, Pro: 90d, Team: 365d)
  const planDef = getPlanDefinition(user?.storageTier || "free");
  const retentionCutoffIso = new Date(
    Date.now() - planDef.historyDays * 24 * 60 * 60 * 1000
  ).toISOString();

  const userGhToken = user ? await getUserGitHubAccessToken(user.id).catch(() => null) : null;
  const decryptedStripeKey = await decryptSecret(activeProject.stripeApiKey).catch(() => null);
  const decryptedDodoKey = await decryptSecret(activeProject.dodoPaymentsApiKey).catch(() => null);

  // 6. Fetch live registry metrics & genuine revenue data for the active project
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
  ] = await Promise.all([
    activeProject.githubRepo
      ? withEdgeCache(`gh:${activeProject.githubRepo}`, 300, 2600, () =>
          fetchGitHubRepoStats(activeProject.githubRepo!, userGhToken || undefined)
        )
      : Promise.resolve(null),
    activeProject.npmPackage
      ? withEdgeCache(`npm:${activeProject.npmPackage}`, 300, 2600, () =>
          fetchNpmStats(activeProject.npmPackage!)
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
      ? withEdgeCache(`docker:${activeProject.dockerImage}`, 300, 2600, () =>
          fetchDockerRepoStats(activeProject.dockerImage!)
        )
      : Promise.resolve(null),
    activeProject.vscodeExtension
      ? withEdgeCache(`vscode:${activeProject.vscodeExtension}`, 300, 2600, () =>
          fetchVsCodeStats(activeProject.vscodeExtension!)
        )
      : Promise.resolve(null),
    activeProject.mcpServerName
      ? withEdgeCache(`mcp:${activeProject.mcpServerName}:${activeProject.githubRepo || ""}`, 300, 2600, () =>
          fetchMcpStats(activeProject.mcpServerName!, activeProject.githubRepo)
        )
      : Promise.resolve(null),
    withEdgeCache(`rev:${activeProject.id}`, 120, 2600, () =>
      fetchRevenueStats({
        stripeKey: decryptedStripeKey,
        dodoKey: decryptedDodoKey,
        dodoEnv: activeProject.dodoPaymentsEnvironment,
        githubSponsorsUsername: activeProject.githubSponsorsUsername,
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
    createdAt: err.createdAt,
  }));

  // 7. Fetch genuine pageviews strictly scoped to active project & tier retention window
  let rawPageviews: any[] = [];
  try {
    rawPageviews = await db
      .select()
      .from(pageviews)
      .where(
        and(
          eq(pageviews.projectId, activeProject.id),
          gte(pageviews.createdAt, retentionCutoffIso)
        )
      )
      .limit(500);
  } catch {
    rawPageviews = [];
  }

  const refMap: Record<string, number> = {};
  const countryMap: Record<string, number> = {};
  const pathMap: Record<string, number> = {};
  const osMap: Record<string, number> = {};
  const dailyMap: Record<string, number> = {};
  let desktopCount = 0;
  let mobileCount = 0;
  let webHits = 0;
  let appHits = 0;

  for (const pv of rawPageviews) {
    refMap[pv.referrer] = (refMap[pv.referrer] || 0) + 1;
    countryMap[pv.country] = (countryMap[pv.country] || 0) + 1;
    const pKey = pv.eventName && pv.eventName !== "pageview" ? `event:${pv.eventName}` : (pv.path || "/");
    pathMap[pKey] = (pathMap[pKey] || 0) + 1;
    const osKey = pv.os || "Unknown";
    osMap[osKey] = (osMap[osKey] || 0) + 1;
    const dayKey = String(pv.createdAt || "").slice(0, 10) || new Date().toISOString().slice(0, 10);
    dailyMap[dayKey] = (dailyMap[dayKey] || 0) + 1;
    if (pv.device === "mobile" || pv.device === "tablet") mobileCount++;
    else desktopCount++;
    if (pv.sourceType && pv.sourceType !== "web") appHits++;
    else webHits++;
  }

  const analyticsSummary = {
    totalPageviews: rawPageviews.length,
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
    topOs: Object.entries(osMap)
      .map(([os, count]) => ({ os, count }))
      .sort((a, b) => b.count - a.count),
    dailySeries: Object.entries(dailyMap)
      .map(([date, hits]) => ({ date, hits }))
      .sort((a, b) => a.date.localeCompare(b.date))
      .slice(-14),
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
      telemetryApiKey: activeProject.telemetryApiKey,
      discordWebhookUrl: activeProject.discordWebhookUrl,
      slackWebhookUrl: activeProject.slackWebhookUrl,
      telegramBotToken: activeProject.telegramBotToken,
      telegramChatId: activeProject.telegramChatId,
      genericWebhookUrl: activeProject.genericWebhookUrl,
      pagerdutyRoutingKey: activeProject.pagerdutyRoutingKey,
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

  return (
    <DashboardClientView
      initialData={initialData}
      projects={projectSummaries}
      customDomain={user?.customDomainVerified ? user.customDomain : null}
      storageTier={user?.storageTier || "free"}
      accessRole={(activeProject?.accessRole as "owner" | "maintainer" | "viewer") || "owner"}
      isDemo={isDemoView}
    />
  );
}
