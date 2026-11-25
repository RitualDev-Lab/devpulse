/** Constant-time comparison for equal-length strings. */
function timingSafeEqualText(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

/**
 * Verifies an `X-Hub-Signature-256` header against the raw request body.
 * Returns false for a missing or malformed header and for any mismatch.
 */
export async function verifyGitHubSignature(
  rawBody: string,
  sigHeader: string | null,
  secret: string
): Promise<boolean> {
  if (!secret || !sigHeader || !sigHeader.startsWith("sha256=")) return false;

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const digest = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawBody));
  const expected =
    "sha256=" +
    Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");

  return timingSafeEqualText(expected, sigHeader);
}
