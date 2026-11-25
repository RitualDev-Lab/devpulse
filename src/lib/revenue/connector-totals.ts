/**
 * Connector sales totals. Pure module (no DB or network imports) so it can be unit-tested.
 */
export interface RevenueRow {
  /** Amount in the currency's minor unit (cents, paise). */
  amountMinor: number;
  currency: string | null | undefined;
}

export interface RevenueTotals {
  /** Null when rows mix currencies: amounts in different currencies are not summed. */
  totalRevenueCents: number | null;
  /** Null when rows mix currencies. */
  currency: string | null;
}

/**
 * Sums sales only when every row shares one currency. Rows without a currency use the
 * fallback. Mixed currencies return a null total and currency rather than a wrong sum.
 */
export function summarizeRevenue(rows: RevenueRow[], fallbackCurrency: string): RevenueTotals {
  const codes = Array.from(
    new Set(rows.map((r) => (r.currency ? String(r.currency).trim().toUpperCase() : fallbackCurrency))),
  );
  if (codes.length === 0) return { totalRevenueCents: 0, currency: fallbackCurrency };
  if (codes.length > 1) return { totalRevenueCents: null, currency: null };

  const total = rows.reduce((acc, r) => acc + (Number.isFinite(r.amountMinor) ? r.amountMinor : 0), 0);
  return { totalRevenueCents: total, currency: codes[0] };
}
