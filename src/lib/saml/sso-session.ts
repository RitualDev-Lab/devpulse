import { cookies } from "next/headers";

export const SSO_SESSION_COOKIE = "dp_sso_session";
const SSO_SESSION_TTL_SECONDS = 8 * 60 * 60; // 8 hours

export interface SsoSessionPayload {
  userId: string;
  organizationId: string;
  email: string;
  name: string;
  provider: string;
  exp: number; // unix epoch seconds
}

function getSigningSecret(): string {
  const configured =
    process.env.SSO_SESSION_SECRET?.trim() ||
    process.env.ENCRYPTION_MASTER_KEY?.trim();
  if (configured) return configured;

  if (process.env.NODE_ENV === "production") {
    throw new Error("SSO_SESSION_SECRET or ENCRYPTION_MASTER_KEY must be configured in production.");
  }
  return "devpulse_local_dev_sso_secret_only";
}

async function importHmacKey(): Promise<CryptoKey> {
  const secretBytes = new TextEncoder().encode(getSigningSecret());
  const digest = await crypto.subtle.digest("SHA-256", secretBytes);
  return crypto.subtle.importKey(
    "raw",
    digest,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"]
  );
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(b64u: string): Uint8Array {
  const pad = b64u.length % 4 === 0 ? "" : "=".repeat(4 - (b64u.length % 4));
  const b64 = b64u.replace(/-/g, "+").replace(/_/g, "/") + pad;
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    out[i] = binary.charCodeAt(i);
  }
  return out;
}

export async function createSsoSessionToken(
  input: Omit<SsoSessionPayload, "exp">,
  ttlSeconds = SSO_SESSION_TTL_SECONDS
): Promise<string> {
  const payload: SsoSessionPayload = {
    ...input,
    exp: Math.floor(Date.now() / 1000) + ttlSeconds,
  };
  const payloadB64 = toBase64Url(new TextEncoder().encode(JSON.stringify(payload)));
  const key = await importHmacKey();
  const sig = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(payloadB64)
  );
  const sigB64 = toBase64Url(new Uint8Array(sig));
  return `${payloadB64}.${sigB64}`;
}

export async function verifySsoSessionToken(
  token?: string | null
): Promise<SsoSessionPayload | null> {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 2) return null;

  const [payloadB64, sigB64] = parts;
  try {
    const key = await importHmacKey();
    const sigBytes = fromBase64Url(sigB64);
    const valid = await crypto.subtle.verify(
      "HMAC",
      key,
      new Uint8Array(sigBytes),
      new TextEncoder().encode(payloadB64)
    );
    if (!valid) return null;

    const jsonStr = new TextDecoder().decode(fromBase64Url(payloadB64));
    const parsed = JSON.parse(jsonStr) as SsoSessionPayload;
    if (!parsed.userId || !parsed.organizationId || !parsed.exp) {
      return null;
    }
    if (parsed.exp < Math.floor(Date.now() / 1000)) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export async function getSsoSessionFromCookies(): Promise<SsoSessionPayload | null> {
  try {
    const cookieStore = await cookies();
    const raw = cookieStore.get(SSO_SESSION_COOKIE)?.value;
    return verifySsoSessionToken(raw);
  } catch {
    return null;
  }
}

export function buildSsoCookieOptions(isHttps: boolean) {
  return {
    httpOnly: true,
    secure: isHttps,
    sameSite: "lax" as const,
    path: "/",
    maxAge: SSO_SESSION_TTL_SECONDS,
  };
}
