import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { projects, errorEvents } from "@/db/schema";
import { eq, count, and } from "drizzle-orm";
import { readProjectSnapshots, refreshProjectSnapshots } from "@/lib/dashboard/snapshots";
import { REGISTRY_ADAPTERS } from "@/lib/integrations/registry-adapter";

interface BadgeRouteParams {
  params: Promise<{
    type: string;
    slug: string;
  }>;
}

function escapeXml(raw: string): string {
  return String(raw)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function sanitizeSvgColor(raw: string): string {
  return /^#[0-9a-fA-F]{3,8}$/.test(raw) ? raw : "#3b82f6";
}

function formatNumber(num: number): string {
  if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(1)}M`;
  if (num >= 1_000) return `${(num / 1_000).toFixed(1)}k`;
  return num.toLocaleString("en-US");
}

function generateSvgBadge(rawLabel: string, rawValue: string, rawColor: string): string {
  const label = escapeXml(rawLabel);
  const value = escapeXml(rawValue);
  const color = sanitizeSvgColor(rawColor);

  const labelWidth = Math.max(Math.round(rawLabel.length * 7.2 + 16), 40);
  const valueWidth = Math.max(Math.round(rawValue.length * 7.4 + 18), 45);
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

export async function GET(_req: NextRequest, { params }: BadgeRouteParams) {
  try {
    const { type, slug } = await params;
    const cleanSlug = slug.replace(/\.svg$/i, "");

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
          "Content-Type": "image/svg+xml; charset=utf-8",
          "X-Content-Type-Options": "nosniff",
          "Content-Security-Policy": "default-src 'none'; script-src 'none'; object-src 'none'; style-src 'unsafe-inline'; sandbox",
          "Cache-Control": "public, max-age=60, s-maxage=60, stale-while-revalidate=600",
        },
      });
    }

    let label = "devpulse";
    let value = "active";
    let color = "#3b82f6";

    try {
      const badgeType = type.toLowerCase();

      if (badgeType === "downloads") {
        label = "downloads";
        let snap = await readProjectSnapshots(project.id);
        if (snap.presentKeys.size === 0) {
          snap = await refreshProjectSnapshots(project, {
            keys: ["npm", "pypi", "crates", "docker", "vscode", "package_connectors"],
          }).catch(() => snap);
        }

        const extraDownloads = (snap.extraPackages || []).reduce((acc, pkg) => {
          const adapter = REGISTRY_ADAPTERS[pkg.provider];
          if (!adapter?.countsTowardDownloadBadge) return acc;
          return acc + (typeof pkg.metricValue === "number" ? pkg.metricValue : 0);
        }, 0);

        const total =
          Number(snap.npmStats?.downloadsLastMonth || 0) +
          Number(snap.pypiStats?.downloadsLastMonth || 0) +
          Number(snap.rustStats?.totalDownloads || 0) +
          Number(snap.dockerStats?.pullCount || 0) +
          Number(snap.vscodeStats?.installs || 0) +
          extraDownloads;

        value = total > 0 ? formatNumber(total) : "active";
        color = "#10b981";
      } else if (badgeType === "security") {
        label = "security";
        let snap = await readProjectSnapshots(project.id);
        if (snap.presentKeys.size === 0) {
          snap = await refreshProjectSnapshots(project, { keys: ["security"] }).catch(() => snap);
        }
        const summaries = Object.values(snap.packageSecurity || {});
        const totalCves = summaries.reduce((acc, s) => acc + Number(s.advisoryCount || 0), 0);
        if (summaries.length === 0) {
          value = "unchecked";
          color = "#71717a";
        } else if (totalCves === 0) {
          value = "0 CVEs";
          color = "#10b981";
        } else {
          value = `${totalCves} CVE${totalCves === 1 ? "" : "s"}`;
          color = "#ef4444";
        }
      } else if (badgeType === "health") {
        label = "health";
        const [unresolved] = await db
          .select({ count: count() })
          .from(errorEvents)
          .where(
            and(
              eq(errorEvents.projectId, project.id),
              eq(errorEvents.status, "unresolved")
            )
          );

        const unresolvedCount = Number(unresolved?.count || 0);
        if (unresolvedCount === 0) {
          value = "100% crash-free";
          color = "#10b981";
        } else if (unresolvedCount < 3) {
          value = "99.2% healthy";
          color = "#3b82f6";
        } else {
          value = `${unresolvedCount} active issues`;
          color = "#ef4444";
        }
      } else if (badgeType === "stars") {
        label = "stars";
        let snap = await readProjectSnapshots(project.id);
        if (snap.presentKeys.size === 0 && project.githubRepo) {
          snap = await refreshProjectSnapshots(project, { keys: ["github"] }).catch(() => snap);
        }
        value = snap.githubStats ? formatNumber(snap.githubStats.stars) : "0";
        color = "#f59e0b";
      } else {
        label = "devpulse";
        value = "monitored";
        color = "#6366f1";
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
        "Content-Type": "image/svg+xml; charset=utf-8",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'; script-src 'none'; object-src 'none'; style-src 'unsafe-inline'; sandbox",
        "Cache-Control": "public, max-age=300, s-maxage=300, stale-while-revalidate=86400",
      },
    });
  } catch (outerErr: any) {
    console.error("Fatal badge generation error:", outerErr);
    const fallbackSvg = generateSvgBadge("badge", "error", "#ef4444");
    return new NextResponse(fallbackSvg, {
      status: 200,
      headers: {
        "Content-Type": "image/svg+xml; charset=utf-8",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'; script-src 'none'; object-src 'none'; style-src 'unsafe-inline'; sandbox",
        "Cache-Control": "public, max-age=60, s-maxage=60, stale-while-revalidate=600",
      },
    });
  }
}
