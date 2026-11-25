import type { BillingItemKey } from "./plans";

const DODO_LIVE_BASE_URL = "https://live.dodopayments.com";
const DODO_TEST_BASE_URL = "https://test.dodopayments.com";

// Product IDs come only from DODO_PRODUCT_* environment variables (no committed defaults).
export function getDodoApiBaseUrl(): string {
  const env = (process.env.DODO_PAYMENTS_ENVIRONMENT || "live").toLowerCase();
  return env === "test" || env === "test_mode" ? DODO_TEST_BASE_URL : DODO_LIVE_BASE_URL;
}

export function getDodoApiKey(): string | null {
  return process.env.DODO_PAYMENTS_API_KEY?.trim() || null;
}

function configuredProductId(itemKey: BillingItemKey): string {
  const envMap: Record<BillingItemKey, string | undefined> = {
    pro: process.env.DODO_PRODUCT_PRO,
    team: process.env.DODO_PRODUCT_TEAM,
    extra_domain: process.env.DODO_PRODUCT_EXTRA_DOMAIN,
    extra_storage: process.env.DODO_PRODUCT_EXTRA_STORAGE,
  };
  return envMap[itemKey]?.trim() || "";
}

export function getDodoProductId(itemKey: BillingItemKey): string {
  const id = configuredProductId(itemKey);
  if (!id) {
    throw new Error(`Dodo product is not configured for ${itemKey} (set DODO_PRODUCT_* env)`);
  }
  return id;
}

export function resolveItemKeyFromProductId(productId?: string | null): BillingItemKey | null {
  if (!productId) return null;
  const keys: BillingItemKey[] = ["pro", "team", "extra_domain", "extra_storage"];
  for (const key of keys) {
    const id = configuredProductId(key);
    if (id && id === productId) {
      return key;
    }
  }
  return null;
}

export function buildHostedDodoCheckoutUrl(params: {
  itemKey: BillingItemKey;
  quantity?: number;
  userId: string;
  userEmail?: string | null;
  returnUrl: string;
}): string {
  const productId = getDodoProductId(params.itemKey);
  const quantity = Math.max(1, Math.min(20, Math.floor(params.quantity || 1)));
  const isTest = (process.env.DODO_PAYMENTS_ENVIRONMENT || "live").toLowerCase().includes("test");
  const origin = isTest ? "https://test.checkout.dodopayments.com" : "https://checkout.dodopayments.com";

  const url = new URL(`${origin}/buy/${productId}`);
  url.searchParams.set("quantity", String(quantity));
  url.searchParams.set("redirect_url", params.returnUrl);
  url.searchParams.set("metadata_app", "devpulse");
  url.searchParams.set("metadata_userId", params.userId);
  url.searchParams.set("metadata_itemKey", params.itemKey);
  url.searchParams.set("metadata_quantity", String(quantity));
  if (params.userEmail) {
    url.searchParams.set("email", params.userEmail);
  }
  return url.toString();
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
  const productId = getDodoProductId(params.itemKey);
  const quantity = Math.max(1, Math.min(20, Math.floor(params.quantity || 1)));

  if (!apiKey) {
    return {
      checkoutUrl: buildHostedDodoCheckoutUrl(params),
      sessionId: `hosted_${params.itemKey}_${Date.now()}`,
    };
  }

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
