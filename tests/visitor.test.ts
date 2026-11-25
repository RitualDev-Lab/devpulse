import { test } from "node:test";
import assert from "node:assert/strict";
import { buildVisitorId } from "../src/lib/analytics/visitor";

const base = {
  secret: "test-secret-value-for-unit-tests",
  projectId: "proj_1",
  ip: "203.0.113.7",
  userAgent: "Mozilla/5.0 (test)",
  now: new Date("2026-05-10T12:00:00Z"),
};

test("same visitor in the same month gets the same id", async () => {
  const a = await buildVisitorId(base);
  const b = await buildVisitorId({ ...base, now: new Date("2026-05-20T08:00:00Z") });
  assert.ok(a);
  assert.equal(a, b);
  assert.match(a, /^[0-9a-f]{32}$/);
});

test("id rotates at the month boundary", async () => {
  const may = await buildVisitorId(base);
  const june = await buildVisitorId({ ...base, now: new Date("2026-06-01T00:00:01Z") });
  assert.notEqual(may, june);
});

test("different ip, user agent, or project yields a different id", async () => {
  const id = await buildVisitorId(base);
  assert.notEqual(id, await buildVisitorId({ ...base, ip: "203.0.113.8" }));
  assert.notEqual(id, await buildVisitorId({ ...base, userAgent: "Other" }));
  assert.notEqual(id, await buildVisitorId({ ...base, projectId: "proj_2" }));
});

test("id does not contain the raw ip or secret", async () => {
  const id = await buildVisitorId(base);
  assert.ok(id);
  assert.ok(!id.includes("203.0.113.7"));
  assert.ok(!id.includes(base.secret));
});

test("returns null when the secret or a usable ip/user agent is missing", async () => {
  assert.equal(await buildVisitorId({ ...base, secret: "" }), null);
  assert.equal(await buildVisitorId({ ...base, ip: "" }), null);
  assert.equal(await buildVisitorId({ ...base, ip: "unknown" }), null);
  assert.equal(await buildVisitorId({ ...base, userAgent: "" }), null);
});
