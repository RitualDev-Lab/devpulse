import crypto from "crypto";

export type BillingSku = "pro" | "team" | "extra_domain";

const enc = new TextEncoder();

export function getDodoProductId(sku: BillingSku): string | null {
  switch (sku) {
    case "pro":
      return process.env.DODO_PRODUCT_PRO_ID || null;
    case "team":
      return process.env.DODO_PRODUCT_TEAM_ID || null;
    case "extra_domain":
      return process.env.DODO_PRODUCT_DOMAIN_ADDON_ID || null;
  }
}

export async function verifyDodoWebhookSignature(params: {
  rawBody: string;
  webhookId: string | null;
  webhookTimestamp: string | null;
  webhookSignature: string | null;
  secret: string;
}): Promise<boolean> {
  const { rawBody, webhookId, webhookTimestamp, webhookSignature, secret } = params;
  if (!webhookId || !webhookTimestamp || !webhookSignature || !secret) {
    return false;
  }

  const tsNum = Number(webhookTimestamp);
  if (!Number.isFinite(tsNum) || Math.abs(Date.now() / 1000 - tsNum) > 600) {
    // Reject signatures older/newer than 10 minutes
    return false;
  }

  const rawKey = secret.startsWith("whsec_") ? secret.slice("whsec_".length) : secret;
  let keyBytes: Uint8Array;
  try {
    keyBytes = new Uint8Array(Buffer.from(rawKey, "base64"));
  } catch {
    return false;
  }

  const signedContent = `${webhookId}.${webhookTimestamp}.${rawBody}`;
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    keyBytes.buffer.slice(keyBytes.byteOffset, keyBytes.byteOffset + keyBytes.byteLength) as ArrayBuffer,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sigBuf = await crypto.subtle.sign("HMAC", cryptoKey, enc.encode(signedContent));
  const expectedBase64 = Buffer.from(sigBuf).toString("base64");

  const signatures = webhookSignature
    .split(" ")
    .map((part) => part.trim())
    .filter((part) => part.startsWith("v1,"))
    .map((part) => part.slice(3));

  const expectedBuf = Buffer.from(expectedBase64);
  for (const candidate of signatures) {
    const candidateBuf = Buffer.from(candidate);
    if (
      candidateBuf.length === expectedBuf.length &&
      crypto.timingSafeEqual(candidateBuf, expectedBuf)
    ) {
      return true;
    }
  }

  return false;
}

export async function createDodoCheckoutSession(params: {
  userId: string;
  email?: string | null;
  name?: string | null;
  sku: BillingSku;
  returnUrl: string;
}): Promise<{ ok: boolean; checkoutUrl?: string; error?: string }> {
  const productId = getDodoProductId(params.sku);
  const apiKey = process.env.DODO_PAYMENTS_API_KEY;
  const env = process.env.DODO_PAYMENTS_ENV === "test" ? "test" : "live";

  if (!productId) {
    return {
      ok: false,
      error: `Missing Dodo Payments product ID env var for SKU "${params.sku}".`,
    };
  }

  if (apiKey) {
    const baseUrl = env === "test" ? "https://test.dodopayments.com" : "https://live.dodopayments.com";
    const res = await fetch(`${baseUrl}/checkouts`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey.trim()}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        product_cart: [{ product_id: productId, quantity: 1 }],
        customer: {
          email: params.email || undefined,
          name: params.name || undefined,
        },
        metadata: {
          user_id: params.userId,
          sku: params.sku,
        },
        return_url: params.returnUrl,
      }),
    }).catch(() => null);

    if (res && res.ok) {
      const json = await res.json().catch(() => null);
      if (json?.checkout_url) {
        return { ok: true, checkoutUrl: json.checkout_url };
      }
    }
  }

  // Hosted Dodo checkout link fallback with user & SKU metadata query params
  const checkoutOrigin =
    env === "test" ? "https://test.checkout.dodopayments.com" : "https://checkout.dodopayments.com";
  const url = new URL(`${checkoutOrigin}/buy/${productId}`);
  url.searchParams.set("quantity", "1");
  url.searchParams.set("redirect_url", params.returnUrl);
  url.searchParams.set("metadata_user_id", params.userId);
  url.searchParams.set("metadata_sku", params.sku);
  if (params.email) url.searchParams.set("email", params.email);

  return { ok: true, checkoutUrl: url.toString() };
}
