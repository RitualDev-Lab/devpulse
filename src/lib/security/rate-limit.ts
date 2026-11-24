import { client } from "@/db";

export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetAtEpoch: number;
  retryAfterSeconds: number;
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
    // Fail open if rate limit storage transiently errors so legitimate telemetry isn't dropped
    console.warn("Rate limiter warning:", err);
    return {
      allowed: true,
      limit: opts.limit,
      remaining: opts.limit,
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
    // If Turnstile isn't configured in a dev environment, fail clearly only if token missing when secret exists
    return { ok: true };
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
  } catch (err: any) {
    return {
      ok: false,
      error: `Turnstile verification service error: ${err?.message || "network error"}`,
    };
  }
}
