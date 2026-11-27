import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { pageviews, projects } from "@/db/schema";
import { eq } from "drizzle-orm";
import { buildVisitorId } from "@/lib/analytics/visitor";
import { PUBLIC_APP_URL } from "@/lib/config/app-url";

export const dynamic = "force-dynamic";

function resolveSafeTargetUrl(
  project: typeof projects.$inferSelect,
  target: string
): string {
  switch (target.toLowerCase()) {
    case "npm":
      if (project.npmPackage) {
        return `https://www.npmjs.com/package/${encodeURIComponent(project.npmPackage).replace(/%2F/gi, "/").replace(/^%40/, "@")}`;
      }
      break;
    case "pypi":
      if (project.pypiPackage) {
        return `https://pypi.org/project/${encodeURIComponent(project.pypiPackage)}/`;
      }
      break;
    case "crates":
      if (project.rustCrate) {
        return `https://crates.io/crates/${encodeURIComponent(project.rustCrate)}`;
      }
      break;
    case "go":
      if (project.goModule) {
        return `https://pkg.go.dev/${project.goModule}`;
      }
      break;
    case "docker":
      if (project.dockerImage) {
        return project.dockerImage.includes("/")
          ? `https://hub.docker.com/r/${project.dockerImage}`
          : `https://hub.docker.com/_/${project.dockerImage}`;
      }
      break;
    case "github":
      if (project.githubRepo) {
        return `https://github.com/${project.githubRepo}`;
      }
      break;
  }
  return `${PUBLIC_APP_URL}/portal/${encodeURIComponent(project.slug)}`;
}

/**
 * Scarf-style Zero-PII Package & Release Adoption Gateway
 * Records aggregate anonymized visitor hash, OS/platform, and package target without storing raw IPs.
 */
export async function GET(
  req: NextRequest,
  context: { params: Promise<{ slug: string }> }
) {
  const { slug } = await context.params;
  const target = (req.nextUrl.searchParams.get("target") || "github").trim();
  const version = (req.nextUrl.searchParams.get("ver") || "latest").slice(0, 48);
  const format = (req.nextUrl.searchParams.get("format") || "redirect").toLowerCase();

  const [project] = await db
    .select()
    .from(projects)
    .where(eq(projects.slug, slug))
    .limit(1);

  if (!project) {
    return NextResponse.json({ error: "Project gateway slug not found" }, { status: 404 });
  }

  const destination = resolveSafeTargetUrl(project, target);
  const ua = req.headers.get("user-agent") || "unknown";
  const rawIp =
    req.headers.get("cf-connecting-ip") ||
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    "0.0.0.0";
  const country = req.headers.get("cf-ipcountry") || "XX";

  const anonVisitorId = await buildVisitorId({
    secret: process.env.VISITOR_HASH_SECRET || process.env.SESSION_SECRET || "devpulse-gateway",
    projectId: project.id,
    ip: rawIp,
    userAgent: ua,
    now: new Date(),
  });
  const os = /windows/i.test(ua)
    ? "Windows"
    : /mac os|darwin/i.test(ua)
    ? "macOS"
    : /linux/i.test(ua)
    ? "Linux"
    : "CLI/CI";

  // Non-blocking insert of strictly anonymized gateway adoption event (zero raw IP persisted)
  try {
    await db.insert(pageviews).values({
      id: `gw_${crypto.randomUUID().replace(/-/g, "").slice(0, 18)}`,
      projectId: project.id,
      path: `/gateway/${slug}/${target}@${version}`,
      referrer: "scarf-zero-pii-gateway",
      country: country.slice(0, 12),
      device: "cli",
      browser: "gateway",
      sourceType: "cli",
      eventName: "gateway_adoption",
      os,
      appVersion: version,
      visitorId: anonVisitorId,
    });
  } catch {
    // Redirect must remain available even if telemetry write hits quota
  }

  if (format === "json") {
    return NextResponse.json(
      {
        ok: true,
        slug,
        target,
        version,
        destination,
        piiStored: false,
        anonymizedVisitorPrefix: anonVisitorId ? `${anonVisitorId.slice(0, 8)}...` : null,
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  }

  return NextResponse.redirect(destination, {
    status: 302,
    headers: {
      "Cache-Control": "no-store",
      "X-DevPulse-Zero-PII": "enforced",
    },
  });
}
