import { db } from "@/db";
import { projects, errorEvents, users, pageviews, dashboardWidgets } from "@/db/schema";
import { eq, desc, and, gte } from "drizzle-orm";
import { initDb } from "@/db/setup";
import { getCurrentUser } from "@/lib/auth";
import { getPlanDefinition } from "@/lib/billing/plans";
import { fetchGitHubRepoStats } from "@/lib/integrations/github";
import { fetchNpmStats } from "@/lib/integrations/npm";
import { fetchPyPiStats } from "@/lib/integrations/pypi";
import { fetchRustCrateStats } from "@/lib/integrations/crates";
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
  try {
    await initDb();
  } catch (e) {
    console.warn("initDb warning:", e);
  }

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
    // 3. Strict Tenant Scoping: Query projects belonging ONLY to this user
    try {
      userProjects = await db
        .select()
        .from(projects)
        .where(eq(projects.userId, user.id))
        .orderBy(desc(projects.createdAt));
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

  // 6. Fetch live registry metrics & genuine revenue data for the active project
  const [
    githubStats,
    npmStats,
    pypiStats,
    rustStats,
    dockerStats,
    vscodeStats,
    mcpStats,
    revenueStats,
    rawErrors,
    rawWidgets,
  ] = await Promise.all([
    activeProject.githubRepo
      ? fetchGitHubRepoStats(activeProject.githubRepo).catch(() => null)
      : Promise.resolve(null),
    activeProject.npmPackage
      ? fetchNpmStats(activeProject.npmPackage).catch(() => null)
      : Promise.resolve(null),
    activeProject.pypiPackage
      ? fetchPyPiStats(activeProject.pypiPackage).catch(() => null)
      : Promise.resolve(null),
    activeProject.rustCrate
      ? fetchRustCrateStats(activeProject.rustCrate).catch(() => null)
      : Promise.resolve(null),
    activeProject.dockerImage
      ? fetchDockerRepoStats(activeProject.dockerImage).catch(() => null)
      : Promise.resolve(null),
    activeProject.vscodeExtension
      ? fetchVsCodeStats(activeProject.vscodeExtension).catch(() => null)
      : Promise.resolve(null),
    activeProject.mcpServerName
      ? fetchMcpStats(activeProject.mcpServerName).catch(() => null)
      : Promise.resolve(null),
    fetchRevenueStats({
      stripeKey: activeProject.stripeApiKey,
      dodoKey: activeProject.dodoPaymentsApiKey,
      dodoEnv: activeProject.dodoPaymentsEnvironment,
      githubSponsorsUsername: activeProject.githubSponsorsUsername,
    }).catch(() => null),
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
      .limit(20)
      .catch(() => []),
    db
      .select()
      .from(dashboardWidgets)
      .where(eq(dashboardWidgets.projectId, activeProject.id))
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
  let desktopCount = 0;
  let mobileCount = 0;

  for (const pv of rawPageviews) {
    refMap[pv.referrer] = (refMap[pv.referrer] || 0) + 1;
    countryMap[pv.country] = (countryMap[pv.country] || 0) + 1;
    if (pv.device === "mobile" || pv.device === "tablet") mobileCount++;
    else desktopCount++;
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
      stripeApiKey: activeProject.stripeApiKey,
      dodoPaymentsApiKey: activeProject.dodoPaymentsApiKey,
      theme: activeProject.theme,
      customCss: activeProject.customCss,
    },
    githubStats,
    npmStats,
    pypiStats,
    rustStats,
    dockerStats,
    vscodeStats,
    mcpStats,
    revenueStats,
    analyticsSummary,
    errors,
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
      isDemo={isDemoView}
    />
  );
}
