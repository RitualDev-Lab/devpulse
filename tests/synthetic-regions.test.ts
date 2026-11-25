import { test } from "node:test";
import assert from "node:assert/strict";
import { EDGE_REGIONS, resolveSyntheticRegions, MAX_SYNTHETIC_REGIONS } from "../src/lib/synthetics/regions";

const defaults = ["iad", "fra", "sin", "syd", "gru"];

test("missing or malformed regionsJson falls back to the default labels", () => {
  assert.deepEqual(resolveSyntheticRegions(null), defaults);
  assert.deepEqual(resolveSyntheticRegions(undefined), defaults);
  assert.deepEqual(resolveSyntheticRegions("not json"), defaults);
  assert.deepEqual(resolveSyntheticRegions('{"iad":1}'), defaults);
  assert.deepEqual(resolveSyntheticRegions("[]"), defaults);
});

test("unknown labels are dropped and duplicates removed", () => {
  assert.deepEqual(resolveSyntheticRegions('["fra","mars","fra","iad"]'), ["fra", "iad"]);
});

test("a list with no known labels falls back to the defaults", () => {
  assert.deepEqual(resolveSyntheticRegions('["mars","X-Injected: 1"]'), defaults);
});

test("resolved labels are capped at the maximum", () => {
  const all = resolveSyntheticRegions(JSON.stringify([...defaults, "iad"]));
  assert.equal(all.length, MAX_SYNTHETIC_REGIONS);
});

test("default region ids are unique", () => {
  const ids = EDGE_REGIONS.map((r) => r.id);
  assert.equal(new Set(ids).size, ids.length);
});
