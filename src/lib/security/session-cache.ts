/**
 * Edge Session Cookie Cache (Web Crypto HMAC-SHA256, 60s TTL)
 * Caches verified Supabase user claims in an HttpOnly signed cookie (`dp_user_cache`)
 * bound to a SHA-256 fingerprint of the active `sb-*` Supabase auth cookies so
 * repeated navigations resolve in <1ms without blocking on Supabase Auth network roundtrips.
 */

export const SESSION_CACHE_COOKIE = "dp_user_cache";
export const SESSION_CACHE_TTL_SECONDS = 60;

export interface CachedUserClaims {
  id: string;
  githubUsername: string;
  name: string | null;
  email: string | null;
  avatarUrl: string | null;
  storageTier: string;
  subdomain: string | null;
  customDomain: string | null;
  customDomainVerified: boolean;
  authMethod?: "github" | "saml";
  ssoOrganizationId?: string | null;
}

interface SessionCachePayload {
  user: CachedUserClaims;
  sbFp: string;
  exp: number;
}

function getHmacSecretMaterial(): string | null {
  return (
    process.env.SECRET_ENCRYPTION_KEY?.trim() ||
    process.env.ENCRYPTION_MASTER_KEY?.trim() ||
    process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ||
    null
  );
}

async function importHmacKey(): Promise<CryptoKey | null> {
  const secret = getHmacSecretMaterial();
  if (!secret) return null;
  const keyBytes = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`dp-session-cache:${secret}`)
  );
  return crypto.subtle.importKey(
    "raw",
    keyBytes,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"]
  );
}

function toBase64Url(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function fromBase64Url(str: string): Uint8Array {
  const pad = str.length % 4 === 0 ? "" : "=".repeat(4 - (str.length % 4));
  const b64 = str.replace(/-/g, "+").replace(/_/g, "/") + pad;
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/**
 * Computes a short fingerprint of all active Supabase `sb-*` auth cookies.
 * Returns "" when the browser has no Supabase session cookies at all.
 */
export async function computeSupabaseCookieFingerprint(
  cookiesList: Array<{ name: string; value: string }>
): Promise<string> {
  const sbCookies = cookiesList
    .filter((c) => c.name.startsWith("sb-") && c.value)
    .sort((a, b) => a.name.localeCompare(b.name));

  if (sbCookies.length === 0) return "";
  const joined = sbCookies.map((c) => `${c.name}=${c.value}`).join("|");
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(joined));
  return toBase64Url(new Uint8Array(digest)).slice(0, 22);
}

export async function createSignedSessionCacheToken(
  user: CachedUserClaims,
  sbFp: string,
  ttlSeconds = SESSION_CACHE_TTL_SECONDS
): Promise<string | null> {
  if (!sbFp) return null;
  const key = await importHmacKey();
  if (!key) return null;

  const payload: SessionCachePayload = {
    user,
    sbFp,
    exp: Date.now() + ttlSeconds * 1000,
  };
  const payloadB64 = toBase64Url(new TextEncoder().encode(JSON.stringify(payload)));
  const sigBuf = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(payloadB64)
  );
  return `${payloadB64}.${toBase64Url(new Uint8Array(sigBuf))}`;
}

export async function verifySignedSessionCacheToken(
  token: string | undefined | null,
  expectedSbFp: string
): Promise<CachedUserClaims | null> {
  if (!token || !expectedSbFp) return null;
  const dotIdx = token.indexOf(".");
  if (dotIdx <= 0) return null;

  const payloadB64 = token.slice(0, dotIdx);
  const sigB64 = token.slice(dotIdx + 1);
  if (!payloadB64 || !sigB64) return null;

  try {
    const key = await importHmacKey();
    if (!key) return null;

    const sigBytes = fromBase64Url(sigB64);
    const valid = await crypto.subtle.verify(
      "HMAC",
      key,
      new Uint8Array(sigBytes),
      new TextEncoder().encode(payloadB64)
    );
    if (!valid) return null;

    const decoded = new TextDecoder().decode(fromBase64Url(payloadB64));
    const parsed = JSON.parse(decoded) as SessionCachePayload;

    if (!parsed?.user?.id || !parsed.exp || Date.now() > parsed.exp) {
      return null;
    }
    if (parsed.sbFp !== expectedSbFp) {
      return null;
    }
    return parsed.user;
  } catch {
    return null;
  }
}
