import { db } from "@/db";
import { auditLogs } from "@/db/schema";
import { desc, eq } from "drizzle-orm";
import { getClientIp } from "./rate-limit";
import { AUDIT_CHAIN_VERSION, computeAuditEntryHash } from "./audit-chain";

export { verifyAuditChain } from "./audit-chain";

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

const MAX_APPEND_ATTEMPTS = 3;

function isUniqueConstraintError(err: unknown): boolean {
  return /UNIQUE constraint failed|SQLITE_CONSTRAINT/i.test(String((err as Error)?.message ?? err));
}

/**
 * Appends a hash-chained security audit record to audit_logs. The chain is per actor (userId).
 * Failures are logged at error level and never thrown to callers, so a logging problem cannot break the
 * action being audited. A missing AUDIT_CHAIN_KEY therefore blocks writes and produces error logs.
 */
export async function recordAuditEvent(input: AuditEventInput): Promise<void> {
  try {
    const id = `aud_${crypto.randomUUID().replace(/-/g, "").slice(0, 18)}`;
    const ipAddress = input.headers ? getClientIp(input.headers) : null;
    const userAgent = input.headers?.get("user-agent")?.slice(0, 240) || null;
    const status = input.status || "success";
    const metadataJson = input.metadata ? JSON.stringify(input.metadata).slice(0, 4000) : null;
    // Same format as SQLite CURRENT_TIMESTAMP, set explicitly so the timestamp is covered by the hash.
    const createdAt = new Date().toISOString().slice(0, 19).replace("T", " ");

    for (let attempt = 1; attempt <= MAX_APPEND_ATTEMPTS; attempt++) {
      const [latest] = await db
        .select({ seq: auditLogs.seq, entryHash: auditLogs.entryHash })
        .from(auditLogs)
        .where(eq(auditLogs.userId, input.userId))
        .orderBy(desc(auditLogs.seq), desc(auditLogs.createdAt))
        .limit(1);

      const seq = Number(latest?.seq || 0) + 1;
      const prevHash = latest?.entryHash || "GENESIS";
      const row = {
        id,
        seq,
        prevHash,
        createdAt,
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
      };
      const entryHash = await computeAuditEntryHash(row, AUDIT_CHAIN_VERSION);

      try {
        await db.insert(auditLogs).values({
          ...row,
          seq,
          prevHash,
          entryHash,
          chainVersion: AUDIT_CHAIN_VERSION,
        });
        // Head checkpoint for external retention. A log drain that keeps these lines lets an operator detect
        // truncation of newer entries, which the database alone cannot show.
        console.info(
          JSON.stringify({ event: "audit_chain_head", userId: input.userId, seq, entryHash, createdAt })
        );
        return;
      } catch (err) {
        // Two writers read the same latest row. The unique (userId, seq) index rejects one of them; retry.
        if (!isUniqueConstraintError(err) || attempt === MAX_APPEND_ATTEMPTS) throw err;
      }
    }
  } catch (err) {
    console.error("Audit log write failed:", err);
  }
}
