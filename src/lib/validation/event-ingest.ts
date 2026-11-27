/**
 * Strict Event Ingestion Validator & Replay Timestamp Normalizer
 * Protects `/api/v1/event` from oversized payloads, malformed replay timestamps (RangeError),
 * unbounded fields, and late JSON parsing before key/rate-limit checks.
 */

export const DEFAULT_MAX_EVENT_BYTES = 262_144; // 256 KiB

const MIN_VALID_EPOCH_MS = Date.UTC(2000, 0, 1);
const MAX_FUTURE_SKEW_MS = 86_400_000; // +24h

export function getMaxEventBytes(env: Record<string, string | undefined> = process.env): number {
  const raw = Number(env.DEVPULSE_MAX_EVENT_BYTES || "");
  if (Number.isFinite(raw) && raw >= 4096 && raw <= 10 * 1024 * 1024) {
    return Math.floor(raw);
  }
  return DEFAULT_MAX_EVENT_BYTES;
}

export function toSafeIsoTimestamp(
  raw: unknown,
  nowMs = Date.now()
): { ok: true; iso: string } | { ok: false; reason: string } {
  if (raw === undefined || raw === null) {
    return { ok: true, iso: new Date(nowMs).toISOString() };
  }

  let epochMs: number;
  if (typeof raw === "number") {
    if (!Number.isFinite(raw)) {
      return { ok: false, reason: "Replay frame timestamp must be a finite epoch millisecond number" };
    }
    epochMs = raw;
  } else if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (!trimmed) return { ok: true, iso: new Date(nowMs).toISOString() };
    epochMs = Date.parse(trimmed);
    if (!Number.isFinite(epochMs)) {
      return { ok: false, reason: "Replay frame timestamp string is not a valid ISO date" };
    }
  } else {
    return { ok: false, reason: "Replay frame timestamp has unsupported type" };
  }

  if (epochMs < MIN_VALID_EPOCH_MS || epochMs > nowMs + MAX_FUTURE_SKEW_MS) {
    return {
      ok: false,
      reason: "Replay frame timestamp is out of acceptable range (2000-01-01 to now + 24h)",
    };
  }

  return { ok: true, iso: new Date(epochMs).toISOString() };
}

export interface ValidatedReplayFrame {
  tIso: string;
  kind: string;
  label: string;
  offsetMs: number;
  detail?: string;
}

export interface ValidatedEventSchemaResult {
  rawStack: string;
  rawLogs: string;
  replayFrames: ValidatedReplayFrame[];
  affectedUsersCount: number;
}

export function validateEventIngestPayload(
  rawBody: unknown,
  nowMs = Date.now()
):
  | { ok: true; value: ValidatedEventSchemaResult }
  | { ok: false; error: string } {
  if (!rawBody || typeof rawBody !== "object" || Array.isArray(rawBody)) {
    return { ok: false, error: "Event payload must be a JSON object" };
  }

  const body = rawBody as Record<string, unknown>;
  const stackInput = body.stackTrace ?? body.stack_trace ?? body.stack;
  const logsInput = body.terminalLogs ?? body.terminal_logs ?? body.logs;

  if (stackInput !== undefined && stackInput !== null && typeof stackInput !== "string") {
    return { ok: false, error: "stackTrace must be a string" };
  }
  if (logsInput !== undefined && logsInput !== null && typeof logsInput !== "string") {
    return { ok: false, error: "terminalLogs must be a string" };
  }

  const rawStack = typeof stackInput === "string" ? stackInput.slice(0, 64_000) : "";
  const rawLogs = typeof logsInput === "string" ? logsInput.slice(0, 64_000) : "";

  if (body.breadcrumbs !== undefined && body.breadcrumbs !== null && !Array.isArray(body.breadcrumbs)) {
    return { ok: false, error: "breadcrumbs must be an array" };
  }

  if (body.replayTimeline !== undefined && body.replayTimeline !== null && !Array.isArray(body.replayTimeline)) {
    return { ok: false, error: "replayTimeline must be an array" };
  }

  const replayFrames: ValidatedReplayFrame[] = [];
  if (Array.isArray(body.replayTimeline)) {
    for (const frame of body.replayTimeline.slice(-80)) {
      if (!frame || typeof frame !== "object" || Array.isArray(frame)) {
        return { ok: false, error: "Each replayTimeline entry must be an object" };
      }
      const f = frame as Record<string, unknown>;
      const tsCheck = toSafeIsoTimestamp(f.t, nowMs);
      if (!tsCheck.ok) {
        return { ok: false, error: tsCheck.reason };
      }
      const rawOffset = f.offsetMs;
      if (rawOffset !== undefined && (typeof rawOffset !== "number" || !Number.isFinite(rawOffset))) {
        return { ok: false, error: "Replay frame offsetMs must be a finite number" };
      }
      replayFrames.push({
        tIso: tsCheck.iso,
        kind: typeof f.kind === "string" ? f.kind.slice(0, 16) : "dom",
        label: String(f.label || "event").slice(0, 200),
        offsetMs: typeof rawOffset === "number" ? rawOffset : 0,
        detail: f.detail ? String(f.detail).slice(0, 240) : undefined,
      });
    }
  }

  const rawUsers = Number(body.affectedUsersCount ?? body.usersAffected ?? 1);
  if (!Number.isFinite(rawUsers) || rawUsers < 0 || rawUsers > 10_000_000) {
    return { ok: false, error: "affectedUsersCount must be a bounded positive number" };
  }

  return {
    ok: true,
    value: {
      rawStack,
      rawLogs,
      replayFrames,
      affectedUsersCount: Math.max(1, Math.floor(rawUsers)),
    },
  };
}
