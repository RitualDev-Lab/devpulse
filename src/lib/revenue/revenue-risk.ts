import { classifyTransactionState } from "@/lib/revenue/transaction-rules";

export interface RevenueAtRiskSample {
  amountMinor: number;
  currency: string;
  status: string;
  createdAt: string;
  provider: string;
}

export interface RevenueAtRiskByCurrency {
  currency: string;
  transactionCount: number;
  settledAmountMinor: number;
  pendingAmountMinor: number;
  failedAmountMinor: number;
  refundedAmountMinor: number;
  chargebackAmountMinor: number;
  exposedAmountMinor: number;
  riskScorePercent: number;
  providers: string[];
  /** True when the input was a capped recent sample, so totals may not be the full 30-day population. */
  sampleLimited: boolean;
}

export interface RevenueAtRiskOptions {
  sampleLimited?: boolean;
}

/**
 * Exposure = money pending collection plus disputed money. Risk = exposure / money that was
 * collected, pending, or disputed. Refunds and failures are reported but never counted as exposure.
 * Amounts are minor units and are never summed across currencies.
 */
export function summarizeRevenueAtRisk(
  rows: RevenueAtRiskSample[],
  now = new Date(),
  options: RevenueAtRiskOptions = {},
): RevenueAtRiskByCurrency[] {
  const byCurrency = new Map<string, RevenueAtRiskByCurrency>();
  const cutoff = now.getTime() - 30 * 86400_000;
  const sampleLimited = options.sampleLimited === true;

  for (const row of rows) {
    const timestamp = new Date(row.createdAt).getTime();
    if (!Number.isFinite(timestamp) || timestamp < cutoff || timestamp > now.getTime()) continue;
    const amount = Number(row.amountMinor);
    if (!Number.isSafeInteger(amount) || amount < 0) continue;
    const currency = String(row.currency || "").trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(currency)) continue;

    let summary = byCurrency.get(currency);
    if (!summary) {
      summary = {
        currency,
        transactionCount: 0,
        settledAmountMinor: 0,
        pendingAmountMinor: 0,
        failedAmountMinor: 0,
        refundedAmountMinor: 0,
        chargebackAmountMinor: 0,
        exposedAmountMinor: 0,
        riskScorePercent: 0,
        providers: [],
        sampleLimited,
      };
      byCurrency.set(currency, summary);
    }

    summary.transactionCount++;
    switch (classifyTransactionState(row.status)) {
      case "settled": summary.settledAmountMinor += amount; break;
      case "pending": summary.pendingAmountMinor += amount; break;
      case "refunded": summary.refundedAmountMinor += amount; break;
      case "chargeback": summary.chargebackAmountMinor += amount; break;
      case "failed": summary.failedAmountMinor += amount; break;
      default: break;
    }
    summary.exposedAmountMinor = summary.pendingAmountMinor + summary.chargebackAmountMinor;
    const assessedAmount = summary.settledAmountMinor + summary.pendingAmountMinor + summary.chargebackAmountMinor;
    summary.riskScorePercent = assessedAmount > 0 ? Math.min(100, Math.round(summary.exposedAmountMinor / assessedAmount * 100)) : 0;
    if (row.provider && !summary.providers.includes(row.provider)) summary.providers.push(row.provider);
  }

  return Array.from(byCurrency.values()).sort((a, b) => a.currency.localeCompare(b.currency));
}
