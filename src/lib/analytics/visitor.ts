/**
 * Pseudonymous visitor id for unique-visitor metrics (DAU/WAU/MAU).
 *
 * Keyed HMAC-SHA-256 over project, calendar month, IP and user agent. The id is
 * not stored raw and rotates each calendar month, so visitors cannot be linked
 * across months. Returns null when the secret or a usable IP/user agent is
 * missing: such hits are left unidentified instead of being merged into one visitor.
 */
export async function buildVisitorId(params: {
  secret: string;
  projectId: string;
  ip: string;
  userAgent: string;
  now: Date;
}): Promise<string | null> {
  const { secret, projectId, ip, userAgent, now } = params;
  if (!secret || !ip || ip === "unknown" || !userAgent) return null;

  const month = now.toISOString().slice(0, 7);
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(`${projectId}\n${month}\n${ip}\n${userAgent}`)
  );
  return Array.from(new Uint8Array(signature).slice(0, 16))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
