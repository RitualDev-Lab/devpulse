-- DevPulse Enterprise PostgreSQL Multi-Tenant Isolation Migration
-- Compatible with PgBouncer transaction pooling (SET LOCAL / set_config(..., true))
-- Enforces FORCE ROW LEVEL SECURITY and creates tenant indexes across all multi-tenant tables.

DO $$
DECLARE
  tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'projects',
    'daily_metrics',
    'error_events',
    'pageviews',
    'audit_logs',
    'deployments',
    'structured_logs',
    'mcp_tool_calls'
  ]
  LOOP
    EXECUTE format('ALTER TABLE IF EXISTS %I ENABLE ROW LEVEL SECURITY;', tbl);
    EXECUTE format('ALTER TABLE IF EXISTS %I FORCE ROW LEVEL SECURITY;', tbl);
    EXECUTE format('DROP POLICY IF EXISTS devpulse_tenant_isolation ON %I;', tbl);
    EXECUTE format(
      'CREATE POLICY devpulse_tenant_isolation ON %I USING (organization_id = current_setting(''app.current_org_id'', true)) WITH CHECK (organization_id = current_setting(''app.current_org_id'', true));',
      tbl
    );
    EXECUTE format('CREATE INDEX IF NOT EXISTS idx_%I_org_id ON %I (organization_id);', tbl, tbl);
  END LOOP;
END $$;
