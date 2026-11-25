import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { projects, errorEvents } from "@/db/schema";
import { eq, count, and } from "drizzle-orm";
import { fetchNpmStats } from "@/lib/integrations/npm";
import { fetchPyPiStats } from "@/lib/integrations/pypi";
import { fetchGitHubRepoStats } from "@/lib/integrations/github";
import { fetchRustCrateStats } from "@/lib/integrations/crates";
import { fetchGoModuleStats } from "@/lib/integrations/go";

export const dynamic = "force-dynamic";

interface BadgeRouteParams {
  params: Promise<{
    type: string;
    slug: string;
  }>;
}

function formatNumber(num: number): string {
  if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(1)}M`;
  if (num >= 1_000) return `${(num / 1_000).toFixed(1)}k`;
  return num.toLocaleString();
}

function generateSvgBadge(label: string, value: string, color: string): string {
  // Approximate character widths for crisp text alignment
  const labelWidth = Math.max(Math.round(label.length * 7.2 + 16), 40);
  const valueWidth = Math.max(Math.round(value.length * 7.4 + 18), 45);
  const totalWidth = labelWidth + valueWidth;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${totalWidth}" height="20" role="img" aria-label="${label}: ${value}">
  <title>${label}: ${value}</title>
  <linearGradient id="s" x2="0" y2="100%">
    <stop offset="0" stop-color="#bbb" stop-opacity=".1"/>
    <stop offset="1" stop-opacity=".1"/>
  </linearGradient>
  <clipPath id="r">
    <rect width="${totalWidth}" height="20" rx="3" fill="#fff"/>
  </clipPath>
  <g clip-path="url(#r)">
    <rect width="${labelWidth}" height="20" fill="#27272a"/>
    <rect x="${labelWidth}" width="${valueWidth}" height="20" fill="${color}"/>
    <rect width="${totalWidth}" height="20" fill="url(#s)"/>
  </g>
  <g fill="#fff" text-anchor="middle" font-family="Verdana,Geneva,DejaVu Sans,sans-serif" text-rendering="geometricPrecision" font-size="110">
    <text aria-hidden="true" x="${(labelWidth * 10) / 2}" y="150" fill="#010101" fill-opacity=".3" transform="scale(.1)">${label}</text>
    <text x="${(labelWidth * 10) / 2}" y="140" transform="scale(.1)" fill="#fff">${label}</text>
    <text aria-hidden="true" x="${labelWidth * 10 + (valueWidth * 10) / 2}" y="150" fill="#010101" fill-opacity=".3" transform="scale(.1)">${value}</text>
    <text x="${labelWidth * 10 + (valueWidth * 10) / 2}" y="140" transform="scale(.1)" fill="#fff" font-weight="bold">${value}</text>
  </g>
</svg>`;
}

export async function GET(req: NextRequest, { params }: BadgeRouteParams) {
  try {
    const { type, slug } = await params;
    const cleanSlug = slug.replace(/\.svg$/i, "");

    // Find project
    let project = null;
    try {
      const rows = await db
        .select()
        .from(projects)
        .where(eq(projects.slug, cleanSlug))
        .limit(1);
      project = rows[0] || null;
    } catch (dbErr: any) {
      console.error("DB Error querying badge project:", dbErr);
    }

    if (!project) {
      const errorSvg = generateSvgBadge("devpulse", "not found", "#71717a");
      return new NextResponse(errorSvg, {
        status: 404,
        headers: {
          "Content-Type": "image/svg+xml",
          "Cache-Control": "no-cache",
        },
      });
    }

  let label = "devpulse";
  let value = "active";
  let color = "#3b82f6"; // Blue

  try {
    switch (type.toLowerCase()) {
      case "downloads": {
        label = "downloads";
        let total = 0;

        if (project.npmPackage) {
          const npm = await fetchNpmStats(project.npmPackage);
          if (npm) total += npm.downloadsLastMonth;
        }
        if (project.pypiPackage) {
          const pypi = await fetchPyPiStats(project.pypiPackage);
          if (pypi) total += pypi.downloadsLastMonth;
        }
        if (project.rustCrate) {
          const crateStats = await fetchRustCrateStats(project.rustCrate);
          if (crateStats) total += crateStats.recentDownloads || crateStats.totalDownloads;
        }

        value = total > 0 ? `${formatNumber(total)}/mo` : "active";
        color = "#10b981"; // Emerald
        break;
      }

      case "version": {
        label = "version";
        if (project.npmPackage) {
          const npm = await fetchNpmStats(project.npmPackage);
          value = npm?.latestVersion || "latest";
        } else if (project.pypiPackage) {
          const pypi = await fetchPyPiStats(project.pypiPackage);
          value = pypi?.latestVersion || "latest";
        } else if (project.rustCrate) {
          const crateStats = await fetchRustCrateStats(project.rustCrate);
          value = crateStats?.maxVersion || "latest";
        } else if (project.goModule) {
          const goStats = await fetchGoModuleStats(project.goModule);
          value = goStats?.latestVersion || "latest";
        } else {
          value = "latest";
        }
        color = "#06b6d4";
        break;
      }

      case "card": {
        const [npm, pypi, crateStats, gh] = await Promise.all([
          project.npmPackage ? fetchNpmStats(project.npmPackage).catch(() => null) : Promise.resolve(null),
          project.pypiPackage ? fetchPyPiStats(project.pypiPackage).catch(() => null) : Promise.resolve(null),
          project.rustCrate ? fetchRustCrateStats(project.rustCrate).catch(() => null) : Promise.resolve(null),
          project.githubRepo ? fetchGitHubRepoStats(project.githubRepo).catch(() => null) : Promise.resolve(null),
        ]);
        const monthlyDownloads =
          (npm?.downloadsLastMonth || 0) +
          (pypi?.downloadsLastMonth || 0) +
          (crateStats?.recentDownloads || 0);
        const stars = gh?.stars ?? 0;
        const safeName = project.name.replace(/[<>&"]/g, "");
        const cardSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="420" height="118" viewBox="0 0 420 118" role="img" aria-label="${safeName} Telemetry">
  <rect width="420" height="118" rx="14" fill="#09090b" stroke="#27272a" stroke-width="1.5"/>
  <text x="18" y="28" fill="#ffffff" font-family="Inter,Segoe UI,sans-serif" font-size="14" font-weight="700">${safeName}</text>
  <text x="402" y="28" text-anchor="end" fill="#818cf8" font-family="Inter,Segoe UI,sans-serif" font-size="10" font-weight="600">Powered by DevPulse</text>
  <rect x="18" y="44" width="122" height="56" rx="10" fill="#18181b" stroke="#27272a"/>
  <text x="28" y="64" fill="#a1a1aa" font-family="Inter,Segoe UI,sans-serif" font-size="10">Downloads / 90d</text>
  <text x="28" y="88" fill="#34d399" font-family="monospace" font-size="16" font-weight="700">${formatNumber(monthlyDownloads)}</text>
  <rect x="149" y="44" width="122" height="56" rx="10" fill="#18181b" stroke="#27272a"/>
  <text x="159" y="64" fill="#a1a1aa" font-family="Inter,Segoe UI,sans-serif" font-size="10">GitHub Stars</text>
  <text x="159" y="88" fill="#fbbf24" font-family="monospace" font-size="16" font-weight="700">${formatNumber(stars)}</text>
  <rect x="280" y="44" width="122" height="56" rx="10" fill="#18181b" stroke="#27272a"/>
  <text x="290" y="64" fill="#a1a1aa" font-family="Inter,Segoe UI,sans-serif" font-size="10">Open Issues / PRs</text>
  <text x="290" y="88" fill="#60a5fa" font-family="monospace" font-size="16" font-weight="700">${gh ? `${gh.openIssuesCount}/${gh.openPrCount}` : "—"}</text>
</svg>`;
        return new NextResponse(cardSvg, {
          status: 200,
          headers: {
            "Content-Type": "image/svg+xml",
            "Cache-Control": "public, max-age=1800, s-maxage=3600, stale-while-revalidate=86400",
          },
        });
      }

      case "health": {
        label = "health";
        // Calculate crash-free rate based on unresolved crashes
        const [unresolved] = await db
          .select({ count: count() })
          .from(errorEvents)
          .where(
            and(
              eq(errorEvents.projectId, project.id),
              eq(errorEvents.status, "unresolved")
            )
          );

        const unresolvedCount = unresolved?.count || 0;
        if (unresolvedCount === 0) {
          value = "100% crash-free";
          color = "#10b981"; // Emerald
        } else if (unresolvedCount < 3) {
          value = "99.2% healthy";
          color = "#3b82f6"; // Blue
        } else {
          value = `${unresolvedCount} active issues`;
          color = "#ef4444"; // Red
        }
        break;
      }

      case "stars": {
        label = "stars";
        if (project.githubRepo) {
          const gh = await fetchGitHubRepoStats(project.githubRepo);
          value = gh ? formatNumber(gh.stars) : "0";
        } else {
          value = "0";
        }
        color = "#f59e0b"; // Amber
        break;
      }

      case "status":
      default: {
        label = "devpulse";
        value = "monitored";
        color = "#6366f1"; // Indigo
        break;
      }
    }
  } catch (err) {
    console.error(`Error generating badge for ${type}/${slug}:`, err);
    value = "unknown";
    color = "#71717a";
  }

  const svg = generateSvgBadge(label, value, color);

  return new NextResponse(svg, {
    status: 200,
    headers: {
      "Content-Type": "image/svg+xml",
      "Cache-Control": "public, max-age=1800, s-maxage=3600, stale-while-revalidate=86400",
    },
  });
  } catch (outerErr: any) {
    console.error("Fatal badge generation error:", outerErr);
    const fallbackSvg = generateSvgBadge("badge", "error", "#ef4444");
    return new NextResponse(fallbackSvg, {
      status: 200,
      headers: {
        "Content-Type": "image/svg+xml",
        "Cache-Control": "no-cache",
      },
    });
  }
}
