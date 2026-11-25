import { client } from "@/db";

export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetAtEpoch: number;
  retryAfterSeconds: number;
}

export async function pruneExpiredRateLimits(): Promise<number> {
  const nowSec = Math.floor(Date.now() / 1000);
  try {
    const res = await client.execute({
      sql: `DELETE FROM rate_limit_counters WHERE expires_at <= ?`,
      args: [nowSec],
    });
    return Number(res.rowsAffected || 0);
  } catch {
    return 0;
  }
}

/**
 * Fixed/sliding window rate limiter persisted in Turso rate_limit_counters.
 * Used to enforce max 500 telemetry beacons/min per API key cleanly across Cloudflare Edge instances.
 */
export async function checkRateLimit(opts: {
  key: string;
  limit: number;
  windowSeconds: number;
}): Promise<RateLimitResult> {
  const nowSec = Math.floor(Date.now() / 1000);
  const windowBucket = Math.floor(nowSec / opts.windowSeconds);
  const resetAtEpoch = (windowBucket + 1) * opts.windowSeconds;
  const bucketKey = `${opts.key}:${windowBucket}`;

  // Opportunistic inline cleanup (~3% of checks) to keep table bounded between cron runs
  if (Math.random() < 0.03) {
    client
      .execute({
        sql: `DELETE FROM rate_limit_counters WHERE expires_at <= ?`,
        args: [nowSec - 60],
      })
      .catch(() => {});
  }

  try {
    const res = await client.execute({
      sql: `
        INSERT INTO rate_limit_counters (bucket_key, count, expires_at)
        VALUES (?, 1, ?)
        ON CONFLICT(bucket_key) DO UPDATE SET
          count = CASE
            WHEN rate_limit_counters.expires_at <= ? THEN 1
            ELSE rate_limit_counters.count + 1
          END,
          expires_at = CASE
            WHEN rate_limit_counters.expires_at <= ? THEN ?
            ELSE rate_limit_counters.expires_at
          END
        RETURNING count, expires_at;
      `,
      args: [bucketKey, resetAtEpoch, nowSec, nowSec, resetAtEpoch],
    });

    const row = res.rows[0] as unknown as { count?: number; expires_at?: number } | undefined;
    const count = Number(row?.count || 1);
    const expiresAt = Number(row?.expires_at || resetAtEpoch);
    const remaining = Math.max(0, opts.limit - count);

    return {
      allowed: count <= opts.limit,
      limit: opts.limit,
      remaining,
      resetAtEpoch: expiresAt,
      retryAfterSeconds: Math.max(1, expiresAt - nowSec),
    };
  } catch (err) {
    // Fail closed: if the counter store is unavailable we cannot prove the caller is under the limit.
    console.error("Rate limiter storage error:", err);
    return {
      allowed: false,
      limit: opts.limit,
      remaining: 0,
      resetAtEpoch,
      retryAfterSeconds: opts.windowSeconds,
    };
  }
}

export function getClientIp(headers: Headers): string {
  const cfIp = headers.get("cf-connecting-ip");
  if (cfIp) return cfIp.trim();
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return "unknown";
}

/**
 * Verifies a Cloudflare Turnstile token via challenges.cloudflare.com/turnstile/v0/siteverify.
 */
export async function verifyTurnstileToken(
  token: string | null | undefined,
  remoteIp?: string | null
): Promise<{ ok: boolean; error?: string }> {
  const secret = process.env.TURNSTILE_SECRET_KEY?.trim();
  if (!secret) {
    // Fail closed: a protected endpoint must not run unverified because a secret is missing.
    console.error("TURNSTILE_SECRET_KEY is not set; refusing unverified request.");
    return { ok: false, error: "Human verification is not configured on this server." };
  }

  if (!token || typeof token !== "string" || !token.trim()) {
    return {
      ok: false,
      error: "Please complete the Cloudflare Turnstile human verification check.",
    };
  }

  try {
    const formData = new URLSearchParams({
      secret,
      response: token.trim(),
    });
    if (remoteIp && remoteIp !== "unknown") {
      formData.set("remoteip", remoteIp);
    }

    const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: formData.toString(),
    });

    const data = (await res.json()) as {
      success?: boolean;
      "error-codes"?: string[];
    };

    if (!data.success) {
      return {
        ok: false,
        error: `Turnstile verification failed (${(data["error-codes"] || ["invalid-input-response"]).join(", ")}).`,
      };
    }

    return { ok: true };
  } catch (err) {
    console.error("Turnstile siteverify request failed:", err);
    return { ok: false, error: "Turnstile verification service is unavailable. Please try again." };
  }
}
