export interface MaintenanceWindowRecord {
  id: string;
  title: string;
  reason: string | null;
  startsAt: string;
  endsAt: string;
  suppressAlerts: boolean;
  isActiveNow: boolean;
  isUpcoming: boolean;
}

export interface MaintenanceMetadata {
  reason?: string | null;
  startsAt: string;
  endsAt: string;
  suppressAlerts: boolean;
}

export function parseMaintenanceMetadata(raw?: string | null): MaintenanceMetadata | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<MaintenanceMetadata>;
    if (!parsed.startsAt || !parsed.endsAt) return null;
    return {
      reason: typeof parsed.reason === "string" ? parsed.reason : null,
      startsAt: String(parsed.startsAt),
      endsAt: String(parsed.endsAt),
      suppressAlerts: parsed.suppressAlerts !== false,
    };
  } catch {
    return null;
  }
}

export function isWindowActiveAt(
  meta: Pick<MaintenanceMetadata, "startsAt" | "endsAt">,
  nowMs = Date.now()
): boolean {
  const startMs = Date.parse(meta.startsAt);
  const endMs = Date.parse(meta.endsAt);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
    return false;
  }
  return nowMs >= startMs && nowMs <= endMs;
}

export function formatMaintenanceWindowRow(
  row: { id: string; label: string; metadataJson: string | null },
  nowMs = Date.now()
): MaintenanceWindowRecord | null {
  const meta = parseMaintenanceMetadata(row.metadataJson);
  if (!meta) return null;
  const startMs = Date.parse(meta.startsAt);
  const isActiveNow = isWindowActiveAt(meta, nowMs);
  const isUpcoming = Number.isFinite(startMs) && startMs > nowMs;
  return {
    id: row.id,
    title: row.label,
    reason: meta.reason ?? null,
    startsAt: meta.startsAt,
    endsAt: meta.endsAt,
    suppressAlerts: meta.suppressAlerts,
    isActiveNow,
    isUpcoming,
  };
}
