import { assertSafePublicHttpsUrl } from "@/lib/security/ssrf";

export interface Ga4DailyPoint {
  date: string;
  activeUsers: number;
  sessions: number;
  pageViews: number;
}

export interface ExternalAnalyticsMetrics {
  provider: string;
  activeUsers: number;
  sessions: number;
  pageViews: number;
  bounceRatePct?: number;
  daily?: Ga4DailyPoint[];
  syncedAt: string;
  note?: string;
}

function base64UrlEncode(input: Uint8Array | string): string {
  const bytes = typeof input === "string" ? new TextEncoder().encode(input) : input;
  let bin = "";
  for (let i = 0; i < bytes.length; i++) {
    bin += String.fromCharCode(bytes[i]);
  }
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function pemToArrayBuffer(pem: string): ArrayBuffer {
  const cleaned = pem
    .replace(/\\n/g, "\n")
    .replace(/-----BEGIN [^-]+-----/g, "")
    .replace(/-----END [^-]+-----/g, "")
    .replace(/\s+/g, "");
  const binary = atob(cleaned);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

async function getGoogleAccessToken(credential: string): Promise<string> {
  const trimmed = credential.trim();
  // Allow pasting a raw Google OAuth2 Bearer token directly
  if (!trimmed.startsWith("{")) {
    return trimmed.replace(/^Bearer\s+/i, "");
  }

  let parsed: { client_email?: string; private_key?: string; token_uri?: string };
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    throw new Error("Invalid Google Service Account JSON.");
  }

  if (!parsed.client_email || !parsed.private_key) {
    throw new Error("Service Account JSON must include client_email and private_key.");
  }

  const now = Math.floor(Date.now() / 1000);
  const header = base64UrlEncode(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claim = base64UrlEncode(
    JSON.stringify({
      iss: parsed.client_email,
      scope: "https://www.googleapis.com/auth/analytics.readonly",
      aud: parsed.token_uri || "https://oauth2.googleapis.com/token",
      exp: now + 3600,
      iat: now,
    })
  );

  const signingInput = `${header}.${claim}`;
  const keyBuf = pemToArrayBuffer(parsed.private_key);
  const cryptoKey = await globalThis.crypto.subtle.importKey(
    "pkcs8",
    keyBuf,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await globalThis.crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    cryptoKey,
    new TextEncoder().encode(signingInput)
  );
  const assertion = `${signingInput}.${base64UrlEncode(new Uint8Array(sig))}`;

  const tokenRes = await fetch(parsed.token_uri || "https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });

  const tokenJson = (await tokenRes.json()) as { access_token?: string; error_description?: string };
  if (!tokenRes.ok || !tokenJson.access_token) {
    throw new Error(tokenJson.error_description || "Failed to exchange Google JWT for access token.");
  }
  return tokenJson.access_token;
}

/**
 * Fetches live 30-day metrics from Google Analytics 4 (GA4) Data API v1beta
 * using Web Crypto JWT signing (100% Cloudflare Workers & Node compatible).
 */
export async function fetchGa4Report(params: {
  propertyId: string;
  credential: string;
  days?: number;
}): Promise<ExternalAnalyticsMetrics> {
  const propId = params.propertyId.trim().replace(/^properties\//i, "");
  if (!/^\d+$/.test(propId)) {
    throw new Error("GA4 Property ID must be numeric (e.g., 123456789).");
  }

  const accessToken = await getGoogleAccessToken(params.credential);
  const days = Math.max(1, Math.min(90, params.days || 30));

  const res = await fetch(
    `https://analyticsdata.googleapis.com/v1beta/properties/${propId}:runReport`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        dateRanges: [{ startDate: `${days}daysAgo`, endDate: "today" }],
        dimensions: [{ name: "date" }],
        metrics: [
          { name: "activeUsers" },
          { name: "sessions" },
          { name: "screenPageViews" },
          { name: "bounceRate" },
        ],
        orderBys: [{ dimension: { dimensionName: "date" } }],
      }),
    }
  );

  const json = (await res.json()) as {
    rows?: Array<{
      dimensionValues?: Array<{ value?: string }>;
      metricValues?: Array<{ value?: string }>;
    }>;
    error?: { message?: string };
  };

  if (!res.ok) {
    throw new Error(json.error?.message || `GA4 Data API returned HTTP ${res.status}`);
  }

  const rows = json.rows || [];
  let activeUsers = 0;
  let sessions = 0;
  let pageViews = 0;
  let bounceSum = 0;
  const daily: Ga4DailyPoint[] = [];

  for (const row of rows) {
    const rawDate = row.dimensionValues?.[0]?.value || "";
    const isoDate =
      rawDate.length === 8
        ? `${rawDate.slice(0, 4)}-${rawDate.slice(4, 6)}-${rawDate.slice(6, 8)}`
        : rawDate;
    const u = Number(row.metricValues?.[0]?.value || 0);
    const s = Number(row.metricValues?.[1]?.value || 0);
    const pv = Number(row.metricValues?.[2]?.value || 0);
    const br = Number(row.metricValues?.[3]?.value || 0);
    activeUsers += u;
    sessions += s;
    pageViews += pv;
    bounceSum += br;
    if (isoDate) {
      daily.push({ date: isoDate, activeUsers: u, sessions: s, pageViews: pv });
    }
  }

  return {
    provider: "ga4",
    activeUsers,
    sessions,
    pageViews,
    bounceRatePct: rows.length > 0 ? Math.round((bounceSum / rows.length) * 1000) / 10 : 0,
    daily,
    syncedAt: new Date().toISOString(),
  };
}

export async function fetchExternalAnalyticsSnapshot(params: {
  provider: string;
  identifier?: string | null;
  targetUrl?: string | null;
  credential?: string | null;
}): Promise<ExternalAnalyticsMetrics> {
  const provider = params.provider.toLowerCase();

  if (provider === "ga4") {
    if (!params.identifier || !params.credential) {
      throw new Error("GA4 requires both a numeric Property ID and Service Account JSON or OAuth token.");
    }
    return fetchGa4Report({
      propertyId: params.identifier,
      credential: params.credential,
    });
  }

  if (provider === "plausible") {
    if (!params.identifier || !params.credential) {
      throw new Error("Plausible requires Domain ID and API key.");
    }
    const base = params.targetUrl
      ? assertSafePublicHttpsUrl(params.targetUrl).replace(/\/+$/, "")
      : "https://plausible.io";
    const res = await fetch(
      `${base}/api/v1/stats/aggregate?site_id=${encodeURIComponent(
        params.identifier
      )}&period=30d&metrics=visitors,pageviews,bounce_rate`,
      { headers: { Authorization: `Bearer ${params.credential}` } }
    );
    const data = (await res.json()) as {
      results?: {
        visitors?: { value?: number };
        pageviews?: { value?: number };
        bounce_rate?: { value?: number };
      };
      error?: string;
    };
    if (!res.ok) throw new Error(data.error || `Plausible API HTTP ${res.status}`);
    return {
      provider: "plausible",
      activeUsers: Number(data.results?.visitors?.value || 0),
      sessions: Number(data.results?.visitors?.value || 0),
      pageViews: Number(data.results?.pageviews?.value || 0),
      bounceRatePct: Number(data.results?.bounce_rate?.value || 0),
      syncedAt: new Date().toISOString(),
    };
  }

  if (provider === "umami" && params.targetUrl && params.identifier) {
    const base = assertSafePublicHttpsUrl(params.targetUrl).replace(/\/+$/, "");
    const endAt = Date.now();
    const startAt = endAt - 30 * 86400_000;
    const res = await fetch(
      `${base}/api/websites/${encodeURIComponent(
        params.identifier
      )}/stats?startAt=${startAt}&endAt=${endAt}`,
      {
        headers: params.credential
          ? { Authorization: `Bearer ${params.credential}` }
          : undefined,
      }
    );
    if (!res.ok) throw new Error(`Umami API HTTP ${res.status}`);
    const data = (await res.json()) as {
      visitors?: { value?: number } | number;
      pageviews?: { value?: number } | number;
      visits?: { value?: number } | number;
    };
    const v = typeof data.visitors === "object" ? data.visitors?.value : data.visitors;
    const pv = typeof data.pageviews === "object" ? data.pageviews?.value : data.pageviews;
    const vs = typeof data.visits === "object" ? data.visits?.value : data.visits;
    return {
      provider: "umami",
      activeUsers: Number(v || 0),
      sessions: Number(vs || v || 0),
      pageViews: Number(pv || 0),
      syncedAt: new Date().toISOString(),
    };
  }

  if (provider === "posthog") {
    if (!params.identifier || !params.credential) {
      throw new Error("PostHog requires Project ID and Personal API Key.");
    }
    const base = params.targetUrl
      ? assertSafePublicHttpsUrl(params.targetUrl).replace(/\/+$/, "")
      : "https://us.posthog.com";
    const res = await fetch(
      `${base}/api/projects/${encodeURIComponent(params.identifier)}/insights/trend/?events=${encodeURIComponent(
        JSON.stringify([{ id: "$pageview", math: "dau" }])
      )}&date_from=-30d`,
      {
        headers: {
          Authorization: `Bearer ${params.credential}`,
          Accept: "application/json",
        },
      }
    );
    if (!res.ok) throw new Error(`PostHog API HTTP ${res.status}`);
    const data = (await res.json()) as {
      result?: Array<{
        count?: number;
        data?: number[];
        days?: string[];
      }>;
    };
    const series = data.result?.[0];
    const dailyPts = Array.isArray(series?.data)
      ? series.data.map((val, idx) => ({
          date: series.days?.[idx] || String(idx + 1),
          activeUsers: Number(val || 0),
          sessions: Number(val || 0),
          pageViews: Number(val || 0),
        }))
      : [];
    const total = dailyPts.reduce((acc, p) => acc + p.activeUsers, 0) || Number(series?.count || 0);
    return {
      provider: "posthog",
      activeUsers: total,
      sessions: total,
      pageViews: total,
      daily: dailyPts,
      syncedAt: new Date().toISOString(),
    };
  }

  // OCI / VPS / Custom Server Telemetry JSON Endpoint (SSRF-guarded public HTTPS URL)
  if (params.targetUrl) {
    const safeUrl = assertSafePublicHttpsUrl(params.targetUrl);
    const res = await fetch(safeUrl, {
      headers: params.credential
        ? { Authorization: `Bearer ${params.credential}`, Accept: "application/json" }
        : { Accept: "application/json" },
    });
    if (!res.ok) throw new Error(`Custom analytics endpoint returned HTTP ${res.status}`);
    const data = (await res.json()) as Record<string, any>;
    return {
      provider,
      activeUsers: Number(data.activeUsers ?? data.dau ?? data.visitors ?? 0),
      sessions: Number(data.sessions ?? data.visits ?? 0),
      pageViews: Number(data.pageViews ?? data.pageviews ?? data.requests ?? 0),
      note:
        typeof data.cpuPercent === "number"
          ? `CPU ${data.cpuPercent}%`
          : undefined,
      syncedAt: new Date().toISOString(),
    };
  }

  return {
    provider,
    activeUsers: 0,
    sessions: 0,
    pageViews: 0,
    syncedAt: new Date().toISOString(),
    note: "Push events directly via DevPulse SDK / OCI agent.",
  };
}
