export function currencyMinorUnitDigits(currency: string): number {
  try {
    return new Intl.NumberFormat("en", { style: "currency", currency: currency.toUpperCase() }).resolvedOptions().maximumFractionDigits ?? 2;
  } catch {
    return 2;
  }
}

export function minorToMajor(amountMinor: number, currency: string): number {
  const amount = Number(amountMinor);
  if (!Number.isFinite(amount)) return 0;
  return amount / 10 ** currencyMinorUnitDigits(currency);
}

export type TransactionState = "settled" | "pending" | "refunded" | "chargeback" | "failed" | "unknown";

// Single source of truth for provider status strings. Unpaid invoices are money still owed,
// so they count as pending exposure instead of being silently ignored.
const STATE_BY_STATUS: Record<string, TransactionState> = {
  succeeded: "settled",
  paid: "settled",
  captured: "settled",
  completed: "settled",
  pending: "pending",
  processing: "pending",
  requires_action: "pending",
  requires_capture: "pending",
  requires_confirmation: "pending",
  authorized: "pending",
  open: "pending",
  past_due: "pending",
  unpaid: "pending",
  refunded: "refunded",
  partially_refunded: "refunded",
  "partially refunded": "refunded",
  disputed: "chargeback",
  chargeback: "chargeback",
  charged_back: "chargeback",
  chargebacked: "chargeback",
  failed: "failed",
  canceled: "failed",
  cancelled: "failed",
  voided: "failed",
  expired: "failed",
  rejected: "failed",
  uncollectible: "failed",
};

export function classifyTransactionState(status: unknown): TransactionState {
  return STATE_BY_STATUS[String(status || "").trim().toLowerCase()] ?? "unknown";
}

export function isSettledPayment(status: unknown): boolean {
  return classifyTransactionState(status) === "settled";
}

export function withinTrailingDays(createdAt: string | number | null | undefined, now = Date.now(), days = 30): boolean {
  const numeric = typeof createdAt === "number" ? createdAt : Number(createdAt);
  const timestamp = typeof createdAt === "number" || (String(createdAt || "").trim() !== "" && Number.isFinite(numeric))
    ? (numeric > 1e12 ? numeric : numeric * 1000)
    : new Date(String(createdAt || "")).getTime();
  return Number.isFinite(timestamp) && timestamp >= now - days * 86400_000 && timestamp <= now;
}
