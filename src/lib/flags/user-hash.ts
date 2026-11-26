/** HMAC pseudonym for joining one flag exposure to crashes without storing the supplied user ID. */
export async function buildFlagUserHash(params: {
  secret: string;
  projectId: string;
  flagKey: string;
  userId: string | null | undefined;
}): Promise<string | null> {
  const userId = params.userId?.trim();
  if (!params.secret || !params.projectId || !params.flagKey || !userId || userId.toLowerCase() === "anonymous") {
    return null;
  }
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(params.secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(`${params.projectId}\n${params.flagKey}\n${userId.slice(0, 200)}`),
  );
  return Array.from(new Uint8Array(signature).slice(0, 16))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
