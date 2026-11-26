export interface VariantCrashSample {
  exposedUsers: number;
  crashedUsers: number;
}

export interface FlagUserOutcome {
  userHash: string | null;
  variant: string;
}

export interface RollbackDecision {
  shouldRollback: boolean;
  treatmentRatePercent: number | null;
  controlRatePercent: number | null;
  riskDifferenceLowerBoundPercent: number | null;
  reason: string;
}

/** Build independent, deduplicated control/treatment samples from matched HMAC identities. */
export function summarizeFlagCrashSamples(
  exposures: FlagUserOutcome[],
  crashes: FlagUserOutcome[],
  treatmentVariant: string,
): { control: VariantCrashSample; treatment: VariantCrashSample } {
  const controlUsers = new Set<string>();
  const treatmentUsers = new Set<string>();
  const controlCrashes = new Set<string>();
  const treatmentCrashes = new Set<string>();

  for (const exposure of exposures) {
    if (!exposure.userHash) continue;
    if (exposure.variant === "control") controlUsers.add(exposure.userHash);
    else if (exposure.variant === treatmentVariant) treatmentUsers.add(exposure.userHash);
  }

  for (const crash of crashes) {
    if (!crash.userHash) continue;
    if (crash.variant === "control" && controlUsers.has(crash.userHash)) {
      controlCrashes.add(crash.userHash);
    } else if (crash.variant === treatmentVariant && treatmentUsers.has(crash.userHash)) {
      treatmentCrashes.add(crash.userHash);
    }
  }

  return {
    control: { exposedUsers: controlUsers.size, crashedUsers: controlCrashes.size },
    treatment: { exposedUsers: treatmentUsers.size, crashedUsers: treatmentCrashes.size },
  };
}

// Use 97.5% one-sided bounds for each arm. By the union bound, subtracting
// treatment's lower bound from control's upper bound gives at least 95% coverage.
const Z_ONE_SIDED_97_5 = 1.959963984540054;

function wilsonBound(successes: number, trials: number, direction: "lower" | "upper"): number | null {
  if (
    !Number.isSafeInteger(successes) ||
    !Number.isSafeInteger(trials) ||
    trials <= 0 ||
    successes < 0 ||
    successes > trials
  ) {
    return null;
  }
  const z = Z_ONE_SIDED_97_5;
  const z2 = z ** 2;
  const p = successes / trials;
  const denominator = 1 + z2 / trials;
  const center = p + z2 / (2 * trials);
  const margin = z * Math.sqrt((p * (1 - p) + z2 / (4 * trials)) / trials);
  return Math.max(0, Math.min(1, (center + (direction === "upper" ? margin : -margin)) / denominator));
}

/**
 * Require adequate distinct-user samples in both control and treatment and a one-sided
 * conservative 95% Wilson risk-difference lower bound above zero before calling a
 * crash-rate increase real.
 */
export function assessCrashRollback(params: {
  control: VariantCrashSample;
  treatment: VariantCrashSample;
  thresholdPercent: number;
  minimumUsersPerArm?: number;
  minimumTreatmentCrashes?: number;
}): RollbackDecision {
  const minUsers = params.minimumUsersPerArm ?? 50;
  const minCrashes = params.minimumTreatmentCrashes ?? 3;
  const { control, treatment } = params;
  const validSample = (sample: VariantCrashSample) =>
    Number.isSafeInteger(sample.exposedUsers) &&
    Number.isSafeInteger(sample.crashedUsers) &&
    sample.exposedUsers >= 0 &&
    sample.crashedUsers >= 0 &&
    sample.crashedUsers <= sample.exposedUsers;
  if (
    !validSample(control) ||
    !validSample(treatment) ||
    !Number.isFinite(params.thresholdPercent) ||
    !Number.isSafeInteger(minUsers) ||
    minUsers < 1 ||
    !Number.isSafeInteger(minCrashes) ||
    minCrashes < 1
  ) {
    return {
      shouldRollback: false,
      treatmentRatePercent: null,
      controlRatePercent: null,
      riskDifferenceLowerBoundPercent: null,
      reason: "invalid statistical sample or rollback settings",
    };
  }
  const controlRate = control.exposedUsers > 0 ? control.crashedUsers / control.exposedUsers : null;
  const treatmentRate = treatment.exposedUsers > 0 ? treatment.crashedUsers / treatment.exposedUsers : null;
  const base = {
    treatmentRatePercent: treatmentRate === null ? null : treatmentRate * 100,
    controlRatePercent: controlRate === null ? null : controlRate * 100,
    riskDifferenceLowerBoundPercent: null,
  };

  if (control.exposedUsers < minUsers || treatment.exposedUsers < minUsers) {
    return { ...base, shouldRollback: false, reason: `insufficient distinct users (need ${minUsers} per arm)` };
  }
  if (treatment.crashedUsers < minCrashes || treatmentRate === null || controlRate === null) {
    return { ...base, shouldRollback: false, reason: `fewer than ${minCrashes} distinct treatment crashes` };
  }

  const treatmentLower = wilsonBound(treatment.crashedUsers, treatment.exposedUsers, "lower");
  const controlUpper = wilsonBound(control.crashedUsers, control.exposedUsers, "upper");
  if (treatmentLower === null || controlUpper === null) {
    return { ...base, shouldRollback: false, reason: "invalid statistical sample" };
  }
  const lowerDifference = treatmentLower - controlUpper;
  const differencePercent = lowerDifference * 100;
  const exceedsThreshold = treatmentRate * 100 >= Math.max(0, params.thresholdPercent);
  const statisticallyHigher = lowerDifference > 0;

  return {
    ...base,
    riskDifferenceLowerBoundPercent: differencePercent,
    shouldRollback: exceedsThreshold && statisticallyHigher,
    reason: exceedsThreshold && statisticallyHigher
      ? `treatment crash rate is at least ${params.thresholdPercent}% and its one-sided 95% risk-difference lower bound is ${differencePercent.toFixed(2)}%`
      : !exceedsThreshold
        ? `treatment crash rate ${ (treatmentRate * 100).toFixed(2) }% is below ${params.thresholdPercent}% threshold`
        : `95% risk-difference lower bound ${differencePercent.toFixed(2)}% does not exceed zero`,
  };
}
