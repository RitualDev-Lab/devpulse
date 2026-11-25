import { NextResponse, type NextRequest } from "next/server";
import { PRIMARY_PORTAL_DOMAIN } from "@/lib/domains/cloudflare-saas";

const MAIN_APP_HOSTS = new Set([
  PRIMARY_PORTAL_DOMAIN,
  `www.${PRIMARY_PORTAL_DOMAIN}`,
  `cname.${PRIMARY_PORTAL_DOMAIN}`,
  "devpulse.rolenest.in",
  "devpulse.internal",
  "localhost",
  "127.0.0.1",
]);

function stripPort(hostHeader: string): string {
  return hostHeader.split(":")[0].trim().toLowerCase();
}

export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

  // Skip internal Next assets, APIs, auth callback, report pages, and direct portal routes
  if (
    pathname.startsWith("/_next") ||
    pathname.startsWith("/api") ||
    pathname.startsWith("/auth") ||
    pathname.startsWith("/portal") ||
    pathname.startsWith("/report") ||
    pathname.startsWith("/embed") ||
    pathname === "/favicon.ico" ||
    /\.(svg|png|jpe?g|gif|webp|ico|css|js|map|txt|xml)$/i.test(pathname)
  ) {
    return NextResponse.next();
  }

  const rawHost = request.headers.get("x-forwarded-host") || request.headers.get("host") || "";
  const host = stripPort(rawHost);

  if (!host || MAIN_APP_HOSTS.has(host) || host.endsWith(".pages.dev")) {
    // Handle Supabase OAuth code landing on Site URL root (/?code=...) by forwarding to /auth/callback
    if (pathname === "/" && request.nextUrl.searchParams.has("code")) {
      const callbackUrl = request.nextUrl.clone();
      callbackUrl.pathname = "/auth/callback";
      return NextResponse.redirect(callbackUrl);
    }
    return NextResponse.next();
  }

  let hostKey: string | null = null;

  // 1. Free Subdomain Routing (*.devpulse.ritualdev.in)
  if (host.endsWith(`.${PRIMARY_PORTAL_DOMAIN}`)) {
    const sub = host.slice(0, -(PRIMARY_PORTAL_DOMAIN.length + 1));
    if (sub && sub !== "www" && sub !== "cname" && sub !== "api") {
      hostKey = sub;
    }
  } else if (host.endsWith(".localhost")) {
    // Local multi-tenant subdomain development (*.localhost:3000)
    const sub = host.slice(0, -".localhost".length);
    if (sub && sub !== "www") {
      hostKey = sub;
    }
  } else {
    // 2. Custom Domain Routing (Cloudflare for SaaS custom hostname)
    hostKey = host;
  }

  if (!hostKey) {
    return NextResponse.next();
  }

  const rewriteUrl = request.nextUrl.clone();
  const subPath =
    pathname === "/changelog"
      ? "/changelog"
      : pathname === "/status"
      ? "/status"
      : "";
  rewriteUrl.pathname = `/portal/${encodeURIComponent(hostKey)}${subPath}`;
  if (search) {
    rewriteUrl.search = search;
  }

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-devpulse-portal-host", host);

  return NextResponse.rewrite(rewriteUrl, {
    request: { headers: requestHeaders },
  });
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico).*)",
  ],
};
