import { client } from "./index";

export async function initDb() {
  await client.execute(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      github_username TEXT NOT NULL UNIQUE,
      name TEXT,
      email TEXT,
      avatar_url TEXT,
      storage_tier TEXT DEFAULT 'free' NOT NULL,
      subdomain TEXT UNIQUE,
      custom_domain TEXT UNIQUE,
      custom_domain_verified INTEGER DEFAULT 0 NOT NULL,
      custom_hostname_id TEXT,
      custom_domain_ssl_status TEXT DEFAULT 'pending',
      brand_title TEXT,
      brand_description TEXT,
      brand_favicon_url TEXT,
      brand_og_image_url TEXT,
      hide_powered_by INTEGER DEFAULT 0 NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
    );
  `);

  await client.execute(`
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      slug TEXT NOT NULL,
      description TEXT,
      github_repo TEXT,
      npm_package TEXT,
      pypi_package TEXT,
      vscode_extension TEXT,
      mcp_server_name TEXT,
      docker_image TEXT,
      telemetry_api_key TEXT UNIQUE NOT NULL,
      is_public INTEGER DEFAULT 1 NOT NULL,
      custom_css TEXT,
      theme TEXT DEFAULT 'dark' NOT NULL,
      discord_webhook_url TEXT,
      slack_webhook_url TEXT,
      telegram_bot_token TEXT,
      telegram_chat_id TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
    );
  `);

  // Migrate existing tables to add new webhook and revenue columns if missing
  const optionalColumns = [
    "ALTER TABLE projects ADD COLUMN discord_webhook_url TEXT;",
    "ALTER TABLE projects ADD COLUMN slack_webhook_url TEXT;",
    "ALTER TABLE projects ADD COLUMN telegram_bot_token TEXT;",
    "ALTER TABLE projects ADD COLUMN telegram_chat_id TEXT;",
    "ALTER TABLE projects ADD COLUMN stripe_api_key TEXT;",
    "ALTER TABLE projects ADD COLUMN dodo_payments_api_key TEXT;",
    "ALTER TABLE projects ADD COLUMN dodo_payments_environment TEXT DEFAULT 'live';",
    "ALTER TABLE projects ADD COLUMN github_sponsors_username TEXT;",
    "ALTER TABLE projects ADD COLUMN rust_crate TEXT;",
    "ALTER TABLE projects ADD COLUMN go_module TEXT;",
    "ALTER TABLE projects ADD COLUMN docker_image TEXT;",
    "ALTER TABLE projects ADD COLUMN generic_webhook_url TEXT;",
    "ALTER TABLE error_events ADD COLUMN r2_object_key TEXT;",
    "ALTER TABLE error_events ADD COLUMN payload_size_bytes INTEGER DEFAULT 0 NOT NULL;",
    "ALTER TABLE error_events ADD COLUMN storage_provider TEXT DEFAULT 'turso' NOT NULL;",
    "ALTER TABLE users ADD COLUMN subdomain TEXT;",
    "ALTER TABLE users ADD COLUMN custom_hostname_id TEXT;",
    "ALTER TABLE users ADD COLUMN custom_domain_ssl_status TEXT DEFAULT 'pending';",
    "ALTER TABLE users ADD COLUMN brand_title TEXT;",
    "ALTER TABLE users ADD COLUMN brand_description TEXT;",
    "ALTER TABLE users ADD COLUMN brand_favicon_url TEXT;",
    "ALTER TABLE users ADD COLUMN brand_og_image_url TEXT;",
    "ALTER TABLE users ADD COLUMN hide_powered_by INTEGER DEFAULT 0 NOT NULL;",
    "ALTER TABLE users ADD COLUMN extra_custom_domains INTEGER DEFAULT 0 NOT NULL;",
    "ALTER TABLE users ADD COLUMN extra_storage_gb INTEGER DEFAULT 0 NOT NULL;",
    "ALTER TABLE users ADD COLUMN dodo_customer_id TEXT;",
    "ALTER TABLE users ADD COLUMN dodo_subscription_id TEXT;",
    "ALTER TABLE users ADD COLUMN stripe_customer_id TEXT;",
    "ALTER TABLE users ADD COLUMN subscription_status TEXT DEFAULT 'active' NOT NULL;",
    "ALTER TABLE users ADD COLUMN current_period_end TEXT;",
    "ALTER TABLE users ADD COLUMN github_access_token TEXT;",
    "ALTER TABLE projects ADD COLUMN pagerduty_routing_key TEXT;",
    "ALTER TABLE projects ADD COLUMN organization_id TEXT;",
    "ALTER TABLE pageviews ADD COLUMN source_type TEXT DEFAULT 'web' NOT NULL;",
    "ALTER TABLE pageviews ADD COLUMN event_name TEXT DEFAULT 'pageview' NOT NULL;",
    "ALTER TABLE pageviews ADD COLUMN os TEXT DEFAULT 'Unknown' NOT NULL;",
    "ALTER TABLE pageviews ADD COLUMN app_version TEXT;",
    "ALTER TABLE error_events ADD COLUMN breadcrumbs_json TEXT;",
    "ALTER TABLE error_events ADD COLUMN commit_sha TEXT;",
    "ALTER TABLE projects ADD COLUMN notification_email TEXT;",
    "ALTER TABLE projects ADD COLUMN email_provider TEXT DEFAULT 'resend';",
    "ALTER TABLE projects ADD COLUMN email_api_key_encrypted TEXT;",
    "ALTER TABLE projects ADD COLUMN digest_enabled INTEGER DEFAULT 0 NOT NULL;",
    "ALTER TABLE projects ADD COLUMN last_digest_sent_at TEXT;",
    "ALTER TABLE projects ADD COLUMN stack_preset TEXT DEFAULT 'saas' NOT NULL;",
    "ALTER TABLE projects ADD COLUMN npm_token_encrypted TEXT;",
    "ALTER TABLE projects ADD COLUMN github_token_encrypted TEXT;",
  ];

  for (const query of optionalColumns) {
    try {
      await client.execute(query);
    } catch {
      // Column already exists, safe to ignore
    }
  }

  await client.execute(`
    CREATE TABLE IF NOT EXISTS dashboard_widgets (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      widget_type TEXT NOT NULL,
      title TEXT NOT NULL,
      position_x INTEGER DEFAULT 0 NOT NULL,
      position_y INTEGER DEFAULT 0 NOT NULL,
      width INTEGER DEFAULT 2 NOT NULL,
      height INTEGER DEFAULT 2 NOT NULL,
      is_visible INTEGER DEFAULT 1 NOT NULL,
      config_json TEXT DEFAULT '{}',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
    );
  `);

  await client.execute(`
    CREATE TABLE IF NOT EXISTS daily_metrics (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      source TEXT NOT NULL,
      metric_type TEXT NOT NULL,
      date TEXT NOT NULL,
      value INTEGER NOT NULL,
      metadata_json TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
    );
  `);

  await client.execute(`
    CREATE TABLE IF NOT EXISTS error_events (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      error_name TEXT NOT NULL,
      message TEXT NOT NULL,
      stack_trace TEXT,
      runtime TEXT DEFAULT 'node' NOT NULL,
      version TEXT,
      os TEXT,
      environment TEXT DEFAULT 'production',
      status TEXT DEFAULT 'unresolved' NOT NULL,
      attachment_url TEXT,
      r2_object_key TEXT,
      payload_size_bytes INTEGER DEFAULT 0 NOT NULL,
      storage_provider TEXT DEFAULT 'turso' NOT NULL,
      reporter_email TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
    );
  `);

  await client.execute(`
    CREATE TABLE IF NOT EXISTS user_storage_configs (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
      provider TEXT DEFAULT 'devpulse_r2' NOT NULL,
      bucket_name TEXT,
      endpoint TEXT,
      access_key_encrypted TEXT,
      secret_key_encrypted TEXT,
      storage_used_bytes INTEGER DEFAULT 0 NOT NULL,
      storage_limit_bytes INTEGER DEFAULT 104857600 NOT NULL,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
    );
  `);

  await client.execute(`
    CREATE TABLE IF NOT EXISTS pageviews (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      path TEXT DEFAULT '/' NOT NULL,
      referrer TEXT DEFAULT 'direct' NOT NULL,
      country TEXT DEFAULT 'Global' NOT NULL,
      device TEXT DEFAULT 'desktop' NOT NULL,
      browser TEXT DEFAULT 'other' NOT NULL,
      source_type TEXT DEFAULT 'web' NOT NULL,
      event_name TEXT DEFAULT 'pageview' NOT NULL,
      os TEXT DEFAULT 'Unknown' NOT NULL,
      app_version TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
    );
  `);

  await client.execute(`
    CREATE TABLE IF NOT EXISTS user_custom_domains (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      domain TEXT NOT NULL UNIQUE,
      custom_hostname_id TEXT,
      ssl_status TEXT DEFAULT 'pending' NOT NULL,
      verified INTEGER DEFAULT 0 NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
    );
  `);

  await client.execute(`
    CREATE TABLE IF NOT EXISTS billing_events (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      provider TEXT DEFAULT 'dodo' NOT NULL,
      external_event_id TEXT NOT NULL UNIQUE,
      event_type TEXT NOT NULL,
      payment_id TEXT,
      subscription_id TEXT,
      product_id TEXT,
      item_key TEXT,
      amount_cents INTEGER DEFAULT 0 NOT NULL,
      currency TEXT DEFAULT 'USD' NOT NULL,
      status TEXT DEFAULT 'succeeded' NOT NULL,
      invoice_url TEXT,
      raw_payload_json TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
    );
  `);

  await client.execute(`
    CREATE TABLE IF NOT EXISTS organizations (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE,
      owner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
    );
  `);

  await client.execute(`
    CREATE TABLE IF NOT EXISTS organization_members (
      id TEXT PRIMARY KEY,
      organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
      github_username TEXT NOT NULL,
      email TEXT,
      role TEXT DEFAULT 'viewer' NOT NULL,
      status TEXT DEFAULT 'pending' NOT NULL,
      invited_by_user_id TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
    );
  `);

  await client.execute(`
    CREATE TABLE IF NOT EXISTS telemetry_keys (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      name TEXT DEFAULT 'Default Key' NOT NULL,
      key_prefix TEXT NOT NULL,
      key_hash TEXT NOT NULL UNIQUE,
      status TEXT DEFAULT 'active' NOT NULL,
      created_by_user_id TEXT,
      last_used_at TEXT,
      revoked_at TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
    );
  `);

  await client.execute(`
    CREATE TABLE IF NOT EXISTS audit_logs (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      actor_username TEXT NOT NULL,
      organization_id TEXT,
      project_id TEXT,
      action TEXT NOT NULL,
      resource_type TEXT NOT NULL,
      resource_id TEXT,
      status TEXT DEFAULT 'success' NOT NULL,
      ip_address TEXT,
      user_agent TEXT,
      metadata_json TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
    );
  `);

  await client.execute(`
    CREATE TABLE IF NOT EXISTS rate_limit_counters (
      bucket_key TEXT PRIMARY KEY,
      count INTEGER DEFAULT 0 NOT NULL,
      expires_at INTEGER NOT NULL
    );
  `);

  await client.execute(`
    CREATE TABLE IF NOT EXISTS project_releases (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      version TEXT NOT NULL,
      commit_sha TEXT,
      commit_author TEXT,
      commit_message TEXT,
      branch TEXT,
      source TEXT DEFAULT 'sdk' NOT NULL,
      total_sessions INTEGER DEFAULT 0 NOT NULL,
      crash_count INTEGER DEFAULT 0 NOT NULL,
      released_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
    );
  `);

  await client.execute(`
    CREATE TABLE IF NOT EXISTS source_maps (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      version TEXT NOT NULL,
      file_path TEXT NOT NULL,
      r2_object_key TEXT NOT NULL,
      size_bytes INTEGER DEFAULT 0 NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
    );
  `);

  await client.execute(`
    CREATE TABLE IF NOT EXISTS uptime_monitors (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      url TEXT NOT NULL,
      method TEXT DEFAULT 'GET' NOT NULL,
      expected_status INTEGER DEFAULT 200 NOT NULL,
      interval_minutes INTEGER DEFAULT 5 NOT NULL,
      is_active INTEGER DEFAULT 1 NOT NULL,
      last_status TEXT DEFAULT 'pending' NOT NULL,
      last_status_code INTEGER,
      last_latency_ms INTEGER,
      p95_latency_ms INTEGER DEFAULT 0 NOT NULL,
      uptime_basis_points INTEGER DEFAULT 10000 NOT NULL,
      last_error TEXT,
      last_checked_at TEXT,
      alert_on_down INTEGER DEFAULT 1 NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
    );
  `);

  await client.execute(`
    CREATE TABLE IF NOT EXISTS uptime_checks (
      id TEXT PRIMARY KEY,
      monitor_id TEXT NOT NULL REFERENCES uptime_monitors(id) ON DELETE CASCADE,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      status TEXT NOT NULL,
      status_code INTEGER,
      latency_ms INTEGER NOT NULL,
      edge_region TEXT DEFAULT 'edge' NOT NULL,
      error_message TEXT,
      checked_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
    );
  `);

  await client.execute(`
    CREATE TABLE IF NOT EXISTS project_connectors (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      category TEXT NOT NULL,
      provider TEXT NOT NULL,
      label TEXT NOT NULL,
      target_url TEXT,
      identifier TEXT,
      credentials_encrypted TEXT,
      metadata_json TEXT,
      last_synced_at TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
    );
  `);

  console.log("DevPulse Database tables verified successfully.");
}
