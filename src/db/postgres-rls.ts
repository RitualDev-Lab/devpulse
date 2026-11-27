/**
 * PostgreSQL Row-Level Security (FORCE ROW LEVEL SECURITY) Transaction Helper
 * Ensures every tenant query sets transaction-local `app.current_org_id` via set_config(..., true)
 * so cross-tenant reads or writes fail closed even inside pooled database connections.
 */

export interface PgSqlClientLike {
  query: (sql: string, params?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>> }>;
}

const VALID_TENANT_ID_RE = /^[a-zA-Z0-9_-]{2,64}$/;

export function assertValidTenantOrgId(orgId: string): string {
  const clean = orgId.trim();
  if (!VALID_TENANT_ID_RE.test(clean)) {
    throw new Error("Invalid organization tenant id for PostgreSQL RLS context");
  }
  return clean;
}

export async function withTenantTx<T>(
  client: PgSqlClientLike,
  orgId: string,
  fn: (txClient: PgSqlClientLike) => Promise<T>
): Promise<T> {
  const validOrgId = assertValidTenantOrgId(orgId);
  await client.query("BEGIN");
  try {
    // Transaction-scoped setting (is_local = true) guarantees clean teardown on COMMIT/ROLLBACK
    await client.query("SELECT set_config('app.current_org_id', $1, true)", [validOrgId]);
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  }
}
