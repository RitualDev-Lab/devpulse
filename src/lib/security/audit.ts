import { db } from "@/db";
import { auditLogs } from "@/db/schema";
import { desc, eq } from "drizzle-orm";
import { getClientIp } from "./rate-limit";

export interface AuditEventInput {
  userId: string;
  actorUsername: string;
  organizationId?: string | null;
  workspaceId?: string | null;
  projectId?: string | null;
  action: string;
  resourceType: string;
  resourceId?: string | null;
  status?: "success" | "denied";
  headers?: Headers;
  metadata?: Record<string, unknown>;
}

async function computeAuditEntryHash(payload: {
  id: string;
  seq: number;
  prevHash: string;
  userId: string;
  action: string;
  resourceType: string;
  resourceId: string | null;
  status: string;
  metadataJson: string | null;
}): Promise<string> {
  const canonical = [
    payload.seq,
    payload.prevHash,
    payload.id,
    payload.userId,
    payload.action,
    payload.resourceType,
    payload.resourceId || "",
    payload.status,
    payload.metadataJson || "",
  ].join("|");

  const secret = process.env.SECRET_ENCRYPTION_KEY || "devpulse-audit-chain-seed";
  const enc = new TextEncoder();
  const key = await globalThis.crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await globalThis.crypto.subtle.sign("HMAC", key, enc.encode(canonical));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Verifies integrity of an ordered ascending audit log chain.
 */
export async function verifyAuditChain(
  rows: Array<{
    id: string;
    seq: number;
    prevHash: string | null;
    entryHash: string | null;
    userId: string;
    action: string;
    resourceType: string;
    resourceId: string | null;
    status: string;
    metadataJson: string | null;
  }>
): Promise<{ valid: boolean; brokenAtId?: string }> {
  let expectedPrev = "GENESIS";
  for (const row of rows) {
    if (!row.entryHash) {
      expectedPrev = "GENESIS";
      continue;
    }
    const prev = row.prevHash || "GENESIS";
    if (prev !== expectedPrev) {
      return { valid: false, brokenAtId: row.id };
    }
    const recomputed = await computeAuditEntryHash({
      id: row.id,
      seq: row.seq,
      prevHash: prev,
      userId: row.userId,
      action: row.action,
      resourceType: row.resourceType,
      resourceId: row.resourceId,
      status: row.status,
      metadataJson: row.metadataJson,
    });
    if (recomputed !== row.entryHash) {
      return { valid: false, brokenAtId: row.id };
    }
    expectedPrev = row.entryHash;
  }
  return { valid: true };
}

/**
 * Appends an immutable, HMAC hash-chained security audit record to Turso audit_logs.
 */
export async function recordAuditEvent(input: AuditEventInput): Promise<void> {
  try {
    const id = `aud_${crypto.randomUUID().replace(/-/g, "").slice(0, 18)}`;
    const ipAddress = input.headers ? getClientIp(input.headers) : null;
    const userAgent = input.headers?.get("user-agent")?.slice(0, 240) || null;
    const status = input.status || "success";
    const metadataJson = input.metadata ? JSON.stringify(input.metadata).slice(0, 4000) : null;

    const [latest] = await db
      .select({ seq: auditLogs.seq, entryHash: auditLogs.entryHash })
      .from(auditLogs)
      .where(eq(auditLogs.userId, input.userId))
      .orderBy(desc(auditLogs.seq), desc(auditLogs.createdAt))
      .limit(1);

    const seq = Number(latest?.seq || 0) + 1;
    const prevHash = latest?.entryHash || "GENESIS";
    const entryHash = await computeAuditEntryHash({
      id,
      seq,
      prevHash,
      userId: input.userId,
      action: input.action,
      resourceType: input.resourceType,
      resourceId: input.resourceId || null,
      status,
      metadataJson,
    });

    await db.insert(auditLogs).values({
      id,
      userId: input.userId,
      actorUsername: input.actorUsername,
      organizationId: input.organizationId || null,
      workspaceId: input.workspaceId || null,
      projectId: input.projectId || null,
      action: input.action,
      resourceType: input.resourceType,
      resourceId: input.resourceId || null,
      status,
      ipAddress,
      userAgent,
      metadataJson,
      seq,
      prevHash,
      entryHash,
    });
  } catch (err) {
    console.warn("Audit log write warning:", err);
  }
}
