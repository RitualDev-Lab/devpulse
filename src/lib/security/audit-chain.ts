/**
 * Pure hash-chain logic for audit_logs. No database access here so it can be tested directly.
 *
 * Versions:
 *  0 = written before chaining existed (no hash, allowed only before the chain starts)
 *  1 = legacy canonical form; some fields were unauthenticated. Verified only, never written.
 *  2 = current form. Covers every stored field plus createdAt, with length-safe JSON encoding.
 */
export const AUDIT_CHAIN_VERSION = 2;

const LEGACY_V1_SEED = "devpulse-audit-chain-seed";

export interface AuditChainRow {
  id: string;
  seq: number;
  prevHash: string | null;
  entryHash: string | null;
  chainVersion: number;
  userId: string;
  actorUsername: string;
  organizationId: string | null;
  workspaceId: string | null;
  projectId: string | null;
  action: string;
  resourceType: string;
  resourceId: string | null;
  status: string;
  ipAddress: string | null;
  userAgent: string | null;
  metadataJson: string | null;
  createdAt: string;
}

export type AuditChainHashInput = Omit<AuditChainRow, "entryHash" | "chainVersion">;

export interface AuditChainVerification {
  valid: boolean;
  checked: number;
  brokenAtId?: string;
  reason?: string;
}

/**
 * Returns the HMAC key for new entries. There is intentionally no built-in fallback: a public default
 * key would let anyone with database write access recompute valid hashes.
 */
export function getAuditChainKey(): string {
  const key = process.env.AUDIT_CHAIN_KEY || process.env.SECRET_ENCRYPTION_KEY || "";
  if (key.length < 32) {
    throw new Error("AUDIT_CHAIN_KEY (32+ characters) must be set before audit entries can be written.");
  }
  return key;
}

async function hmacSha256Hex(secret: string, message: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await globalThis.crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await globalThis.crypto.subtle.sign("HMAC", key, enc.encode(message));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function canonicalV2(row: AuditChainHashInput): string {
  // JSON array encoding keeps field boundaries unambiguous, so values containing separators cannot collide.
  return JSON.stringify([
    "devpulse-audit-v2",
    row.seq,
    row.prevHash || "GENESIS",
    row.id,
    row.createdAt,
    row.userId,
    row.actorUsername,
    row.organizationId ?? null,
    row.workspaceId ?? null,
    row.projectId ?? null,
    row.action,
    row.resourceType,
    row.resourceId ?? null,
    row.status,
    row.ipAddress ?? null,
    row.userAgent ?? null,
    row.metadataJson ?? null,
  ]);
}

export async function computeAuditEntryHash(
  row: AuditChainHashInput,
  version: number = AUDIT_CHAIN_VERSION
): Promise<string> {
  if (version === AUDIT_CHAIN_VERSION) {
    return hmacSha256Hex(getAuditChainKey(), canonicalV2(row));
  }
  if (version === 1) {
    const canonical = [
      row.seq,
      row.prevHash || "GENESIS",
      row.id,
      row.userId,
      row.action,
      row.resourceType,
      row.resourceId || "",
      row.status,
      row.metadataJson || "",
    ].join("|");
    return hmacSha256Hex(process.env.SECRET_ENCRYPTION_KEY || LEGACY_V1_SEED, canonical);
  }
  throw new Error(`Unknown audit chain version ${version}`);
}

function broken(row: AuditChainRow, reason: string, checked: number): AuditChainVerification {
  return { valid: false, checked, brokenAtId: row.id, reason };
}

/**
 * Verifies one actor's chain. Rows must be sorted by seq ascending.
 * Detects edited fields, edited hashes, removed entries in the middle, duplicate or skipped sequence
 * numbers, and nulled hashes after the chain starts. It cannot detect removal of the newest entries
 * without an externally published head hash.
 */
export async function verifyAuditChain(rows: AuditChainRow[]): Promise<AuditChainVerification> {
  let expectedPrev = "GENESIS";
  let expectedSeq = 0;
  let chainStarted = false;
  let checked = 0;

  for (const row of rows) {
    if (row.chainVersion === 0) {
      if (chainStarted || row.entryHash) return broken(row, "unhashed entry after the chain started", checked);
      continue;
    }
    chainStarted = true;
    if (row.chainVersion !== 1 && row.chainVersion !== AUDIT_CHAIN_VERSION) {
      return broken(row, "unknown chain version", checked);
    }
    if (row.seq !== expectedSeq + 1) return broken(row, "sequence gap or duplicate", checked);
    if (!row.entryHash) return broken(row, "missing entry hash", checked);
    if ((row.prevHash || "GENESIS") !== expectedPrev) return broken(row, "previous hash mismatch", checked);
    const recomputed = await computeAuditEntryHash(row, row.chainVersion);
    if (recomputed !== row.entryHash) return broken(row, "entry hash mismatch", checked);

    expectedPrev = row.entryHash;
    expectedSeq = row.seq;
    checked++;
  }

  return { valid: true, checked };
}
