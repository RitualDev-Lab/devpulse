export type HeartbeatState = "pending" | "up" | "running" | "late" | "failed";

export interface CronHeartbeatMetadata {
  intervalMinutes: number;
  graceMinutes: number;
  maxDurationSeconds: number | null;
  state: HeartbeatState;
  startedAt: string | null;
  lastPingAt: string | null;
  lastDurationMs: number | null;
  nextDueAt: string | null;
  alertSent: boolean;
  lastMessage: string | null;
}

export function parseHeartbeatMetadata(raw?: string | null): CronHeartbeatMetadata {
  try {
    const parsed = raw ? JSON.parse(raw) : {};
    return {
      intervalMinutes: Math.max(1, Number(parsed.intervalMinutes || 60)),
      graceMinutes: Math.max(1, Number(parsed.graceMinutes || 5)),
      maxDurationSeconds:
        typeof parsed.maxDurationSeconds === "number" && parsed.maxDurationSeconds > 0
          ? parsed.maxDurationSeconds
          : null,
      state: (["pending", "up", "running", "late", "failed"].includes(parsed.state)
        ? parsed.state
        : "pending") as HeartbeatState,
      startedAt: typeof parsed.startedAt === "string" ? parsed.startedAt : null,
      lastPingAt: typeof parsed.lastPingAt === "string" ? parsed.lastPingAt : null,
      lastDurationMs: typeof parsed.lastDurationMs === "number" ? parsed.lastDurationMs : null,
      nextDueAt: typeof parsed.nextDueAt === "string" ? parsed.nextDueAt : null,
      alertSent: Boolean(parsed.alertSent),
      lastMessage: typeof parsed.lastMessage === "string" ? parsed.lastMessage : null,
    };
  } catch {
    return {
      intervalMinutes: 60,
      graceMinutes: 5,
      maxDurationSeconds: null,
      state: "pending",
      startedAt: null,
      lastPingAt: null,
      lastDurationMs: null,
      nextDueAt: null,
      alertSent: false,
      lastMessage: null,
    };
  }
}

export function evaluateHeartbeatDue(
  meta: CronHeartbeatMetadata,
  nowMs = Date.now()
): { overdue: boolean; reason: string | null } {
  if (meta.state === "running" && meta.startedAt && meta.maxDurationSeconds) {
    const startMs = Date.parse(meta.startedAt);
    if (Number.isFinite(startMs) && nowMs > startMs + meta.maxDurationSeconds * 1000) {
      return {
        overdue: true,
        reason: `Exceeded max runtime (${meta.maxDurationSeconds}s)`,
      };
    }
  }

  if (meta.nextDueAt && meta.state !== "failed") {
    const dueMs = Date.parse(meta.nextDueAt);
    if (Number.isFinite(dueMs) && nowMs > dueMs + meta.graceMinutes * 60 * 1000) {
      return {
        overdue: true,
        reason: `Missed expected schedule (+${meta.graceMinutes}m grace window)`,
      };
    }
  }

  return { overdue: false, reason: null };
}
