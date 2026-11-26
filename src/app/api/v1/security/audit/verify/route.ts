import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/db";
import { auditLogs } from "@/db/schema";
import { asc, eq } from "drizzle-orm";
import { verifyAuditChain } from "@/lib/security/audit-chain";

export const dynamic = "force-dynamic";

const MAX_CHAIN_ENTRIES = 5000;

/**
 * Verifies the audit hash chain for the caller's own actions. The chain is kept per actor (userId).
 * Chains longer than MAX_CHAIN_ENTRIES are not verified in-request. The response says so explicitly.
 */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const rows = await db
    .select()
    .from(auditLogs)
    .where(eq(auditLogs.userId, user.id))
    .orderBy(asc(auditLogs.seq), asc(auditLogs.createdAt))
    .limit(MAX_CHAIN_ENTRIES + 1);

  if (rows.length > MAX_CHAIN_ENTRIES) {
    return NextResponse.json({
      valid: null,
      complete: false,
      reason: `Chain has more than ${MAX_CHAIN_ENTRIES} entries; verification is not run in-request.`,
    });
  }

  const result = await verifyAuditChain(rows);
  // The head lets an operator compare the chain tip with the copy in external logs (see audit_chain_head).
  const last = rows[rows.length - 1];
  const head = last ? { seq: last.seq, entryHash: last.entryHash, createdAt: last.createdAt } : null;
  return NextResponse.json({ ...result, head, complete: true, scope: "own-actions" });
}
