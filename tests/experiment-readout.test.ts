import test from "node:test";
import assert from "node:assert/strict";
import {
  buildExperimentReadout,
  inverseNormalCdf,
  newcombeDifferenceInterval,
  wilsonInterval,
  type ExperimentRow,
} from "../src/lib/flags/experiment-readout";

const variants = [
  { name: "control", weight: 50 },
  { name: "treatment", weight: 50 },
];

function arm(variant: string, users: number, converted: number, prefix = variant): ExperimentRow[] {
  const rows: ExperimentRow[] = [];
  for (let i = 0; i < users; i++) {
    rows.push({ userHash: `${prefix}-${i}`, variant, converted: i < converted });
  }
  return rows;
}

test("inverse normal matches known quantiles", () => {
  assert.ok(Math.abs(inverseNormalCdf(0.975) - 1.959964) < 1e-5);
  assert.ok(Math.abs(inverseNormalCdf(0.9875) - 2.241403) < 1e-5);
  assert.ok(Math.abs(inverseNormalCdf(0.001) + 3.090232) < 1e-5);
});

test("wilson interval stays inside [0, 1] and handles zero successes", () => {
  const [lo, hi] = wilsonInterval(0, 50, 1.96);
  assert.equal(lo, 0);
  assert.ok(hi > 0 && hi < 0.1);
  const [lo2, hi2] = wilsonInterval(50, 50, 1.96);
  assert.ok(lo2 > 0.9 && hi2 === 1);
});

test("newcombe interval brackets the observed difference", () => {
  const r = newcombeDifferenceInterval({ successes: 40, trials: 100 }, { successes: 10, trials: 100 }, 1.96);
  assert.ok(Math.abs(r.difference - 0.3) < 1e-12);
  assert.ok(r.lower > 0.18 && r.lower < 0.3);
  assert.ok(r.upper > 0.3 && r.upper < 0.42);
});

test("reports a significant win only when the interval excludes zero", () => {
  const readout = buildExperimentReadout({
    variants,
    rows: [...arm("control", 200, 20), ...arm("treatment", 200, 60)],
    hashingEnabled: true,
    truncated: false,
  });
  assert.equal(readout.available, true);
  const treatment = readout.arms.find((a) => a.variant === "treatment")!;
  assert.equal(treatment.status, "significant_positive");
  assert.equal(treatment.exposedUsers, 200);
  assert.equal(treatment.convertedUsers, 60);
  assert.equal(treatment.differencePoints, 20);
  assert.ok(treatment.ciLowerPoints! > 0);
});

test("near-equal arms are inconclusive, not a win", () => {
  const readout = buildExperimentReadout({
    variants,
    rows: [...arm("control", 150, 30), ...arm("treatment", 150, 33)],
    hashingEnabled: true,
    truncated: false,
  });
  assert.equal(readout.arms.find((a) => a.variant === "treatment")!.status, "inconclusive");
});

test("withholds a verdict below the minimum users per arm", () => {
  const readout = buildExperimentReadout({
    variants,
    rows: [...arm("control", 99, 0), ...arm("treatment", 500, 500)],
    hashingEnabled: true,
    truncated: false,
  });
  assert.equal(readout.arms.find((a) => a.variant === "treatment")!.status, "insufficient_data");
});

test("fails closed without hashing, on truncation, or without a control arm", () => {
  const rows = [...arm("control", 200, 20), ...arm("treatment", 200, 60)];
  assert.equal(buildExperimentReadout({ variants, rows, hashingEnabled: false, truncated: false }).available, false);
  assert.equal(buildExperimentReadout({ variants, rows, hashingEnabled: true, truncated: true }).available, false);
  const noControl = buildExperimentReadout({
    variants: [{ name: "a", weight: 50 }, { name: "b", weight: 50 }],
    rows,
    hashingEnabled: true,
    truncated: false,
  });
  assert.equal(noControl.available, false);
});

test("dedupes repeat rows per user, ignores unhashed rows, and excludes users seen in two variants", () => {
  const rows: ExperimentRow[] = [
    ...arm("control", 150, 0),
    // Same user exposed and converted many times is still one converted user.
    ...arm("treatment", 150, 0),
    { userHash: "treatment-0", variant: "treatment", converted: true },
    { userHash: "treatment-0", variant: "treatment", converted: true },
    // Unhashed rows never count.
    { userHash: null, variant: "treatment", converted: true },
    // A user seen in both variants is excluded from both arms.
    { userHash: "shared", variant: "control", converted: false },
    { userHash: "shared", variant: "treatment", converted: true },
  ];
  const readout = buildExperimentReadout({ variants, rows, hashingEnabled: true, truncated: false });
  const treatment = readout.arms.find((a) => a.variant === "treatment")!;
  assert.equal(treatment.exposedUsers, 150);
  assert.equal(treatment.convertedUsers, 1);
  assert.equal(readout.excludedCrossVariantUsers, 1);
  assert.equal(readout.arms.find((a) => a.variant === "control")!.exposedUsers, 150);
});

test("bonferroni correction makes a marginal treatment less likely to win with several treatments", () => {
  const rows = [
    ...arm("control", 300, 60),
    ...arm("a", 300, 90),
  ];
  const two = buildExperimentReadout({
    variants: [{ name: "control", weight: 34 }, { name: "a", weight: 33 }],
    rows,
    hashingEnabled: true,
    truncated: false,
  });
  const many = buildExperimentReadout({
    variants: [{ name: "control", weight: 34 }, { name: "a", weight: 33 }, { name: "b", weight: 33 }],
    rows,
    hashingEnabled: true,
    truncated: false,
  });
  const lowerTwo = two.arms.find((x) => x.variant === "a")!.ciLowerPoints!;
  const lowerMany = many.arms.find((x) => x.variant === "a")!.ciLowerPoints!;
  assert.ok(lowerMany < lowerTwo);
});
