import test from "node:test";
import assert from "node:assert/strict";
import { withTenantTx, assertValidTenantOrgId } from "../src/db/postgres-rls";
import {
  resolveEnterpriseStorageConfig,
  validateEnterpriseStorageConfig,
} from "../src/db/enterprise-adapter";
import { evaluateRebacPermission } from "../src/lib/security/openfga";

test("withTenantTx sets app.current_org_id cleanly and isolates cross-tenant access", async () => {
  const executedSql: Array<{ sql: string; params?: unknown[] }> = [];
  let activeTenant: string | null = null;
  const rows = [
    { id: "p1", organization_id: "org_alpha", name: "Alpha Core" },
    { id: "p2", organization_id: "org_beta", name: "Beta Secret" },
  ];

  const mockPg = {
    async query(sql: string, params?: unknown[]) {
      executedSql.push({ sql, params });
      if (sql.includes("set_config('app.current_org_id'")) {
        activeTenant = String(params?.[0] || "");
      }
      if (sql === "COMMIT" || sql === "ROLLBACK") {
        activeTenant = null;
      }
      if (sql.includes("FROM projects")) {
        return { rows: rows.filter((r) => r.organization_id === activeTenant) };
      }
      return { rows: [] };
    },
  };

  // Negative isolation check: querying inside org_alpha must NEVER see org_beta rows
  const alphaRows = await withTenantTx(mockPg, "org_alpha", async (tx) => {
    const res = await tx.query("SELECT * FROM projects");
    return res.rows;
  });

  assert.equal(alphaRows.length, 1);
  assert.equal(alphaRows[0].organization_id, "org_alpha");
  assert.equal(
    executedSql.some((e) => e.sql.includes("set_config('app.current_org_id', $1, true)")),
    true
  );

  // Reject SQL injection / malformed org identifiers
  assert.throws(() => assertValidTenantOrgId("org_a'; DROP TABLE projects;--"));
});

test("enterprise storage adapter validates lean and scale VPC modes", () => {
  const badScale = resolveEnterpriseStorageConfig({
    DEVPULSE_STORAGE_MODE: "scale",
    POSTGRES_DATABASE_URL: "postgres://internal/devpulse",
  });
  assert.equal(validateEnterpriseStorageConfig(badScale).valid, false);

  const validScale = resolveEnterpriseStorageConfig({
    DEVPULSE_STORAGE_MODE: "scale",
    POSTGRES_DATABASE_URL: "postgres://internal/devpulse",
    CLICKHOUSE_URL: "http://clickhouse.internal:8123",
  });
  assert.equal(validateEnterpriseStorageConfig(validScale).valid, true);
});

test("OpenFGA ReBAC enforces inheritance and blocks viewer secret access", () => {
  const tuples = [
    { user: "user:alice", relation: "owner" as const, object: "organization:org_1" },
    { user: "user:bob", relation: "viewer" as const, object: "project:proj_1" },
  ];

  assert.equal(
    evaluateRebacPermission({
      tuples,
      userId: "alice",
      object: "project:proj_1",
      parentOrgObject: "organization:org_1",
      requiredRelation: "can_read_secrets",
    }),
    true
  );
  assert.equal(
    evaluateRebacPermission({
      tuples,
      userId: "bob",
      object: "project:proj_1",
      requiredRelation: "can_read",
    }),
    true
  );
  assert.equal(
    evaluateRebacPermission({
      tuples,
      userId: "bob",
      object: "project:proj_1",
      requiredRelation: "can_read_secrets",
    }),
    false
  );
});
