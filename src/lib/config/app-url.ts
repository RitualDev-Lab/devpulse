// Public origin and portal routing config. Client-safe (NEXT_PUBLIC_* values are inlined at build time).
// Local fallback is http://localhost:3000; never point at a production host by default.
export const PUBLIC_APP_URL = (process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000").replace(/\/$/, "");

/** Host that free subdomains live under (e.g. "example.com" -> "<slug>.example.com"). */
export const PORTAL_DOMAIN = (process.env.NEXT_PUBLIC_PORTAL_DOMAIN || new URL(PUBLIC_APP_URL).hostname).toLowerCase();

/** Target that customer CNAME records must point to. */
export const CNAME_TARGET = (process.env.NEXT_PUBLIC_CNAME_TARGET || `cname.${PORTAL_DOMAIN}`).toLowerCase();
