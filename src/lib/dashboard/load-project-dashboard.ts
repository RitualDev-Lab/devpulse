import { db } from "@/db";
import { dashboardWidgets, errorEvents, pageviews, projects } from "@/db/schema";
import { desc, eq } from "drizzle-orm";
import { fetchGitHubRepoStats } from "@/lib/integrations/github";
import { fetchNpmStats } from "@/lib/integrations/npm";
import { fetchPyPiStats } from "@/lib/integrations/pypi";
import { fetchRustCrateStats } from "@/lib/integrations/crates";
import { fetchGoModuleStats } from "@/lib/integrations/go";
import { fetchDockerRepoStats } from "@/lib/integrations/docker";
import { fetchVsCodeStats } from "@/lib/integrations/vscode";
import { fetchMcpStats } from "@/lib/integrations/mcp";
import { fetchRevenueStats } from "@/lib/integrations/revenue";
import type { DashboardData } from "@/components/dashboard/DragDropGrid";
import type { WidgetLayoutItem } from "@/app/api/v1/projects/layout/route";

type ProjectRow = typeof projects.$inferSelect;

export async function loadProjectDashboardData(
  activeProject: ProjectRow,
  options: { includePrivate?: boolean } = {}
): Promise<DashboardData> {
  const includePrivate = options.includePrivate === true;

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
    rawPageviews,
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
    activeProject.goModule
      ? fetchGoModuleStats(activeProject.goModule).catch(() => null)
      : Promise.resolve(null),
    activeProject.dockerImage
      ? fetchDockerRepoStats(activeProject.dockerImage).catch(() => null)
      : Promise.resolve(null),
    activeProject.vscodeExtension
      ? fetchVsCodeStats(activeProject.vscodeExtension).catch(() => null)
      : Promise.resolve(null),
    activeProject.mcpServerName
      ? fetchMcpStats(activeProject.mcpServerName, activeProject.githubRepo).catch(() => null)
      : Promise.resolve(null),
    includePrivate
      ? fetchRevenueStats({
          stripeKey: activeProject.stripeApiKey,
          dodoKey: activeProject.dodoPaymentsApiKey,
          dodoEnv: activeProject.dodoPaymentsEnvironment,
          githubSponsorsUsername: activeProject.githubSponsorsUsername,
        }).catch(() => null)
      : Promise.resolve(null),
    db
      .select()
      .from(errorEvents)
      .where(eq(errorEvents.projectId, activeProject.id))
      .orderBy(desc(errorEvents.createdAt))
      .limit(20)
      .catch(() => []),
    db
      .select()
      .from(dashboardWidgets)
      .where(eq(dashboardWidgets.projectId, activeProject.id))
      .catch(() => []),
    db
      .select()
      .from(pageviews)
      .where(eq(pageviews.projectId, activeProject.id))
      .limit(500)
      .catch(() => []),
  ]);

  const errors = (rawErrors || []).map((err) => ({
    id: err.id,
    errorName: err.errorName,
    message: err.message,
    // Omit stack traces and reporter emails from public read-only views
    stackTrace: includePrivate ? err.stackTrace : null,
    runtime: err.runtime,
    version: err.version,
    os: err.os,
    environment: err.environment,
    status: err.status,
    attachmentUrl: includePrivate ? err.attachmentUrl : null,
    reporterEmail: includePrivate ? err.reporterEmail : null,
    createdAt: err.createdAt,
  }));

  const refMap: Record<string, number> = {};
  const countryMap: Record<string, number> = {};
  let desktopCount = 0;
  let mobileCount = 0;

  for (const pv of rawPageviews || []) {
    refMap[pv.referrer] = (refMap[pv.referrer] || 0) + 1;
    countryMap[pv.country] = (countryMap[pv.country] || 0) + 1;
    if (pv.device === "mobile" || pv.device === "tablet") mobileCount++;
    else desktopCount++;
  }

  const analyticsSummary = {
    totalPageviews: (rawPageviews || []).length,
    uniqueReferrers: Object.keys(refMap).length,
    topReferrers: Object.entries(refMap)
      .map(([referrer, count]) => ({ referrer, count }))
      .sort((a, b) => b.count - a.count),
    topCountries: Object.entries(countryMap)
      .map(([country, count]) => ({ country, count }))
      .sort((a, b) => b.count - a.count),
    devices: { desktop: desktopCount, mobile: mobileCount },
  };

  const initialLayout: WidgetLayoutItem[] = (rawWidgets || []).map((w) => ({
    widgetType: w.widgetType,
    title: w.title,
    x: w.positionX,
    y: w.positionY,
    w: w.width === 1 ? 4 : w.width === 2 ? 8 : w.width === 3 ? 12 : w.width,
    h: Math.max(1, Math.min(3, w.height || 1)),
    isVisible: w.isVisible,
  }));

  return {
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
      telemetryApiKey: includePrivate ? activeProject.telemetryApiKey : undefined,
      isPublic: activeProject.isPublic ?? true,
      theme: activeProject.theme || "dark",
      customCss: activeProject.customCss || "",
      discordWebhookUrl: includePrivate ? activeProject.discordWebhookUrl : undefined,
      slackWebhookUrl: includePrivate ? activeProject.slackWebhookUrl : undefined,
      telegramBotToken: includePrivate ? activeProject.telegramBotToken : undefined,
      telegramChatId: includePrivate ? activeProject.telegramChatId : undefined,
      hasStripeKey: Boolean(activeProject.stripeApiKey),
      hasDodoKey: Boolean(activeProject.dodoPaymentsApiKey),
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
    initialLayout,
  };
}
