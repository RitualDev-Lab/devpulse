import test from "node:test";
import assert from "node:assert/strict";
import {
  computeAuditEntryHash,
  verifyAuditChain,
  type AuditChainRow,
} from "../src/lib/security/audit-chain";

process.env.AUDIT_CHAIN_KEY = "k".repeat(40);
delete process.env.SECRET_ENCRYPTION_KEY;

type Draft = Omit<AuditChainRow, "entryHash" | "chainVersion" | "prevHash">;

function draft(seq: number, overrides: Partial<Draft> = {}): Draft {
  return {
    id: `aud_${seq}`,
    seq,
    userId: "user-1",
    actorUsername: "alice",
    organizationId: "org-1",
    workspaceId: null,
    projectId: "proj-1",
    action: "flag.update",
    resourceType: "flag",
    resourceId: "flag-1",
    status: "success",
    ipAddress: "10.0.0.1",
    userAgent: "ua",
    metadataJson: '{"a":1}',
    createdAt: `2025-01-0${seq} 10:00:00`,
    ...overrides,
  };
}

async function buildChain(count: number): Promise<AuditChainRow[]> {
  const rows: AuditChainRow[] = [];
  let prev: string | null = null;
  for (let i = 1; i <= count; i++) {
    const base = draft(i);
    const entryHash = await computeAuditEntryHash({ ...base, prevHash: prev }, 2);
    const row: AuditChainRow = { ...base, prevHash: prev, chainVersion: 2, entryHash };
    rows.push(row);
    prev = row.entryHash;
  }
  return rows;
}

test("valid chain verifies end to end", async () => {
  const result = await verifyAuditChain(await buildChain(3));
  assert.deepEqual(result, { valid: true, checked: 3 });
});

test("editing any stored field, including actor and timestamp, breaks the chain at that entry", async () => {
  for (const field of ["actorUsername", "projectId", "createdAt", "ipAddress", "metadataJson"] as const) {
    const rows = await buildChain(3);
    rows[1] = { ...rows[1], [field]: "tampered" };
    const result = await verifyAuditChain(rows);
    assert.equal(result.valid, false, field);
    assert.equal(result.brokenAtId, "aud_2", field);
  }
});

test("removing an entry from the middle is detected", async () => {
  const rows = await buildChain(3);
  const result = await verifyAuditChain([rows[0], rows[2]]);
  assert.equal(result.valid, false);
  assert.equal(result.reason, "sequence gap or duplicate");
});

test("a null hash after the chain started cannot reset verification", async () => {
  const rows = await buildChain(2);
  rows.push({ ...draft(3), prevHash: rows[1].entryHash, chainVersion: 2, entryHash: null });
  const result = await verifyAuditChain(rows);
  assert.equal(result.valid, false);
  assert.equal(result.reason, "missing entry hash");
});

test("unhashed pre-chain rows are accepted only before the chain starts", async () => {
  const legacy: AuditChainRow = { ...draft(0), prevHash: null, entryHash: null, chainVersion: 0 };
  const chain = await buildChain(2);
  assert.equal((await verifyAuditChain([legacy, ...chain])).valid, true);

  const late: AuditChainRow = { ...draft(3), prevHash: null, entryHash: null, chainVersion: 0 };
  const result = await verifyAuditChain([...chain, late]);
  assert.equal(result.valid, false);
  assert.equal(result.reason, "unhashed entry after the chain started");
});

test("legacy version 1 entries still verify with the legacy canonical form", async () => {
  delete process.env.SECRET_ENCRYPTION_KEY;
  const base = draft(1);
  const entryHash = await computeAuditEntryHash({ ...base, prevHash: null }, 1);
  const row: AuditChainRow = { ...base, prevHash: null, entryHash, chainVersion: 1 };
  assert.equal((await verifyAuditChain([row])).valid, true);
});

test("hashing without a key fails closed rather than using a built-in default", async () => {
  const saved = process.env.AUDIT_CHAIN_KEY;
  delete process.env.AUDIT_CHAIN_KEY;
  try {
    await assert.rejects(computeAuditEntryHash({ ...draft(1), prevHash: null }, 2), /AUDIT_CHAIN_KEY/);
  } finally {
    process.env.AUDIT_CHAIN_KEY = saved;
  }
});

test("different keys produce different chain hashes", async () => {
  const input = { ...draft(1), prevHash: null };
  const a = await computeAuditEntryHash(input, 2);
  process.env.AUDIT_CHAIN_KEY = "j".repeat(40);
  const b = await computeAuditEntryHash(input, 2);
  process.env.AUDIT_CHAIN_KEY = "k".repeat(40);
  assert.notEqual(a, b);
});
