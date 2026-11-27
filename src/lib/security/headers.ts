import type { NextResponse } from "next/server";

/**
 * OWASP 2026 HTTP Security Header Baseline helper.
 * Applied uniformly in Edge Proxy/Middleware across app, dashboard, and API routes.
 */
export function applySecurityHeaders(response: NextResponse, pathname: string): NextResponse {
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  response.headers.set(
    "Permissions-Policy",
    "camera=(), microphone=(), geolocation=(), interest-cohort=()"
  );
  response.headers.set("X-XSS-Protection", "0");
  response.headers.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");

  // Allow public iframe embeds exclusively under /embed/*; block framing elsewhere
  const frameAncestors = pathname.startsWith("/embed/") ? "*" : "'none'";
  response.headers.set(
    "Content-Security-Policy-Report-Only",
    `default-src 'self'; script-src 'self' 'unsafe-inline' https://challenges.cloudflare.com; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; connect-src 'self' https:; frame-src https://challenges.cloudflare.com; frame-ancestors ${frameAncestors}; object-src 'none'; base-uri 'self'`
  );

  // Enforce no-store cache policy on authenticated APIs, auth routes, and dashboard HTML
  if (
    (pathname.startsWith("/api/v1/") ||
      pathname.startsWith("/api/auth/") ||
      pathname.startsWith("/api/scim/") ||
      pathname.startsWith("/dashboard")) &&
    !pathname.startsWith("/api/badge/")
  ) {
    response.headers.set("Cache-Control", "no-store, no-cache, must-revalidate, private");
  }

  return response;
}
