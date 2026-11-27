/**
 * Sentry SDK v11 Streaming Span & Classic Event Envelope Parser
 * Enables 1-line Sentry DSN drop-in compatibility (`POST /api/v1/sentry/[projectId]/envelope`)
 * alongside native DevPulse telemetry and OpenTelemetry OTLP.
 */

import { scrubTelemetryText } from "@/lib/security/ingest-scrub";
import { toSafeIsoTimestamp } from "@/lib/validation/event-ingest";

export interface ParsedSentryEvent {
  eventId: string;
  itemType: "event" | "transaction" | "span";
  errorName: string;
  message: string;
  stackTrace: string;
  runtime: string;
  version: string | null;
  environment: string;
  routePath: string | null;
  timestampIso: string;
}

export function extractSentryKeyFromHeaders(headers: Headers, fallbackQueryKey?: string | null): string {
  const authHeader = headers.get("authorization");
  if (authHeader) {
    const bearer = authHeader.replace(/^Bearer\s+/i, "").trim();
    if (bearer && !bearer.startsWith("Sentry ")) return bearer;
  }

  const sentryAuth = headers.get("x-sentry-auth") || authHeader || "";
  const match = sentryAuth.match(/sentry_key=([A-Za-z0-9._-]+)/i);
  if (match?.[1]) return match[1].trim();

  return fallbackQueryKey?.trim() || "";
}

function formatSentryFrames(frames: Array<Record<string, unknown>>): string {
  return [...frames]
    .reverse()
    .slice(0, 60)
    .map((fr) => {
      const fn = scrubTelemetryText(String(fr.function || "<anonymous>"));
      const file = scrubTelemetryText(String(fr.filename || fr.abs_path || "<unknown>"));
      const line = fr.lineno ?? "?";
      const col = fr.colno ?? "?";
      return `    at ${fn} (${file}:${line}:${col})`;
    })
    .join("\n");
}

export function parseSentryEnvelope(
  rawBody: string
): { ok: true; events: ParsedSentryEvent[] } | { ok: false; error: string } {
  const lines = rawBody
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  if (lines.length === 0) {
    return { ok: false, error: "Empty Sentry envelope body" };
  }

  let header: Record<string, unknown> = {};
  try {
    header = JSON.parse(lines[0]) as Record<string, unknown>;
  } catch {
    return { ok: false, error: "Invalid Sentry envelope JSON header" };
  }

  const events: ParsedSentryEvent[] = [];
  let idx = 1;

  while (idx < lines.length) {
    let itemHeader: Record<string, unknown>;
    try {
      itemHeader = JSON.parse(lines[idx]) as Record<string, unknown>;
    } catch {
      return { ok: false, error: `Malformed Sentry item header at line ${idx + 1}` };
    }
    idx++;

    if (idx >= lines.length) break;
    let itemPayload: Record<string, unknown>;
    try {
      itemPayload = JSON.parse(lines[idx]) as Record<string, unknown>;
    } catch {
      return { ok: false, error: `Malformed Sentry item payload at line ${idx + 1}` };
    }
    idx++;

    const rawType = String(itemHeader.type || "event").toLowerCase();
    if (rawType !== "event" && rawType !== "transaction" && rawType !== "span") continue;

    const tsCheck = toSafeIsoTimestamp(
      itemPayload.timestamp ?? header.sent_at
    );
    if (!tsCheck.ok) {
      return { ok: false, error: tsCheck.reason };
    }

    const exceptionList = (itemPayload.exception as { values?: Array<Record<string, unknown>> } | undefined)?.values;
    const primaryEx = Array.isArray(exceptionList) && exceptionList.length > 0 ? exceptionList[0] : null;
    const frames = (primaryEx?.stacktrace as { frames?: Array<Record<string, unknown>> } | undefined)?.frames;

    const errorName = scrubTelemetryText(
      String(
        primaryEx?.type ||
          (rawType === "transaction" || rawType === "span" ? `Trace:${itemPayload.transaction || "span"}` : "SentryError")
      ).slice(0, 255)
    );
    const message = scrubTelemetryText(
      String(
        primaryEx?.value ||
          (itemPayload.message as string) ||
          (itemPayload.logentry as { message?: string } | undefined)?.message ||
          itemPayload.transaction ||
          "Sentry envelope event"
      ).slice(0, 2000)
    );

    const stackTrace =
      Array.isArray(frames) && frames.length > 0
        ? `${errorName}: ${message}\n${formatSentryFrames(frames)}`
        : `${errorName}: ${message}`;

    events.push({
      eventId: String(itemPayload.event_id || header.event_id || crypto.randomUUID().replace(/-/g, "").slice(0, 20)),
      itemType: rawType as "event" | "transaction" | "span",
      errorName,
      message,
      stackTrace,
      runtime: String(itemPayload.platform || "node").slice(0, 50),
      version: itemPayload.release ? String(itemPayload.release).slice(0, 50) : null,
      environment: String(itemPayload.environment || "production").slice(0, 50),
      routePath: itemPayload.transaction ? String(itemPayload.transaction).slice(0, 200) : null,
      timestampIso: tsCheck.iso,
    });
  }

  return { ok: true, events };
}
