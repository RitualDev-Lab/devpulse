import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/db";
import { customDomains, projects, users } from "@/db/schema";
import { eq, or } from "drizzle-orm";
import { parseIncomingHost } from "@/lib/domains/host-routing";

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Never intercept API endpoints, Next internals, OAuth callback, or static files
  if (
    pathname.startsWith("/api/") ||
    pathname.startsWith("/_next/") ||
    pathname.startsWith("/auth/") ||
    pathname === "/favicon.ico" ||
    pathname === "/tracker.js" ||
    pathname.endsWith(".svg") ||
    pathname.endsWith(".png") ||
    pathname.endsWith(".ico")
  ) {
    return NextResponse.next();
  }

  const hostHeader = request.headers.get("x-forwarded-host") || request.headers.get("host");
  const match = parseIncomingHost(hostHeader);

  if (match.kind === "primary") {
    return NextResponse.next();
  }

  // Allow /p/[slug] and /report/[slug] directly on tenant hosts
  if (pathname.startsWith("/p/") || pathname.startsWith("/report/")) {
    return NextResponse.next();
  }

  if (match.kind === "subdomain") {
    const rewriteUrl = request.nextUrl.clone();
    rewriteUrl.pathname = `/u/${encodeURIComponent(match.subdomain)}`;
    return NextResponse.rewrite(rewriteUrl);
  }

  // Custom Domain Redirect Lookup (Cloudflare for SaaS Custom Hostnames)
  try {
    const [domainRow] = await db
      .select({
        projectId: customDomains.projectId,
        userId: customDomains.userId,
        verified: customDomains.verified,
      })
      .from(customDomains)
      .where(eq(customDomains.hostname, match.hostname))
      .limit(1);

    if (domainRow?.projectId) {
      const [proj] = await db
        .select({ slug: projects.slug })
        .from(projects)
        .where(eq(projects.id, domainRow.projectId))
        .limit(1);
      if (proj) {
        const rewriteUrl = request.nextUrl.clone();
        rewriteUrl.pathname = `/p/${encodeURIComponent(proj.slug)}`;
        return NextResponse.rewrite(rewriteUrl);
      }
    }

    if (domainRow?.userId) {
      const [owner] = await db
        .select({ subdomain: users.subdomain, githubUsername: users.githubUsername })
        .from(users)
        .where(eq(users.id, domainRow.userId))
        .limit(1);
      if (owner) {
        const rewriteUrl = request.nextUrl.clone();
        rewriteUrl.pathname = `/u/${encodeURIComponent(owner.subdomain || owner.githubUsername)}`;
        return NextResponse.rewrite(rewriteUrl);
      }
    }

    // Legacy single customDomain field lookup on users table
    const [legacyOwner] = await db
      .select({ subdomain: users.subdomain, githubUsername: users.githubUsername })
      .from(users)
      .where(or(eq(users.customDomain, match.hostname)))
      .limit(1);

    if (legacyOwner) {
      const rewriteUrl = request.nextUrl.clone();
      rewriteUrl.pathname = `/u/${encodeURIComponent(legacyOwner.subdomain || legacyOwner.githubUsername)}`;
      return NextResponse.rewrite(rewriteUrl);
    }
  } catch (err) {
    console.warn("Custom domain lookup failed in proxy:", err);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
