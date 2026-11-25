import { test } from "node:test";
import assert from "node:assert/strict";
import { summarizeRevenue } from "../src/lib/revenue/connector-totals";

test("single-currency rows are summed in minor units", () => {
  const totals = summarizeRevenue(
    [
      { amountMinor: 1000, currency: "usd" },
      { amountMinor: 250, currency: "USD" },
    ],
    "INR",
  );
  assert.deepEqual(totals, { totalRevenueCents: 1250, currency: "USD" });
});

test("mixed currencies are not summed", () => {
  const totals = summarizeRevenue(
    [
      { amountMinor: 1000, currency: "USD" },
      { amountMinor: 50000, currency: "INR" },
    ],
    "USD",
  );
  assert.deepEqual(totals, { totalRevenueCents: null, currency: null });
});

test("rows without a currency use the fallback", () => {
  const totals = summarizeRevenue([{ amountMinor: 500, currency: null }], "INR");
  assert.deepEqual(totals, { totalRevenueCents: 500, currency: "INR" });
});

test("no rows gives zero in the fallback currency", () => {
  assert.deepEqual(summarizeRevenue([], "USD"), { totalRevenueCents: 0, currency: "USD" });
});

test("non-finite amounts count as zero", () => {
  const totals = summarizeRevenue([{ amountMinor: Number.NaN, currency: "USD" }, { amountMinor: 200, currency: "USD" }], "USD");
  assert.deepEqual(totals, { totalRevenueCents: 200, currency: "USD" });
});
