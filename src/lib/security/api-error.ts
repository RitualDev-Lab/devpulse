import { NextResponse } from "next/server";

/**
 * Logs the real error on the server and returns only a generic message to the client.
 * Never put err.message, stack text, or upstream provider messages in a response body.
 */
export function apiError(err: unknown, publicMessage: string, status = 500): NextResponse {
  console.error(`[api] ${publicMessage}:`, err instanceof Error ? err.stack || err.message : err);
  return NextResponse.json({ error: publicMessage }, { status });
}
