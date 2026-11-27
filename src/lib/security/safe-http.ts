/**
 * Centralized Safe Outbound Webhook HTTP Client
 * Enforces DNS-rebinding SSRF validation, strict timeouts, no auto-redirects,
 * bounded retries, and per-host failure circuit breaking.
 */

import { validateResolvedPublicUrl, type HostDnsResolver } from "@/lib/security/ssrf";

interface HostCircuitState {
  consecutiveFailures: number;
  openUntilMs: number;
}

const CIRCUIT_FAILURE_THRESHOLD = 3;
const CIRCUIT_OPEN_MS = 60_000;
const hostCircuitMap = new Map<string, HostCircuitState>();

export function _resetWebhookCircuitsForTest() {
  hostCircuitMap.clear();
}

export interface SafeWebhookPostOptions {
  url: string;
  body: unknown;
  headers?: Record<string, string>;
  timeoutMs?: number;
  maxRetries?: number;
  label?: string;
  dnsResolver?: HostDnsResolver;
}

export interface SafeWebhookPostResult {
  ok: boolean;
  status?: number;
  blockedReason?: string;
  circuitOpen?: boolean;
}

export async function safeWebhookPost(
  options: SafeWebhookPostOptions
): Promise<SafeWebhookPostResult> {
  const urlCheck = await validateResolvedPublicUrl(options.url, {
    allowHttp: false,
    resolver: options.dnsResolver,
  });
  if (!urlCheck.valid || !urlCheck.normalized) {
    console.warn(`Blocked unsafe outbound webhook (${options.label || "webhook"}):`, urlCheck.reason);
    return { ok: false, blockedReason: urlCheck.reason || "Blocked unsafe URL" };
  }

  const parsedHost = new URL(urlCheck.normalized).hostname.toLowerCase();
  const now = Date.now();
  const state = hostCircuitMap.get(parsedHost);
  if (state && state.openUntilMs > now) {
    return { ok: false, circuitOpen: true, blockedReason: `Circuit breaker open for ${parsedHost}` };
  }

  const timeoutMs = Math.max(500, Math.min(8000, options.timeoutMs ?? 3000));
  const maxRetries = Math.max(0, Math.min(2, options.maxRetries ?? 1));
  const serializedBody = JSON.stringify(options.body);

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const res = await fetch(urlCheck.normalized, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(options.headers || {}),
        },
        body: serializedBody,
        redirect: "error",
        signal: AbortSignal.timeout(timeoutMs),
      });

      if (res.ok) {
        hostCircuitMap.delete(parsedHost);
        return { ok: true, status: res.status };
      }

      // Only retry transient 5xx responses
      if (res.status < 500 || attempt === maxRetries) {
        const nextFails = (state?.consecutiveFailures || 0) + 1;
        hostCircuitMap.set(parsedHost, {
          consecutiveFailures: nextFails,
          openUntilMs: nextFails >= CIRCUIT_FAILURE_THRESHOLD ? Date.now() + CIRCUIT_OPEN_MS : 0,
        });
        return { ok: false, status: res.status };
      }
    } catch (err) {
      if (attempt === maxRetries) {
        const prev = hostCircuitMap.get(parsedHost);
        const nextFails = (prev?.consecutiveFailures || 0) + 1;
        hostCircuitMap.set(parsedHost, {
          consecutiveFailures: nextFails,
          openUntilMs: nextFails >= CIRCUIT_FAILURE_THRESHOLD ? Date.now() + CIRCUIT_OPEN_MS : 0,
        });
        console.error(`Outbound webhook failed (${options.label || parsedHost}):`, err);
        return { ok: false };
      }
    }

    await new Promise((r) => setTimeout(r, 120));
  }

  return { ok: false };
}
