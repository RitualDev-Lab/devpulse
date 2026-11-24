import type { BillingItemKey } from "./plans";

const DODO_LIVE_BASE_URL = "https://live.dodopayments.com";
const DODO_TEST_BASE_URL = "https://test.dodopayments.com";

// Live Dodo Payments product IDs created for DevPulse SaaS (fallback if env not injected in local tooling)
const DEFAULT_PRODUCT_IDS: Record<BillingItemKey, string> = {
  pro: "pdt_0Nsfgf8Ryeyj6XQbwikSQ",
  team: "pdt_0NsfgfAkiZAe0UAolxkWo",
  extra_domain: "pdt_0NsfgfCpABtcsEgbRVYSN",
  extra_storage: "pdt_0NsfgfE4FUa4NQXUPECWa",
};

export function getDodoApiBaseUrl(): string {
  const env = (process.env.DODO_PAYMENTS_ENVIRONMENT || "live").toLowerCase();
  return env === "test" || env === "test_mode" ? DODO_TEST_BASE_URL : DODO_LIVE_BASE_URL;
}

export function getDodoApiKey(): string | null {
  return process.env.DODO_PAYMENTS_API_KEY?.trim() || null;
}

export function getDodoProductId(itemKey: BillingItemKey): string {
  const envMap: Record<BillingItemKey, string | undefined> = {
    pro: process.env.DODO_PRODUCT_PRO,
    team: process.env.DODO_PRODUCT_TEAM,
    extra_domain: process.env.DODO_PRODUCT_EXTRA_DOMAIN,
    extra_storage: process.env.DODO_PRODUCT_EXTRA_STORAGE,
  };
  return envMap[itemKey]?.trim() || DEFAULT_PRODUCT_IDS[itemKey];
}

export function resolveItemKeyFromProductId(productId?: string | null): BillingItemKey | null {
  if (!productId) return null;
  const keys: BillingItemKey[] = ["pro", "team", "extra_domain", "extra_storage"];
  for (const key of keys) {
    if (getDodoProductId(key) === productId || DEFAULT_PRODUCT_IDS[key] === productId) {
      return key;
    }
  }
  return null;
}

export async function createDodoCheckoutSession(params: {
  itemKey: BillingItemKey;
  quantity?: number;
  userId: string;
  userEmail?: string | null;
  userName?: string | null;
  dodoCustomerId?: string | null;
  returnUrl: string;
}): Promise<{ checkoutUrl: string; sessionId: string }> {
  const apiKey = getDodoApiKey();
  if (!apiKey) {
    throw new Error("DODO_PAYMENTS_API_KEY is not configured on the server.");
  }

  const productId = getDodoProductId(params.itemKey);
  const quantity = Math.max(1, Math.min(20, Math.floor(params.quantity || 1)));

  const body: Record<string, unknown> = {
    product_cart: [{ product_id: productId, quantity }],
    return_url: params.returnUrl,
    metadata: {
      app: "devpulse",
      userId: params.userId,
      itemKey: params.itemKey,
      quantity: String(quantity),
    },
  };

  if (params.dodoCustomerId) {
    body.customer = { customer_id: params.dodoCustomerId };
  } else if (params.userEmail) {
    body.customer = {
      email: params.userEmail,
      name: params.userName || params.userEmail.split("@")[0],
    };
  }

  const res = await fetch(`${getDodoApiBaseUrl()}/checkouts`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Dodo checkout creation failed (${res.status}): ${text}`);
  }

  const data = JSON.parse(text) as { session_id?: string; checkout_url?: string };
  if (!data.checkout_url || !data.session_id) {
    throw new Error("Dodo checkout response missing checkout_url or session_id.");
  }

  return {
    checkoutUrl: data.checkout_url,
    sessionId: data.session_id,
  };
}

export async function createDodoCustomerPortalSession(dodoCustomerId: string): Promise<string> {
  const apiKey = getDodoApiKey();
  if (!apiKey) {
    throw new Error("DODO_PAYMENTS_API_KEY is not configured.");
  }

  const res = await fetch(
    `${getDodoApiBaseUrl()}/customers/${encodeURIComponent(dodoCustomerId)}/customer-portal/session`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ send_email: false }),
    }
  );

  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Dodo customer portal failed (${res.status}): ${text}`);
  }

  const data = JSON.parse(text) as { link?: string; url?: string };
  const portalUrl = data.link || data.url;
  if (!portalUrl) {
    throw new Error("Dodo customer portal response missing link.");
  }
  return portalUrl;
}

export async function fetchDodoCustomerPayments(dodoCustomerId: string) {
  const apiKey = getDodoApiKey();
  if (!apiKey || !dodoCustomerId) return [];

  try {
    const res = await fetch(
      `${getDodoApiBaseUrl()}/payments?customer_id=${encodeURIComponent(dodoCustomerId)}&page_size=25`,
      {
        headers: { Authorization: `Bearer ${apiKey}` },
        next: { revalidate: 60 },
      }
    );
    if (!res.ok) return [];
    const data = (await res.json()) as {
      items?: Array<{
        payment_id: string;
        total_amount: number;
        currency: string;
        status: string;
        created_at: string;
        subscription_id?: string | null;
        payment_link?: string | null;
      }>;
    };
    return data.items || [];
  } catch {
    return [];
  }
}

export async function verifyDodoPaymentOrSubscriptionLive(opts: {
  paymentId?: string | null;
  subscriptionId?: string | null;
}): Promise<{ verified: boolean; status?: string; customerId?: string; metadata?: Record<string, string> }> {
  const apiKey = getDodoApiKey();
  if (!apiKey) return { verified: false };

  try {
    if (opts.subscriptionId) {
      const res = await fetch(
        `${getDodoApiBaseUrl()}/subscriptions/${encodeURIComponent(opts.subscriptionId)}`,
        { headers: { Authorization: `Bearer ${apiKey}` } }
      );
      if (res.ok) {
        const sub = (await res.json()) as {
          status?: string;
          customer?: { customer_id?: string };
          metadata?: Record<string, string>;
        };
        return {
          verified: true,
          status: sub.status,
          customerId: sub.customer?.customer_id,
          metadata: sub.metadata,
        };
      }
    }
    if (opts.paymentId) {
      const res = await fetch(
        `${getDodoApiBaseUrl()}/payments/${encodeURIComponent(opts.paymentId)}`,
        { headers: { Authorization: `Bearer ${apiKey}` } }
      );
      if (res.ok) {
        const pay = (await res.json()) as {
          status?: string;
          customer?: { customer_id?: string };
          metadata?: Record<string, string>;
        };
        return {
          verified: true,
          status: pay.status,
          customerId: pay.customer?.customer_id,
          metadata: pay.metadata,
        };
      }
    }
  } catch {
    return { verified: false };
  }

  return { verified: false };
}

/**
 * Verifies Standard Webhooks signature used by Dodo Payments:
 * Header format:
 * - webhook-id
 * - webhook-timestamp
 * - webhook-signature: "v1,<base64sig> ..."
 * Signed payload: `${webhookId}.${webhookTimestamp}.${rawBody}`
 * Secret format: `whsec_<base64>`
 */
export async function verifyDodoWebhookSignature(
  rawBody: string,
  headers: {
    webhookId: string | null;
    webhookTimestamp: string | null;
    webhookSignature: string | null;
  }
): Promise<boolean> {
  const secret = process.env.DODO_PAYMENTS_WEBHOOK_SECRET?.trim();
  if (!secret || !headers.webhookId || !headers.webhookTimestamp || !headers.webhookSignature) {
    return false;
  }

  // Reject stale timestamps (> 5 min drift)
  const tsNum = Number(headers.webhookTimestamp);
  if (!Number.isFinite(tsNum) || Math.abs(Math.floor(Date.now() / 1000) - tsNum) > 300) {
    return false;
  }

  const rawSecretBase64 = secret.startsWith("whsec_") ? secret.slice(6) : secret;
  const keyBytes = Uint8Array.from(atob(rawSecretBase64), (c) => c.charCodeAt(0));

  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    keyBytes,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const signedContent = `${headers.webhookId}.${headers.webhookTimestamp}.${rawBody}`;
  const sigBuffer = await crypto.subtle.sign(
    "HMAC",
    cryptoKey,
    new TextEncoder().encode(signedContent)
  );
  const expectedBase64 = btoa(String.fromCharCode(...new Uint8Array(sigBuffer)));

  const candidates = headers.webhookSignature.split(/\s+/);
  for (const part of candidates) {
    const [version, sig] = part.split(",");
    if (version === "v1" && sig && timingSafeEqual(sig, expectedBase64)) {
      return true;
    }
  }

  return false;
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}
