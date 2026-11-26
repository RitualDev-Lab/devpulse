export interface ExperimentRow {
  userHash: string | null;
  variant: string;
  converted: boolean;
}

export interface ExperimentVariant {
  name: string;
  weight: number;
}

export type ExperimentArmStatus =
  | "control"
  | "insufficient_data"
  | "significant_positive"
  | "significant_negative"
  | "inconclusive";

export interface ExperimentArmResult {
  variant: string;
  weight: number;
  exposedUsers: number;
  convertedUsers: number;
  conversionRatePercent: number;
  /** Treatment minus control, in percentage points. Null for the control arm or when data is insufficient. */
  differencePoints: number | null;
  ciLowerPoints: number | null;
  ciUpperPoints: number | null;
  status: ExperimentArmStatus;
}

export interface ExperimentReadout {
  available: boolean;
  reason: string | null;
  controlVariant: string | null;
  minUsersPerArm: number;
  /** Users seen in more than one variant during the window. They are excluded from every arm. */
  excludedCrossVariantUsers: number;
  arms: ExperimentArmResult[];
}

export const EXPERIMENT_MIN_USERS_PER_ARM = 100;
export const EXPERIMENT_ALPHA = 0.05;

/** Acklam's rational approximation of the inverse standard normal CDF (relative error below 1.2e-9). */
export function inverseNormalCdf(p: number): number {
  if (!(p > 0 && p < 1)) throw new RangeError("p must be between 0 and 1 exclusive");
  const a = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.38357751867269e2, -3.066479806614716e1, 2.506628277459239];
  const b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1, -1.328068155288572e1];
  const c = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416];
  const pLow = 0.02425;
  const pHigh = 1 - pLow;
  if (p < pLow) {
    const q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  if (p <= pHigh) {
    const q = p - 0.5;
    const r = q * q;
    return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q /
      (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
  }
  const q = Math.sqrt(-2 * Math.log(1 - p));
  return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
    ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
}

/** Wilson score interval for a proportion, as fractions in [0, 1]. */
export function wilsonInterval(successes: number, trials: number, z: number): [number, number] {
  if (trials <= 0) return [0, 1];
  const p = successes / trials;
  const z2 = z * z;
  const denominator = 1 + z2 / trials;
  const center = (p + z2 / (2 * trials)) / denominator;
  const half = (z * Math.sqrt((p * (1 - p)) / trials + z2 / (4 * trials * trials))) / denominator;
  return [Math.max(0, center - half), Math.min(1, center + half)];
}

/**
 * Newcombe hybrid-score interval for the difference treatment - control, built from Wilson arm intervals.
 * Returns fractions, not percentages.
 */
export function newcombeDifferenceInterval(
  treatment: { successes: number; trials: number },
  control: { successes: number; trials: number },
  z: number,
): { difference: number; lower: number; upper: number } {
  const pT = treatment.successes / treatment.trials;
  const pC = control.successes / control.trials;
  const [lT, uT] = wilsonInterval(treatment.successes, treatment.trials, z);
  const [lC, uC] = wilsonInterval(control.successes, control.trials, z);
  const difference = pT - pC;
  return {
    difference,
    lower: difference - Math.sqrt((pT - lT) ** 2 + (uC - pC) ** 2),
    upper: difference + Math.sqrt((uT - pT) ** 2 + (pC - lC) ** 2),
  };
}

function unavailable(
  variants: ExperimentVariant[],
  reason: string,
  minUsersPerArm: number,
  excludedCrossVariantUsers = 0,
): ExperimentReadout {
  return {
    available: false,
    reason,
    controlVariant: null,
    minUsersPerArm,
    excludedCrossVariantUsers,
    arms: variants.map((v) => ({
      variant: v.name,
      weight: v.weight,
      exposedUsers: 0,
      convertedUsers: 0,
      conversionRatePercent: 0,
      differencePoints: null,
      ciLowerPoints: null,
      ciUpperPoints: null,
      status: "insufficient_data",
    })),
  };
}

/**
 * Per-variant conversion readout over deduplicated users.
 * Fails closed: no readout without hashed identities, a complete (untruncated) sample, a control arm,
 * and at least EXPERIMENT_MIN_USERS_PER_ARM exposed users in each arm before any verdict is given.
 */
export function buildExperimentReadout(params: {
  variants: ExperimentVariant[];
  rows: ExperimentRow[];
  hashingEnabled: boolean;
  truncated: boolean;
  controlVariant?: string;
  alpha?: number;
  minUsersPerArm?: number;
}): ExperimentReadout {
  const minUsers = params.minUsersPerArm ?? EXPERIMENT_MIN_USERS_PER_ARM;
  const alpha = params.alpha ?? EXPERIMENT_ALPHA;
  const variants = params.variants;
  const control = params.controlVariant ?? "control";

  if (!params.hashingEnabled) return unavailable(variants, "ANALYTICS_HASH_SECRET is not set; users cannot be matched.", minUsers);
  if (params.truncated) return unavailable(variants, "Too many exposure rows in the window; readout paused rather than sampling.", minUsers);
  if (!variants.some((v) => v.name === control)) return unavailable(variants, `No "${control}" variant to compare against.`, minUsers);
  if (variants.length < 2) return unavailable(variants, "At least two variants are required.", minUsers);

  // Keep only hashed identities, and drop any user seen in more than one variant.
  const variantsByUser = new Map<string, Set<string>>();
  for (const row of params.rows) {
    if (!row.userHash) continue;
    const set = variantsByUser.get(row.userHash) ?? new Set<string>();
    set.add(row.variant);
    variantsByUser.set(row.userHash, set);
  }
  let excludedCrossVariantUsers = 0;
  const exposed = new Map<string, Set<string>>();
  const converted = new Map<string, Set<string>>();
  for (const v of variants) {
    exposed.set(v.name, new Set());
    converted.set(v.name, new Set());
  }
  for (const [, set] of variantsByUser) {
    if (set.size > 1) excludedCrossVariantUsers++;
  }
  for (const row of params.rows) {
    if (!row.userHash) continue;
    const seenIn = variantsByUser.get(row.userHash);
    if (!seenIn || seenIn.size !== 1) continue;
    exposed.get(row.variant)?.add(row.userHash);
    if (row.converted) converted.get(row.variant)?.add(row.userHash);
  }

  const treatments = variants.filter((v) => v.name !== control);
  const zCrit = inverseNormalCdf(1 - alpha / (2 * treatments.length));
  const controlExposed = exposed.get(control)?.size ?? 0;
  const controlConverted = converted.get(control)?.size ?? 0;

  const arms: ExperimentArmResult[] = variants.map((v) => {
    const exposedUsers = exposed.get(v.name)?.size ?? 0;
    const convertedUsers = Math.min(converted.get(v.name)?.size ?? 0, exposedUsers);
    const base = {
      variant: v.name,
      weight: v.weight,
      exposedUsers,
      convertedUsers,
      conversionRatePercent: exposedUsers > 0 ? Math.round((convertedUsers / exposedUsers) * 1000) / 10 : 0,
    };
    if (v.name === control) {
      return { ...base, differencePoints: null, ciLowerPoints: null, ciUpperPoints: null, status: "control" };
    }
    if (exposedUsers < minUsers || controlExposed < minUsers) {
      return { ...base, differencePoints: null, ciLowerPoints: null, ciUpperPoints: null, status: "insufficient_data" };
    }
    const interval = newcombeDifferenceInterval(
      { successes: convertedUsers, trials: exposedUsers },
      { successes: controlConverted, trials: controlExposed },
      zCrit,
    );
    const status: ExperimentArmStatus =
      interval.lower > 0 ? "significant_positive" : interval.upper < 0 ? "significant_negative" : "inconclusive";
    return {
      ...base,
      differencePoints: round2(interval.difference * 100),
      ciLowerPoints: round2(interval.lower * 100),
      ciUpperPoints: round2(interval.upper * 100),
      status,
    };
  });

  return {
    available: true,
    reason: null,
    controlVariant: control,
    minUsersPerArm: minUsers,
    excludedCrossVariantUsers,
    arms,
  };
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
