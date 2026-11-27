import { db } from "@/db";
import { errorEvents, pageviews, projects } from "@/db/schema";
import { desc, eq, sql } from "drizzle-orm";
import { readProjectSnapshots } from "@/lib/dashboard/snapshots";
import { DEMO_PROJECT_ID } from "@/lib/security/demo-project";

export interface PublicShowcasePreview {
  mode: "live_demo" | "illustrative_sample";
  badgeLabel: string;
  workspaceName: string;
  repoSlug: string;
  stars: number;
  forks: number;
  openIssues: number;
  monthlyDownloads: number;
  npmMonthly: number;
  pypiMonthly: number;
  dockerPulls: number;
  mrrDollars: number;
  activeSubscribers: number;
  revenue30dDollars: number;
  recentCrashTitle: string;
  recentCrashSubtext: string;
  pageviewsCount: number;
}

const FALLBACK_SAMPLE_PREVIEW: PublicShowcasePreview = {
  mode: "illustrative_sample",
  badgeLabel: "Illustrative Preview · Sample Metrics",
  workspaceName: "devpulse",
  repoSlug: "RitualDev-Lab/devpulse",
  stars: 1,
  forks: 0,
  openIssues: 0,
  monthlyDownloads: 8940,
  npmMonthly: 8940,
  pypiMonthly: 0,
  dockerPulls: 0,
  mrrDollars: 0,
  activeSubscribers: 0,
  revenue30dDollars: 0,
  recentCrashTitle: "ConnectionTimeout: Sample trace awaiting live telemetry",
  recentCrashSubtext: "Illustrative sample event • Open /dashboard?demo=1 for interactive stream",
  pageviewsCount: 0,
};

/**
 * Loads the public homepage preview directly from the same demo snapshot powering
 * `/dashboard?demo=1`, falling back to clearly labeled sample metrics if DB is unavailable.
 */
export async function loadPublicShowcasePreview(): Promise<PublicShowcasePreview> {
  try {
    const [[proj], bundle, [latestErr], [pvCount]] = await Promise.all([
      db
        .select({
          id: projects.id,
          name: projects.name,
          slug: projects.slug,
          githubRepo: projects.githubRepo,
        })
        .from(projects)
        .where(eq(projects.id, DEMO_PROJECT_ID))
        .limit(1),
      readProjectSnapshots(DEMO_PROJECT_ID),
      db
        .select({
          errorName: errorEvents.errorName,
          message: errorEvents.message,
          runtime: errorEvents.runtime,
          version: errorEvents.version,
        })
        .from(errorEvents)
        .where(eq(errorEvents.projectId, DEMO_PROJECT_ID))
        .orderBy(desc(errorEvents.createdAt))
        .limit(1),
      db
        .select({ count: sql<number>`count(*)` })
        .from(pageviews)
        .where(eq(pageviews.projectId, DEMO_PROJECT_ID)),
    ]);

    if (!proj) return FALLBACK_SAMPLE_PREVIEW;

    const npmMonthly = bundle.npmStats?.downloadsLastMonth || 0;
    const pypiMonthly = bundle.pypiStats?.downloadsLastMonth || 0;
    const dockerPulls = bundle.dockerStats?.pullCount || 0;

    return {
      mode: "live_demo",
      badgeLabel: "Public Demo Snapshot · Synced with /dashboard?demo=1",
      workspaceName: proj.name || "devpulse",
      repoSlug: proj.githubRepo || "RitualDev-Lab/devpulse",
      stars: bundle.githubStats?.stars ?? 0,
      forks: bundle.githubStats?.forks ?? 0,
      openIssues: bundle.githubStats?.openIssuesCount ?? 0,
      monthlyDownloads: npmMonthly + pypiMonthly,
      npmMonthly,
      pypiMonthly,
      dockerPulls,
      mrrDollars: bundle.revenueStats?.mrr ? Math.round(bundle.revenueStats.mrr) : 0,
      activeSubscribers: bundle.revenueStats?.activeSubscriptions ?? 0,
      revenue30dDollars: bundle.revenueStats?.netVolume30Days
        ? Math.round(bundle.revenueStats.netVolume30Days)
        : 0,
      recentCrashTitle: latestErr
        ? `${latestErr.errorName}: ${latestErr.message.slice(0, 72)}`
        : "No unresolved crashes recorded in demo snapshot",
      recentCrashSubtext: latestErr
        ? `Runtime: ${latestErr.runtime}${latestErr.version ? ` • v${latestErr.version}` : ""}`
        : "Live crash alerting wired for Discord, Telegram & Slack",
      pageviewsCount: Number(pvCount?.count || 0),
    };
  } catch {
    return FALLBACK_SAMPLE_PREVIEW;
  }
}
