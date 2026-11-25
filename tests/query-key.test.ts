import test, { before } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";

// Keys in query strings leak into logs and referrers. Each route must ignore them and fail
// before touching the database, so an unauthenticated request gets 401 with no DB dependency.
process.env.TURSO_DATABASE_URL = "http://127.0.0.1:9";
process.env.TURSO_AUTH_TOKEN = "test-token";

const KEY = "dp_live_querystringsecret123";

type Handler = (req: NextRequest) => Promise<Response>;
let flagsGet: Handler;
let otlpPost: Handler;
let lokiPost: Handler;
let deployPost: Handler;

before(async () => {
  flagsGet = (await import("../src/app/api/v1/flags/evaluate/route")).GET as Handler;
  otlpPost = (await import("../src/app/api/v1/ingest/otlp/traces/route")).POST as Handler;
  lokiPost = (await import("../src/app/api/v1/loki/api/v1/push/route")).POST as Handler;
  deployPost = (await import("../src/app/api/v1/webhooks/deploy/route")).POST as Handler;
});

function req(url: string, init: { method?: string; body?: string } = {}) {
  return new NextRequest(url, { method: init.method || "POST", body: init.body, headers: { "content-type": "application/json" } });
}

test("flag evaluation rejects an API key supplied only in the query string", async () => {
  const res = await flagsGet(req(`https://dp.test/api/v1/flags/evaluate?apiKey=${KEY}&key=beta`, { method: "GET" }));
  assert.equal(res.status, 401);
  assert.ok(!JSON.stringify(await res.json()).includes(KEY));
});

test("OTLP traces reject an API key supplied only in the query string", async () => {
  const res = await otlpPost(req(`https://dp.test/api/v1/ingest/otlp/traces?apiKey=${KEY}`, { body: "{}" }));
  assert.equal(res.status, 401);
});

test("Loki push rejects an API key supplied only in the query string", async () => {
  const res = await lokiPost(req(`https://dp.test/api/v1/loki/api/v1/push?apiKey=${KEY}`, { body: "{}" }));
  assert.equal(res.status, 401);
});

test("deploy webhook rejects an API key supplied only in the query string", async () => {
  const res = await deployPost(req(`https://dp.test/api/v1/webhooks/deploy?apiKey=${KEY}`, { body: "{}" }));
  assert.equal(res.status, 401);
  assert.ok(!JSON.stringify(await res.json()).includes(KEY));
});
