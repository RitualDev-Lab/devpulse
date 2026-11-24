export function formatNumber(num: number | undefined | null): string {
  if (num === undefined || num === null) return "0";
  return num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
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
