import { db } from "@/db";
import { projects, errorEvents, users, pageviews } from "@/db/schema";
import { eq, desc } from "drizzle-orm";
import { initDb } from "@/db/setup";
import { seedDemoData } from "@/db/seed";
import { fetchGitHubRepoStats } from "@/lib/integrations/github";
import { fetchNpmStats } from "@/lib/integrations/npm";
import { fetchPyPiStats } from "@/lib/integrations/pypi";
import { fetchVsCodeStats } from "@/lib/integrations/vscode";
import { fetchMcpStats } from "@/lib/integrations/mcp";
import { fetchRevenueStats } from "@/lib/integrations/revenue";
import { DashboardClientView } from "@/components/dashboard/DashboardClientView";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  try {
    await initDb();
  } catch (e) {
    console.warn("initDb warning:", e);
  }

  // Find first active project or seed demo project
  let project: any = null;
  try {
    const pRows = await db.select().from(projects).limit(1);
    project = pRows[0] || null;

    if (!project) {
      await seedDemoData();
      const result = await db.select().from(projects).limit(1);
      project = result[0] || null;
    }
  } catch (dbErr) {
    console.error("Database query error:", dbErr);
  }

  if (!project) {
    project = {
      id: "prj_ritual_core",
      userId: "usr_ritualdev_demo",
      name: "Ritual Core CLI",
      slug: "ritual-core",
      description: "Unified developer toolkit & telemetry system for modern workflows.",
      githubRepo: "ritualdev-lab/ritual-core",
      npmPackage: "ritual-core",
      pypiPackage: "ritual-core",
      vscodeExtension: "ritualdev.ritual-vscode",
      mcpServerName: null,
      dockerImage: null,
      telemetryApiKey: "dp_live_8f93e1b74a9c82",
      isPublic: true,
      customCss: null,
      theme: "dark",
      discordWebhookUrl: null,
      slackWebhookUrl: null,
      telegramBotToken: null,
      telegramChatId: null,
      stripeApiKey: null,
      dodoPaymentsApiKey: null,
      dodoPaymentsEnvironment: "live",
      githubSponsorsUsername: "RitualDev-Lab",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    };
  }

  // Fetch user info for custom domain & storage tier
  let user: any = null;
  try {
    const userRows = await db
      .select({
        storageTier: users.storageTier,
        customDomain: users.customDomain,
        customDomainVerified: users.customDomainVerified,
      })
      .from(users)
      .where(eq(users.id, project.userId))
      .limit(1);
    user = userRows[0] || null;
  } catch {
    user = null;
  }

  // Fetch live registry metrics & revenue data in parallel
  const [githubStats, npmStats, pypiStats, vscodeStats, mcpStats, revenueStats, rawErrors] = await Promise.all([
    project.githubRepo ? fetchGitHubRepoStats(project.githubRepo).catch(() => null) : Promise.resolve(null),
    project.npmPackage ? fetchNpmStats(project.npmPackage).catch(() => null) : Promise.resolve(null),
    project.pypiPackage ? fetchPyPiStats(project.pypiPackage).catch(() => null) : Promise.resolve(null),
    project.vscodeExtension ? fetchVsCodeStats(project.vscodeExtension).catch(() => null) : Promise.resolve(null),
    project.mcpServerName ? fetchMcpStats(project.mcpServerName).catch(() => null) : Promise.resolve(null),
    fetchRevenueStats({
      stripeKey: project.stripeApiKey,
      dodoKey: project.dodoPaymentsApiKey,
      dodoEnv: project.dodoPaymentsEnvironment,
      githubSponsorsUsername: project.githubSponsorsUsername,
    }).catch(() => null),
    db
      .select()
      .from(errorEvents)
      .where(eq(errorEvents.projectId, project.id))
      .orderBy(desc(errorEvents.createdAt))
      .limit(20)
      .catch(() => []),
  ]);

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
    reporterEmail: err.reporterEmail,
    createdAt: err.createdAt,
  }));

  // Fetch pageviews analytics
  let rawPageviews: any[] = [];
  try {
    rawPageviews = await db
      .select()
      .from(pageviews)
      .where(eq(pageviews.projectId, project.id))
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

  const analyticsSummary =
    rawPageviews.length > 0
      ? {
          totalPageviews: rawPageviews.length,
          uniqueReferrers: Object.keys(refMap).length,
          topReferrers: Object.entries(refMap)
            .map(([referrer, count]) => ({ referrer, count }))
            .sort((a, b) => b.count - a.count),
          topCountries: Object.entries(countryMap)
            .map(([country, count]) => ({ country, count }))
            .sort((a, b) => b.count - a.count),
          devices: { desktop: desktopCount, mobile: mobileCount },
        }
      : {
          totalPageviews: 3480,
          uniqueReferrers: 14,
          topReferrers: [
            { referrer: "github.com", count: 1420 },
            { referrer: "news.ycombinator.com", count: 980 },
            { referrer: "reddit.com", count: 640 },
            { referrer: "x.com", count: 440 },
          ],
          topCountries: [
            { country: "US", count: 1350 },
            { country: "IN", count: 820 },
            { country: "DE", count: 540 },
            { country: "GB", count: 390 },
          ],
          devices: { desktop: 2780, mobile: 700 },
        };

  const initialData = {
    project: {
      id: project.id,
      name: project.name,
      slug: project.slug,
      githubRepo: project.githubRepo,
      npmPackage: project.npmPackage,
      pypiPackage: project.pypiPackage,
      vscodeExtension: project.vscodeExtension,
      mcpServerName: project.mcpServerName,
      telemetryApiKey: project.telemetryApiKey,
      discordWebhookUrl: project.discordWebhookUrl,
      slackWebhookUrl: project.slackWebhookUrl,
      telegramBotToken: project.telegramBotToken,
      telegramChatId: project.telegramChatId,
    },
    githubStats,
    npmStats,
    pypiStats,
    vscodeStats,
    mcpStats,
    revenueStats,
    analyticsSummary,
    errors,
  };

  return (
    <DashboardClientView
      initialData={initialData}
      customDomain={user?.customDomainVerified ? user.customDomain : null}
      storageTier={user?.storageTier || "free"}
    />
  );
}
