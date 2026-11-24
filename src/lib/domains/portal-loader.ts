import { db } from "@/db";
import { users, projects, dashboardWidgets, pageviews } from "@/db/schema";
import { eq, and, desc, sql } from "drizzle-orm";
import { PRIMARY_PORTAL_DOMAIN, isPaidDomainTier } from "@/lib/domains/cloudflare-saas";
import { fetchGitHubRepoStats } from "@/lib/integrations/github";
import { fetchNpmStats } from "@/lib/integrations/npm";
import { fetchPyPiStats } from "@/lib/integrations/pypi";
import { fetchRustCrateStats } from "@/lib/integrations/crates";
import { fetchDockerRepoStats } from "@/lib/integrations/docker";
import { fetchVsCodeStats } from "@/lib/integrations/vscode";
import { fetchMcpStats } from "@/lib/integrations/mcp";
import type { GridWidgetItem } from "@/lib/layout/grid-engine";

export interface ResolvedPortalPayload {
  user: {
    id: string;
    githubUsername: string;
    name: string | null;
    avatarUrl: string | null;
    storageTier: string;
    subdomain: string;
    customDomain: string | null;
    customDomainVerified: boolean;
    brandTitle: string | null;
    brandDescription: string | null;
    brandFaviconUrl: string | null;
    brandOgImageUrl: string | null;
    hidePoweredBy: boolean;
    isWhiteLabeled: boolean;
  };
  projects: Array<{
    id: string;
    name: string;
    slug: string;
    description: string | null;
  }>;
  activeProject: any | null;
  dashboardData: any | null;
}

export async function resolvePortalUserByHostKey(rawHostKey: string) {
  let key = decodeURIComponent(rawHostKey).trim().toLowerCase();
  if (!key) return null;

  if (key.endsWith(`.${PRIMARY_PORTAL_DOMAIN}`)) {
    key = key.slice(0, -(PRIMARY_PORTAL_DOMAIN.length + 1));
  }

  let userRow: any = null;

  if (key.includes(".")) {
    const [byCustomDomain] = await db
      .select()
      .from(users)
      .where(sql`lower(${users.customDomain}) = ${key}`)
      .limit(1);
    userRow = byCustomDomain || null;
  } else {
    const [bySubdomain] = await db
      .select()
      .from(users)
      .where(sql`lower(${users.subdomain}) = ${key}`)
      .limit(1);
    if (bySubdomain) {
      userRow = bySubdomain;
    } else {
      const [byUsername] = await db
        .select()
        .from(users)
        .where(sql`lower(${users.githubUsername}) = ${key}`)
        .limit(1);
      userRow = byUsername || null;
    }
  }

  return userRow;
}

export async function loadPortalData(
  rawHostKey: string,
  requestedProjectSlug?: string
): Promise<ResolvedPortalPayload | null> {
  const userRow = await resolvePortalUserByHostKey(rawHostKey);
  if (!userRow) return null;

  const publicProjects = await db
    .select()
    .from(projects)
    .where(and(eq(projects.userId, userRow.id), eq(projects.isPublic, true)))
    .orderBy(desc(projects.createdAt));

  const activeProject = requestedProjectSlug
    ? publicProjects.find((p) => p.slug === requestedProjectSlug || p.id === requestedProjectSlug) ||
      publicProjects[0] ||
      null
    : publicProjects[0] || null;

  const isWhiteLabeled = Boolean(userRow.hidePoweredBy) && isPaidDomainTier(userRow.storageTier);

  const userSummary = {
    id: userRow.id,
    githubUsername: userRow.githubUsername,
    name: userRow.name,
    avatarUrl: userRow.avatarUrl,
    storageTier: userRow.storageTier,
    subdomain: userRow.subdomain || userRow.githubUsername.toLowerCase(),
    customDomain: userRow.customDomain,
    customDomainVerified: Boolean(userRow.customDomainVerified),
    brandTitle: userRow.brandTitle,
    brandDescription: userRow.brandDescription,
    brandFaviconUrl: userRow.brandFaviconUrl,
    brandOgImageUrl: userRow.brandOgImageUrl,
    hidePoweredBy: Boolean(userRow.hidePoweredBy),
    isWhiteLabeled,
  };

  if (!activeProject) {
    return {
      user: userSummary,
      projects: [],
      activeProject: null,
      dashboardData: null,
    };
  }

  const [
    githubStats,
    npmStats,
    pypiStats,
    rustStats,
    dockerStats,
    vscodeStats,
    mcpStats,
    rawPageviews,
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
    db
      .select()
      .from(pageviews)
      .where(eq(pageviews.projectId, activeProject.id))
      .limit(500)
      .catch(() => []),
    db
      .select()
      .from(dashboardWidgets)
      .where(eq(dashboardWidgets.projectId, activeProject.id))
      .catch(() => []),
  ]);

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

  const initialLayout: GridWidgetItem[] = (rawWidgets || [])
    // Omit private crash/SDK/revenue widgets on public unauthenticated portals
    .filter((w) => !["error_stream", "telemetry_setup", "revenue_stats"].includes(w.widgetType))
    .map((w) => ({
      id: w.widgetType,
      title: w.title,
      x: w.positionX,
      y: w.positionY,
      w: w.width,
      h: w.height,
      isVisible: w.isVisible,
    }));

  // Public dashboard data (scrubs sensitive API keys & webhooks)
  const dashboardData = {
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
      telemetryApiKey: "", // Never expose telemetryApiKey on public portals
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
    revenueStats: null,
    analyticsSummary,
    errors: [],
    initialLayout,
  };

  return {
    user: userSummary,
    projects: publicProjects.map((p) => ({
      id: p.id,
      name: p.name,
      slug: p.slug,
      description: p.description,
    })),
    activeProject,
    dashboardData,
  };
}
