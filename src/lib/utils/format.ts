export function formatNumber(num: number | undefined | null): string {
  if (num === undefined || num === null) return "0";
  return num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

export function formatCompactNumber(num: number | undefined | null): string {
  if (num === undefined || num === null) return "0";
  if (num >= 1_000_000_000) return `${(num / 1_000_000_000).toFixed(2)}B`;
  if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(1)}M`;
  if (num >= 100_000) return `${(num / 1_000).toFixed(0)}k`;
  return formatNumber(num);
}

export function formatCurrency(amount: number | undefined | null, currency: string = "USD"): string {
  const val = formatNumber(Math.round(amount || 0));
  const curr = (currency || "USD").toUpperCase();
  if (curr === "INR") return `₹${val}`;
  if (curr === "EUR") return `€${val}`;
  if (curr === "GBP") return `£${val}`;
  return `$${val}`;
}

export function formatDate(dateString: string | undefined | null): string {
  if (!dateString) return "";
  try {
    const d = new Date(dateString);
    if (isNaN(d.getTime())) return String(dateString);
    return d.toISOString().split("T")[0];
  } catch {
    return String(dateString || "");
  }
}

export function formatTime(dateString: string | undefined | null): string {
  if (!dateString) return "";
  try {
    const d = new Date(dateString);
    if (isNaN(d.getTime())) return String(dateString);
    return d.toISOString().slice(11, 16) + " UTC";
  } catch {
    return String(dateString || "");
  }
}
