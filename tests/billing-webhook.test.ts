import test, { beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { createHmac, randomBytes } from "node:crypto";
import { verifyDodoWebhookSignature } from "../src/lib/billing/dodo";

const secretBytes = randomBytes(24);
const secret = `whsec_${secretBytes.toString("base64")}`;
const body = JSON.stringify({ type: "payment.succeeded", data: { payment_id: "pay_1", metadata: { userId: "u1" } } });

function sign(id: string, ts: string, payload: string, key = secretBytes) {
  const mac = createHmac("sha256", key).update(`${id}.${ts}.${payload}`).digest("base64");
  return `v1,${mac}`;
}

let previousSecret: string | undefined;
beforeEach(() => {
  previousSecret = process.env.DODO_PAYMENTS_WEBHOOK_SECRET;
  process.env.DODO_PAYMENTS_WEBHOOK_SECRET = secret;
});
afterEach(() => {
  if (previousSecret === undefined) delete process.env.DODO_PAYMENTS_WEBHOOK_SECRET;
  else process.env.DODO_PAYMENTS_WEBHOOK_SECRET = previousSecret;
});

const now = () => String(Math.floor(Date.now() / 1000));

test("accepts a correctly signed, fresh webhook", async () => {
  const id = "msg_1";
  const ts = now();
  const ok = await verifyDodoWebhookSignature(body, {
    webhookId: id,
    webhookTimestamp: ts,
    webhookSignature: sign(id, ts, body),
  });
  assert.equal(ok, true);
});

test("rejects an unsigned body even when it names a real payment", async () => {
  const ok = await verifyDodoWebhookSignature(body, {
    webhookId: null,
    webhookTimestamp: null,
    webhookSignature: null,
  });
  assert.equal(ok, false);
});

test("rejects a body altered after signing", async () => {
  const id = "msg_2";
  const ts = now();
  const tampered = body.replace("u1", "u2");
  const ok = await verifyDodoWebhookSignature(tampered, {
    webhookId: id,
    webhookTimestamp: ts,
    webhookSignature: sign(id, ts, body),
  });
  assert.equal(ok, false);
});

test("rejects a signature made with a different secret", async () => {
  const id = "msg_3";
  const ts = now();
  const ok = await verifyDodoWebhookSignature(body, {
    webhookId: id,
    webhookTimestamp: ts,
    webhookSignature: sign(id, ts, body, randomBytes(24)),
  });
  assert.equal(ok, false);
});

test("rejects a stale timestamp even with a valid signature", async () => {
  const id = "msg_4";
  const ts = String(Math.floor(Date.now() / 1000) - 3600);
  const ok = await verifyDodoWebhookSignature(body, {
    webhookId: id,
    webhookTimestamp: ts,
    webhookSignature: sign(id, ts, body),
  });
  assert.equal(ok, false);
});

test("fails closed when the webhook secret is not configured", async () => {
  delete process.env.DODO_PAYMENTS_WEBHOOK_SECRET;
  const id = "msg_5";
  const ts = now();
  const ok = await verifyDodoWebhookSignature(body, {
    webhookId: id,
    webhookTimestamp: ts,
    webhookSignature: sign(id, ts, body),
  });
  assert.equal(ok, false);
});
