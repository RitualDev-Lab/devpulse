import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

/**
 * Users Table
 * Supports GitHub OAuth identity and storage tier allocation
 */
export const users = sqliteTable("users", {
  id: text("id").primaryKey(), // Supabase or GitHub UUID
  githubUsername: text("github_username").notNull().unique(),
  name: text("name"),
  email: text("email"),
  avatarUrl: text("avatar_url"),
  storageTier: text("storage_tier", { enum: ["free", "pro", "team", "enterprise", "byos"] }).default("free").notNull(),
  subdomain: text("subdomain").unique(), // Free *.<portal domain> subdomain handle
  customDomain: text("custom_domain").unique(), // Paid custom domain (e.g. stats.mytool.dev)
  customDomainVerified: integer("custom_domain_verified", { mode: "boolean" }).default(false).notNull(),
  customHostnameId: text("custom_hostname_id"), // Cloudflare for SaaS Custom Hostname ID
  customDomainSslStatus: text("custom_domain_ssl_status").default("pending"), // 'pending' | 'pending_validation' | 'active'
  brandTitle: text("brand_title"),
  brandDescription: text("brand_description"),
  brandFaviconUrl: text("brand_favicon_url"),
  brandOgImageUrl: text("brand_og_image_url"),
  hidePoweredBy: integer("hide_powered_by", { mode: "boolean" }).default(false).notNull(),
  extraCustomDomains: integer("extra_custom_domains").default(0).notNull(),
  extraStorageGb: integer("extra_storage_gb").default(0).notNull(),
  dodoCustomerId: text("dodo_customer_id"),
  dodoSubscriptionId: text("dodo_subscription_id"),
  stripeCustomerId: text("stripe_customer_id"),
  subscriptionStatus: text("subscription_status").default("active").notNull(),
  currentPeriodEnd: text("current_period_end"),
  githubAccessToken: text("github_access_token"),
  createdAt: text("created_at").default(sql`(CURRENT_TIMESTAMP)`).notNull(),
  updatedAt: text("updated_at").default(sql`(CURRENT_TIMESTAMP)`).notNull(),
});

/**
 * Projects Table
 * Represents a repo, package, or tool tracked in DevPulse
 */
export const projects = sqliteTable("projects", {
  id: text("id").primaryKey(),
  userId: text("user_id").references(() => users.id, { onDelete: "cascade" }).notNull(),
  organizationId: text("organization_id"),
  workspaceId: text("workspace_id"),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(), // Globally unique across tenants for public embeds & badges
  description: text("description"),
  
  // Ecosystem Identifiers (Null if not applicable)
  githubRepo: text("github_repo"), // e.g. "ritualdev-lab/my-project"
  npmPackage: text("npm_package"), // e.g. "@ritualdev/pulse"
  pypiPackage: text("pypi_package"), // e.g. "ritualdev-pulse"
  rustCrate: text("rust_crate"), // e.g. "tokio" or "devpulse"
  goModule: text("go_module"), // e.g. "github.com/ritualdev-lab/devpulse"
  vscodeExtension: text("vscode_extension"), // e.g. "ritualdev.pulse-tools"
  mcpServerName: text("mcp_server_name"), // e.g. "ritualdev/devpulse-mcp"
  dockerImage: text("docker_image"), // e.g. "ritualdev/devpulse"
  
  // Telemetry & Security
  stackPreset: text("stack_preset").default("saas").notNull(), // 'saas' | 'package' | 'desktop' | 'mcp'
  telemetryApiKey: text("telemetry_api_key").unique().notNull(), // For crash reports & events
  publicWriteKey: text("public_write_key").unique(), // Public read/analytics beacon writeKey (dp_pub_*)
  npmTokenEncrypted: text("npm_token_encrypted"), // Optional npm Read Token for private packages
  githubTokenEncrypted: text("github_token_encrypted"), // Optional repo-scoped GitHub PAT
  isPublic: integer("is_public", { mode: "boolean" }).default(true).notNull(),
  customCss: text("custom_css"), // User custom CSS injection for public view
  theme: text("theme").default("dark").notNull(),

  // Instant Crash Alerts & Webhooks
  discordWebhookUrl: text("discord_webhook_url"),
  slackWebhookUrl: text("slack_webhook_url"),
  telegramBotToken: text("telegram_bot_token"),
  telegramChatId: text("telegram_chat_id"),
  genericWebhookUrl: text("generic_webhook_url"),
  pagerdutyRoutingKey: text("pagerduty_routing_key"),
  opsgenieApiKeyEncrypted: text("opsgenie_api_key_encrypted"),
  teamsWebhookUrl: text("teams_webhook_url"),

  // Email Notifications & Weekly Maintainer Digest (Resend / Postmark)
  notificationEmail: text("notification_email"),
  emailProvider: text("email_provider").default("resend"),
  emailApiKeyEncrypted: text("email_api_key_encrypted"),
  digestEnabled: integer("digest_enabled", { mode: "boolean" }).default(false).notNull(),
  lastDigestSentAt: text("last_digest_sent_at"),

  // Developer Revenue & Monetization (Stripe, Dodo Payments, Sponsors)
  stripeApiKey: text("stripe_api_key"),
  dodoPaymentsApiKey: text("dodo_payments_api_key"),
  dodoPaymentsEnvironment: text("dodo_payments_environment").default("live"),
  githubSponsorsUsername: text("github_sponsors_username"),
  
  createdAt: text("created_at").default(sql`(CURRENT_TIMESTAMP)`).notNull(),
  updatedAt: text("updated_at").default(sql`(CURRENT_TIMESTAMP)`).notNull(),
});

/**
 * Dashboard Widgets Table
 * Stores drag-and-drop grid coordinates and card settings
 */
export const dashboardWidgets = sqliteTable("dashboard_widgets", {
  id: text("id").primaryKey(),
  projectId: text("project_id").references(() => projects.id, { onDelete: "cascade" }).notNull(),
  widgetType: text("widget_type").notNull(), // 'github_stats', 'npm_downloads', 'pypi_downloads', 'vscode_installs', 'error_stream', 'traffic_chart', 'open_issues'
  title: text("title").notNull(),
  
  // Drag & drop grid positioning (react-grid-layout compatible)
  positionX: integer("position_x").default(0).notNull(),
  positionY: integer("position_y").default(0).notNull(),
  width: integer("width").default(2).notNull(),
  height: integer("height").default(2).notNull(),
  
  isVisible: integer("is_visible", { mode: "boolean" }).default(true).notNull(),
  configJson: text("config_json").default("{}"), // Extra custom settings per widget
  createdAt: text("created_at").default(sql`(CURRENT_TIMESTAMP)`).notNull(),
});

/**
 * Daily Metrics Table
 * Stores historical daily download, clone, view, and install counts
 */
export const dailyMetrics = sqliteTable("daily_metrics", {
  id: text("id").primaryKey(),
  projectId: text("project_id").references(() => projects.id, { onDelete: "cascade" }).notNull(),
  source: text("source", { enum: ["github", "npm", "pypi", "vscode", "docker", "web", "crates", "go", "mcp"] }).notNull(),
  metricType: text("metric_type", { enum: ["downloads", "stars", "views", "clones", "installs", "pageviews", "pulls", "versions"] }).notNull(),
  date: text("date").notNull(), // YYYY-MM-DD
  delta: integer("delta"), // value minus previous recorded day in the same series; null for the first day
  value: integer("value").notNull(),
  metadataJson: text("metadata_json"),
  createdAt: text("created_at").default(sql`(CURRENT_TIMESTAMP)`).notNull(),
});

/**
 * Error & Crash Events Table
 * Received from the DevPulse Telemetry SDK or public bug report submissions
 */
export const errorEvents = sqliteTable("error_events", {
  id: text("id").primaryKey(),
  projectId: text("project_id").references(() => projects.id, { onDelete: "cascade" }).notNull(),
  errorName: text("error_name").notNull(),
  message: text("message").notNull(),
  stackTrace: text("stack_trace"),
  runtime: text("runtime").default("node").notNull(), // 'node', 'python', 'browser', 'cli'
  version: text("version"),
  os: text("os"),
  environment: text("environment").default("production"), // 'production', 'development', etc.
  status: text("status", { enum: ["unresolved", "resolved", "ignored"] }).default("unresolved").notNull(),
  attachmentUrl: text("attachment_url"), // Cloudflare R2 or BYOS S3 bucket link / object key
  r2ObjectKey: text("r2_object_key"), // Key in R2 / BYOS for heavy 100KB+ stack traces & terminal logs
  payloadSizeBytes: integer("payload_size_bytes").default(0).notNull(),
  storageProvider: text("storage_provider").default("turso").notNull(), // 'turso' | 'devpulse_r2' | 'byos_r2' | 'byos_s3'
  reporterEmail: text("reporter_email"), // Optional, if user submitted via public bug form
  breadcrumbsJson: text("breadcrumbs_json"), // JSON array of HTTP/console/UI events leading to crash
  commitSha: text("commit_sha"), // Suspected release/commit SHA attribution
  traceId: text("trace_id"), // Linked OpenTelemetry Trace ID
  fingerprint: text("fingerprint"), // Deterministic hash(projectId + errorName + topStackFrame)
  aiGroupKey: text("ai_group_key"),
  aiGroupTitle: text("ai_group_title"),
  aiRootCause: text("ai_root_cause"),
  aiFixSuggestion: text("ai_fix_suggestion"),
  aiCodeSnippet: text("ai_code_snippet"),
  isRegression: integer("is_regression", { mode: "boolean" }).default(false).notNull(),
  affectedUsersCount: integer("affected_users_count").default(1).notNull(),
  countryCode: text("country_code"),
  routePath: text("route_path"),
  estimatedLostRevenueCents: integer("estimated_lost_revenue_cents").default(0).notNull(),
  impactScore: integer("impact_score").default(0).notNull(),
  platform: text("platform").default("web").notNull(), // 'web' | 'node' | 'python' | 'react_native' | 'flutter' | 'ios' | 'android'
  errorCategory: text("error_category").default("exception").notNull(), // 'exception' | 'oom' | 'anr' | 'network'
  deviceModel: text("device_model"),
  appBuild: text("app_build"),
  flagKey: text("flag_key"),
  flagVariant: text("flag_variant"),
  githubIssueNumber: integer("github_issue_number"),
  githubIssueUrl: text("github_issue_url"),
  githubPrNumber: integer("github_pr_number"),
  githubPrUrl: text("github_pr_url"),
  createdAt: text("created_at").default(sql`(CURRENT_TIMESTAMP)`).notNull(),
});

/**
 * Storage & BYOS (Bring Your Own Storage) Configuration
 */
export const userStorageConfigs = sqliteTable("user_storage_configs", {
  id: text("id").primaryKey(),
  userId: text("user_id").references(() => users.id, { onDelete: "cascade" }).notNull().unique(),
  provider: text("provider", { enum: ["devpulse_r2", "byos_r2", "byos_s3", "byos_supabase"] }).default("devpulse_r2").notNull(),
  bucketName: text("bucket_name"),
  endpoint: text("endpoint"),
  accessKeyEncrypted: text("access_key_encrypted"),
  secretKeyEncrypted: text("secret_key_encrypted"),
  storageUsedBytes: integer("storage_used_bytes").default(0).notNull(),
  storageLimitBytes: integer("storage_limit_bytes").default(104857600).notNull(), // Default 100MB for Free
  updatedAt: text("updated_at").default(sql`(CURRENT_TIMESTAMP)`).notNull(),
});

/**
 * Cookie-Free Web Analytics (Google Analytics Alternative)
 * 100% GDPR compliant, zero cookies, lightweight beacon tracking
 */
export const pageviews = sqliteTable("pageviews", {
  id: text("id").primaryKey(),
  projectId: text("project_id").references(() => projects.id, { onDelete: "cascade" }).notNull(),
  path: text("path").default("/").notNull(),
  referrer: text("referrer").default("direct").notNull(),
  country: text("country").default("Global").notNull(),
  device: text("device").default("desktop").notNull(),
  browser: text("browser").default("other").notNull(),
  sourceType: text("source_type").default("web").notNull(), // 'web' | 'app' | 'desktop' | 'cli'
  eventName: text("event_name").default("pageview").notNull(),
  os: text("os").default("Unknown").notNull(),
  appVersion: text("app_version"),
  createdAt: text("created_at").default(sql`(CURRENT_TIMESTAMP)`).notNull(),
});

/**
 * Custom Domains Table
 * Supports multiple SSL-provisioned custom domains for Team (5) + Extra Domain add-ons
 */
export const userCustomDomains = sqliteTable("user_custom_domains", {
  id: text("id").primaryKey(),
  userId: text("user_id").references(() => users.id, { onDelete: "cascade" }).notNull(),
  domain: text("domain").notNull().unique(),
  customHostnameId: text("custom_hostname_id"),
  sslStatus: text("ssl_status").default("pending").notNull(),
  verified: integer("verified", { mode: "boolean" }).default(false).notNull(),
  createdAt: text("created_at").default(sql`(CURRENT_TIMESTAMP)`).notNull(),
  updatedAt: text("updated_at").default(sql`(CURRENT_TIMESTAMP)`).notNull(),
});

/**
 * Billing Events & Invoices Table
 * Stores idempotent Dodo Payments / Stripe webhook receipts & invoice links
 */
export const billingEvents = sqliteTable("billing_events", {
  id: text("id").primaryKey(),
  userId: text("user_id").references(() => users.id, { onDelete: "cascade" }).notNull(),
  provider: text("provider", { enum: ["dodo", "stripe"] }).default("dodo").notNull(),
  externalEventId: text("external_event_id").notNull().unique(),
  eventType: text("event_type").notNull(),
  paymentId: text("payment_id"),
  subscriptionId: text("subscription_id"),
  productId: text("product_id"),
  itemKey: text("item_key"), // 'pro' | 'team' | 'extra_domain' | 'extra_storage'
  amountCents: integer("amount_cents").default(0).notNull(),
  currency: text("currency").default("USD").notNull(),
  status: text("status").default("succeeded").notNull(),
  invoiceUrl: text("invoice_url"),
  rawPayloadJson: text("raw_payload_json"),
  createdAt: text("created_at").default(sql`(CURRENT_TIMESTAMP)`).notNull(),
});

/**
 * Organizations -> Workspaces -> Projects Hierarchy & 5-Role RBAC
 * Roles: owner, admin, developer (alias: maintainer), viewer, billing
 */
export const organizations = sqliteTable("organizations", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  ownerUserId: text("owner_user_id").references(() => users.id, { onDelete: "cascade" }).notNull(),
  createdAt: text("created_at").default(sql`(CURRENT_TIMESTAMP)`).notNull(),
});

export const workspaces = sqliteTable("workspaces", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").references(() => organizations.id, { onDelete: "cascade" }).notNull(),
  name: text("name").notNull(),
  slug: text("slug").notNull(),
  billingPlan: text("billing_plan", { enum: ["free", "pro", "team", "enterprise"] }).default("free").notNull(),
  monthlyEventLimit: integer("monthly_event_limit").default(10000).notNull(),
  monthlyEventsUsed: integer("monthly_events_used").default(0).notNull(),
  memberLimit: integer("member_limit").default(3).notNull(),
  projectLimit: integer("project_limit").default(2).notNull(),
  billingEmail: text("billing_email"),
  createdAt: text("created_at").default(sql`(CURRENT_TIMESTAMP)`).notNull(),
  updatedAt: text("updated_at").default(sql`(CURRENT_TIMESTAMP)`).notNull(),
});

export const organizationMembers = sqliteTable("organization_members", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").references(() => organizations.id, { onDelete: "cascade" }).notNull(),
  workspaceId: text("workspace_id"),
  userId: text("user_id").references(() => users.id, { onDelete: "cascade" }),
  githubUsername: text("github_username").notNull(),
  email: text("email"),
  scimExternalId: text("scim_external_id"),
  role: text("role", { enum: ["owner", "admin", "developer", "viewer", "billing", "maintainer"] }).default("viewer").notNull(),
  status: text("status", { enum: ["active", "pending", "suspended"] }).default("pending").notNull(),
  invitedByUserId: text("invited_by_user_id"),
  createdAt: text("created_at").default(sql`(CURRENT_TIMESTAMP)`).notNull(),
  updatedAt: text("updated_at").default(sql`(CURRENT_TIMESTAMP)`).notNull(),
});

/**
 * Telemetry API Keys (SHA-256 Hash Storage)
 * Supports key generation, rotation, and instant revocation
 */
export const telemetryKeys = sqliteTable("telemetry_keys", {
  id: text("id").primaryKey(),
  projectId: text("project_id").references(() => projects.id, { onDelete: "cascade" }).notNull(),
  name: text("name").default("Default Key").notNull(),
  keyPrefix: text("key_prefix").notNull(),
  keyHash: text("key_hash").notNull().unique(),
  status: text("status", { enum: ["active", "revoked"] }).default("active").notNull(),
  createdByUserId: text("created_by_user_id"),
  lastUsedAt: text("last_used_at"),
  revokedAt: text("revoked_at"),
  createdAt: text("created_at").default(sql`(CURRENT_TIMESTAMP)`).notNull(),
});

/**
 * Immutable Security Audit Log
 * Records all config changes, API key operations, domains, RBAC & billing modifications
 */
export const auditLogs = sqliteTable("audit_logs", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  actorUsername: text("actor_username").notNull(),
  organizationId: text("organization_id"),
  workspaceId: text("workspace_id"),
  projectId: text("project_id"),
  action: text("action").notNull(),
  resourceType: text("resource_type").notNull(),
  resourceId: text("resource_id"),
  status: text("status", { enum: ["success", "denied"] }).default("success").notNull(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  metadataJson: text("metadata_json"),
  seq: integer("seq").default(0).notNull(),
  prevHash: text("prev_hash"),
  entryHash: text("entry_hash"),
  createdAt: text("created_at").default(sql`(CURRENT_TIMESTAMP)`).notNull(),
});

/**
 * Edge & Database Sliding-Window Rate Limit Counters
 */
export const rateLimitCounters = sqliteTable("rate_limit_counters", {
  bucketKey: text("bucket_key").primaryKey(),
  count: integer("count").default(0).notNull(),
  expiresAt: integer("expires_at").notNull(),
});

/**
 * Release Health & GitHub Commit Attribution Table
 */
export const projectReleases = sqliteTable("project_releases", {
  id: text("id").primaryKey(),
  projectId: text("project_id").references(() => projects.id, { onDelete: "cascade" }).notNull(),
  version: text("version").notNull(),
  commitSha: text("commit_sha"),
  commitAuthor: text("commit_author"),
  commitMessage: text("commit_message"),
  branch: text("branch"),
  source: text("source").default("sdk").notNull(), // 'sdk' | 'github_push' | 'github_release'
  totalSessions: integer("total_sessions").default(0).notNull(),
  crashCount: integer("crash_count").default(0).notNull(),
  releasedAt: text("released_at").default(sql`(CURRENT_TIMESTAMP)`).notNull(),
  createdAt: text("created_at").default(sql`(CURRENT_TIMESTAMP)`).notNull(),
});

/**
 * Uploaded Source Maps (.map) stored in Cloudflare R2 for crash symbolication
 */
export const sourceMaps = sqliteTable("source_maps", {
  id: text("id").primaryKey(),
  projectId: text("project_id").references(() => projects.id, { onDelete: "cascade" }).notNull(),
  version: text("version").notNull(),
  filePath: text("file_path").notNull(),
  r2ObjectKey: text("r2_object_key").notNull(),
  sizeBytes: integer("size_bytes").default(0).notNull(),
  createdAt: text("created_at").default(sql`(CURRENT_TIMESTAMP)`).notNull(),
});

/**
 * Uptime & Latency Heartbeat Monitors Table
 */
export const uptimeMonitors = sqliteTable("uptime_monitors", {
  id: text("id").primaryKey(),
  projectId: text("project_id").references(() => projects.id, { onDelete: "cascade" }).notNull(),
  name: text("name").notNull(),
  url: text("url").notNull(),
  method: text("method", { enum: ["GET", "HEAD", "POST"] }).default("GET").notNull(),
  expectedStatus: integer("expected_status").default(200).notNull(),
  intervalMinutes: integer("interval_minutes").default(5).notNull(),
  isActive: integer("is_active", { mode: "boolean" }).default(true).notNull(),
  lastStatus: text("last_status", { enum: ["up", "degraded", "down", "pending"] }).default("pending").notNull(),
  lastStatusCode: integer("last_status_code"),
  lastLatencyMs: integer("last_latency_ms"),
  p95LatencyMs: integer("p95_latency_ms").default(0).notNull(),
  uptimeBasisPoints: integer("uptime_basis_points").default(10000).notNull(), // 10000 = 100.00%
  slaTargetBp: integer("sla_target_bp").default(9990).notNull(), // 9990 = 99.90%, 9995 = 99.95%
  lastError: text("last_error"),
  lastCheckedAt: text("last_checked_at"),
  alertOnDown: integer("alert_on_down", { mode: "boolean" }).default(true).notNull(),
  createdAt: text("created_at").default(sql`(CURRENT_TIMESTAMP)`).notNull(),
  updatedAt: text("updated_at").default(sql`(CURRENT_TIMESTAMP)`).notNull(),
});

/**
 * Individual Uptime Check Samples (used for P95 latency & availability charts)
 */
export const uptimeChecks = sqliteTable("uptime_checks", {
  id: text("id").primaryKey(),
  monitorId: text("monitor_id").references(() => uptimeMonitors.id, { onDelete: "cascade" }).notNull(),
  projectId: text("project_id").references(() => projects.id, { onDelete: "cascade" }).notNull(),
  status: text("status", { enum: ["up", "degraded", "down"] }).notNull(),
  statusCode: integer("status_code"),
  latencyMs: integer("latency_ms").notNull(),
  edgeRegion: text("edge_region").default("edge").notNull(),
  errorMessage: text("error_message"),
  checkedAt: text("checked_at").default(sql`(CURRENT_TIMESTAMP)`).notNull(),
});

/**
 * Modular Flexible Connectors Table
 * Allows users to attach ANY payment provider (Lemon Squeezy, Polar, Paddle, Gumroad, Stripe, Dodo, Razorpay),
 * package registry link/token, or custom analytics/telemetry feed without schema limits.
 */
export const projectConnectors = sqliteTable("project_connectors", {
  id: text("id").primaryKey(),
  projectId: text("project_id").references(() => projects.id, { onDelete: "cascade" }).notNull(),
  category: text("category", { enum: ["payment", "package", "analytics", "telemetry", "custom"] }).notNull(),
  provider: text("provider").notNull(), // e.g. 'lemonsqueezy', 'polar', 'paddle', 'gumroad', 'stripe', 'dodo', 'npm', 'custom'
  label: text("label").notNull(),
  targetUrl: text("target_url"),
  identifier: text("identifier"),
  credentialsEncrypted: text("credentials_encrypted"),
  metadataJson: text("metadata_json"), // cached stats / currency / latest MRR
  lastSyncedAt: text("last_synced_at"),
  createdAt: text("created_at").default(sql`(CURRENT_TIMESTAMP)`).notNull(),
  updatedAt: text("updated_at").default(sql`(CURRENT_TIMESTAMP)`).notNull(),
});

/**
 * SAML 2.0 / SSO Configurations (saml_config table in Turso)
 * One per organization — stores Okta, Azure AD (Entra ID), Google Workspace, or custom SAML IdP settings
 */
export const samlConfig = sqliteTable("saml_config", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").references(() => organizations.id, { onDelete: "cascade" }).notNull().unique(),
  provider: text("provider").notNull(), // 'okta' | 'azure_ad' | 'google' | 'custom'
  idpEntityId: text("idp_entity_id").notNull(),
  idpSsoUrl: text("idp_sso_url").notNull(),
  idpCertificate: text("idp_certificate").notNull(),
  spEntityId: text("sp_entity_id").notNull(),
  attributeEmail: text("attribute_email").default("email").notNull(),
  attributeName: text("attribute_name").default("name").notNull(),
  attributeRole: text("attribute_role").default("role").notNull(),
  defaultRole: text("default_role", { enum: ["owner", "maintainer", "viewer"] }).default("viewer").notNull(),
  allowedDomains: text("allowed_domains"),
  isActive: integer("is_active", { mode: "boolean" }).default(false).notNull(),
  createdAt: text("created_at").default(sql`(CURRENT_TIMESTAMP)`).notNull(),
  updatedAt: text("updated_at").default(sql`(CURRENT_TIMESTAMP)`).notNull(),
});

/**
 * SCIM 2.0 Provisioning Bearer Tokens
 * SHA-256 hashed tokens issued to Okta / Azure AD to auto-provision & deprovision org members
 */
export const scimTokens = sqliteTable("scim_tokens", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").references(() => organizations.id, { onDelete: "cascade" }).notNull(),
  tokenHash: text("token_hash").notNull().unique(),
  tokenPrefix: text("token_prefix").notNull(),
  label: text("label").default("SCIM Token").notNull(),
  status: text("status", { enum: ["active", "revoked"] }).default("active").notNull(),
  lastUsedAt: text("last_used_at"),
  revokedAt: text("revoked_at"),
  createdByUserId: text("created_by_user_id").references(() => users.id, { onDelete: "cascade" }).notNull(),
  createdAt: text("created_at").default(sql`(CURRENT_TIMESTAMP)`).notNull(),
});

/**
 * SAML RelayState & Replay Protection Sessions
 */
export const samlSessions = sqliteTable("saml_sessions", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").references(() => organizations.id, { onDelete: "cascade" }).notNull(),
  redirectTo: text("redirect_to").default("/dashboard").notNull(),
  // AuthnRequest ID; the IdP response must echo it in InResponseTo
  requestId: text("request_id"),
  expiresAt: text("expires_at").notNull(),
  createdAt: text("created_at").default(sql`(CURRENT_TIMESTAMP)`).notNull(),
});

/**
 * SLA Incidents & Root Cause Analysis (RCA) Timeline
 * Feeds monthly SLA compliance PDFs & public 90-day status history pages
 */
export const uptimeIncidents = sqliteTable("uptime_incidents", {
  id: text("id").primaryKey(),
  projectId: text("project_id").references(() => projects.id, { onDelete: "cascade" }).notNull(),
  monitorId: text("monitor_id").references(() => uptimeMonitors.id, { onDelete: "set null" }),
  title: text("title").notNull(),
  severity: text("severity", { enum: ["minor", "major", "critical"] }).default("major").notNull(),
  status: text("status", { enum: ["investigating", "identified", "monitoring", "resolved"] }).default("investigating").notNull(),
  rcaText: text("rca_text"),
  impactSummary: text("impact_summary"),
  startedAt: text("started_at").default(sql`(CURRENT_TIMESTAMP)`).notNull(),
  resolvedAt: text("resolved_at"),
  durationMinutes: integer("duration_minutes").default(0).notNull(),
  isPublic: integer("is_public", { mode: "boolean" }).default(true).notNull(),
  createdByUserId: text("created_by_user_id"),
  createdAt: text("created_at").default(sql`(CURRENT_TIMESTAMP)`).notNull(),
  updatedAt: text("updated_at").default(sql`(CURRENT_TIMESTAMP)`).notNull(),
});

/**
 * Escalation Policies (Step 1 Primary On-Call -> ack timeout -> Step 2 Lead)
 */
export const escalationPolicies = sqliteTable("escalation_policies", {
  id: text("id").primaryKey(),
  projectId: text("project_id").references(() => projects.id, { onDelete: "cascade" }).notNull(),
  name: text("name").notNull(),
  step1Target: text("step1_target").notNull(),
  step1ChannelsJson: text("step1_channels_json").default("[\"slack\",\"email\"]").notNull(),
  ackTimeoutMinutes: integer("ack_timeout_minutes").default(15).notNull(),
  step2Target: text("step2_target").notNull(),
  step2ChannelsJson: text("step2_channels_json").default("[\"pagerduty\",\"opsgenie\",\"teams\",\"email\"]").notNull(),
  createdAt: text("created_at").default(sql`(CURRENT_TIMESTAMP)`).notNull(),
  updatedAt: text("updated_at").default(sql`(CURRENT_TIMESTAMP)`).notNull(),
});

/**
 * Smart Alert Rules (Threshold + Z-Score / EWMA Anomaly Detection)
 */
export const alertRules = sqliteTable("alert_rules", {
  id: text("id").primaryKey(),
  projectId: text("project_id").references(() => projects.id, { onDelete: "cascade" }).notNull(),
  name: text("name").notNull(),
  ruleType: text("rule_type", { enum: ["crash_rate", "error_spike_anomaly", "uptime_down", "latency_p95"] }).notNull(),
  thresholdPercent: integer("threshold_percent").default(5).notNull(),
  windowMinutes: integer("window_minutes").default(5).notNull(),
  anomalyZScoreBp: integer("anomaly_z_score_bp").default(250).notNull(), // 250 = 2.50 sigma
  escalationPolicyId: text("escalation_policy_id").references(() => escalationPolicies.id, { onDelete: "set null" }),
  channelsJson: text("channels_json").default("[\"slack\",\"pagerduty\"]").notNull(),
  isEnabled: integer("is_enabled", { mode: "boolean" }).default(true).notNull(),
  lastTriggeredAt: text("last_triggered_at"),
  createdAt: text("created_at").default(sql`(CURRENT_TIMESTAMP)`).notNull(),
  updatedAt: text("updated_at").default(sql`(CURRENT_TIMESTAMP)`).notNull(),
});

/**
 * Triggered Alert Incidents (Tracks Ack & Step-2 Escalation State)
 */
export const alertIncidents = sqliteTable("alert_incidents", {
  id: text("id").primaryKey(),
  projectId: text("project_id").references(() => projects.id, { onDelete: "cascade" }).notNull(),
  ruleId: text("rule_id").references(() => alertRules.id, { onDelete: "set null" }),
  policyId: text("policy_id").references(() => escalationPolicies.id, { onDelete: "set null" }),
  title: text("title").notNull(),
  severity: text("severity", { enum: ["warning", "critical"] }).default("critical").notNull(),
  triggerValue: text("trigger_value").notNull(),
  anomalyScore: text("anomaly_score"),
  status: text("status", { enum: ["triggered", "acknowledged", "escalated", "resolved"] }).default("triggered").notNull(),
  currentStep: integer("current_step").default(1).notNull(),
  escalateAt: text("escalate_at"),
  acknowledgedBy: text("acknowledged_by"),
  acknowledgedAt: text("acknowledged_at"),
  resolvedAt: text("resolved_at"),
  createdAt: text("created_at").default(sql`(CURRENT_TIMESTAMP)`).notNull(),
});

/**
 * OpenTelemetry Distributed Traces (OTLP over HTTP)
 */
export const otelTraces = sqliteTable("otel_traces", {
  id: text("id").primaryKey(),
  projectId: text("project_id").references(() => projects.id, { onDelete: "cascade" }).notNull(),
  traceId: text("trace_id").notNull(),
  serviceName: text("service_name").default("unknown-service").notNull(),
  rootSpanName: text("root_span_name").default("HTTP Request").notNull(),
  status: text("status", { enum: ["ok", "error", "unset"] }).default("ok").notNull(),
  spanCount: integer("span_count").default(1).notNull(),
  durationMs: integer("duration_ms").default(0).notNull(),
  startedAt: text("started_at").notNull(),
  httpMethod: text("http_method"),
  httpRoute: text("http_route"),
  httpStatusCode: integer("http_status_code"),
  linkedErrorId: text("linked_error_id"),
  r2ObjectKey: text("r2_object_key"),
  createdAt: text("created_at").default(sql`(CURRENT_TIMESTAMP)`).notNull(),
});

export const otelSpans = sqliteTable("otel_spans", {
  id: text("id").primaryKey(),
  projectId: text("project_id").references(() => projects.id, { onDelete: "cascade" }).notNull(),
  traceId: text("trace_id").notNull(),
  spanId: text("span_id").notNull(),
  parentSpanId: text("parent_span_id"),
  serviceName: text("service_name").default("unknown-service").notNull(),
  spanName: text("span_name").notNull(),
  kind: text("kind").default("SERVER").notNull(),
  statusCode: text("status_code").default("OK").notNull(), // 'OK' | 'ERROR' | 'UNSET'
  statusMessage: text("status_message"),
  startTimeMs: integer("start_time_ms").notNull(),
  endTimeMs: integer("end_time_ms").notNull(),
  durationMs: integer("duration_ms").default(0).notNull(),
  attributesJson: text("attributes_json"),
  eventsJson: text("events_json"),
  createdAt: text("created_at").default(sql`(CURRENT_TIMESTAMP)`).notNull(),
});

/**
 * Release Deployments & One-Click Rollback Tracking
 * Connects GitHub Actions, Vercel, Railway, Fly.io webhooks
 */
export const deployments = sqliteTable("deployments", {
  id: text("id").primaryKey(),
  projectId: text("project_id").references(() => projects.id, { onDelete: "cascade" }).notNull(),
  provider: text("provider").default("github_actions").notNull(), // 'github_actions' | 'vercel' | 'railway' | 'fly' | 'manual'
  version: text("version").notNull(),
  commitSha: text("commit_sha"),
  branch: text("branch"),
  deployer: text("deployer"),
  environment: text("environment").default("production").notNull(),
  status: text("status", { enum: ["success", "failure", "pending", "rolled_back"] }).default("success").notNull(),
  changelogSummary: text("changelog_summary"),
  deploymentUrl: text("deployment_url"),
  rollbackCommitSha: text("rollback_commit_sha"),
  rollbackUrl: text("rollback_url"),
  totalSessions: integer("total_sessions").default(100).notNull(),
  crashCount: integer("crash_count").default(0).notNull(),
  deployedAt: text("deployed_at").default(sql`(CURRENT_TIMESTAMP)`).notNull(),
  rolledBackAt: text("rolled_back_at"),
  createdAt: text("created_at").default(sql`(CURRENT_TIMESTAMP)`).notNull(),
});

/**
 * Synthetic Monitoring Tests (No-Code YAML E2E across Global Edge Regions)
 */
export const syntheticTests = sqliteTable("synthetic_tests", {
  id: text("id").primaryKey(),
  projectId: text("project_id").references(() => projects.id, { onDelete: "cascade" }).notNull(),
  name: text("name").notNull(),
  yamlSpec: text("yaml_spec").notNull(),
  regionsJson: text("regions_json").default("[\"iad\",\"fra\",\"sin\",\"syd\",\"gru\"]").notNull(),
  intervalMinutes: integer("interval_minutes").default(15).notNull(),
  isActive: integer("is_active", { mode: "boolean" }).default(true).notNull(),
  lastStatus: text("last_status", { enum: ["pass", "fail", "pending"] }).default("pending").notNull(),
  p95LatencyMs: integer("p95_latency_ms").default(0).notNull(),
  lastRunAt: text("last_run_at"),
  createdAt: text("created_at").default(sql`(CURRENT_TIMESTAMP)`).notNull(),
  updatedAt: text("updated_at").default(sql`(CURRENT_TIMESTAMP)`).notNull(),
});

export const syntheticRuns = sqliteTable("synthetic_runs", {
  id: text("id").primaryKey(),
  testId: text("test_id").references(() => syntheticTests.id, { onDelete: "cascade" }).notNull(),
  projectId: text("project_id").references(() => projects.id, { onDelete: "cascade" }).notNull(),
  region: text("region").notNull(),
  status: text("status", { enum: ["pass", "fail"] }).notNull(),
  totalLatencyMs: integer("total_latency_ms").default(0).notNull(),
  stepResultsJson: text("step_results_json"),
  errorMessage: text("error_message"),
  ranAt: text("ran_at").default(sql`(CURRENT_TIMESTAMP)`).notNull(),
});

/**
 * Feature Flags & A/B Testing with Crash-Spike Auto-Rollback
 */
export const featureFlags = sqliteTable("feature_flags", {
  id: text("id").primaryKey(),
  projectId: text("project_id").references(() => projects.id, { onDelete: "cascade" }).notNull(),
  key: text("key").notNull(),
  description: text("description"),
  isEnabled: integer("is_enabled", { mode: "boolean" }).default(true).notNull(),
  rolloutPercent: integer("rollout_percent").default(100).notNull(),
  variantsJson: text("variants_json").default("[{\"name\":\"control\",\"weight\":50},{\"name\":\"treatment\",\"weight\":50}]").notNull(),
  autoRollbackEnabled: integer("auto_rollback_enabled", { mode: "boolean" }).default(true).notNull(),
  crashRateThresholdPercent: integer("crash_rate_threshold_percent").default(5).notNull(),
  status: text("status", { enum: ["active", "rolled_back", "paused"] }).default("active").notNull(),
  rollbackReason: text("rollback_reason"),
  rolledBackAt: text("rolled_back_at"),
  createdAt: text("created_at").default(sql`(CURRENT_TIMESTAMP)`).notNull(),
  updatedAt: text("updated_at").default(sql`(CURRENT_TIMESTAMP)`).notNull(),
});

export const flagExposures = sqliteTable("flag_exposures", {
  id: text("id").primaryKey(),
  projectId: text("project_id").references(() => projects.id, { onDelete: "cascade" }).notNull(),
  flagKey: text("flag_key").notNull(),
  variant: text("variant").default("control").notNull(),
  userKey: text("user_key").notNull(),
  converted: integer("converted", { mode: "boolean" }).default(false).notNull(),
  createdAt: text("created_at").default(sql`(CURRENT_TIMESTAMP)`).notNull(),
});

/**
 * Loki-Compatible Structured Log Aggregation (with +-500ms Crash Correlation)
 */
export const structuredLogs = sqliteTable("structured_logs", {
  id: text("id").primaryKey(),
  projectId: text("project_id").references(() => projects.id, { onDelete: "cascade" }).notNull(),
  level: text("level").default("info").notNull(), // 'debug' | 'info' | 'warn' | 'error' | 'fatal'
  serviceName: text("service_name").default("app").notNull(),
  message: text("message").notNull(),
  labelsJson: text("labels_json"),
  traceId: text("trace_id"),
  timestampMs: integer("timestamp_ms").notNull(),
  timestampIso: text("timestamp_iso").notNull(),
  createdAt: text("created_at").default(sql`(CURRENT_TIMESTAMP)`).notNull(),
});

/**
 * Turso-Backed Snapshot Cache for Overview & Integration Widgets
 * Eliminates external API stalls during user SSR page loads (~80-150ms DB reads).
 */
export const projectSnapshots = sqliteTable("project_snapshots", {
  id: text("id").primaryKey(),
  projectId: text("project_id").references(() => projects.id, { onDelete: "cascade" }).notNull(),
  snapshotKey: text("snapshot_key").notNull(), // 'github' | 'npm' | 'pypi' | 'crates' | 'go' | 'docker' | 'vscode' | 'mcp' | 'revenue'
  payloadJson: text("payload_json").notNull(),
  updatedAt: text("updated_at").default(sql`(CURRENT_TIMESTAMP)`).notNull(),
});

/**
 * Grouped Crash Issues with Occurrence Counters & Alert Cooldowns
 */
export const crashIssues = sqliteTable("crash_issues", {
  id: text("id").primaryKey(),
  projectId: text("project_id").references(() => projects.id, { onDelete: "cascade" }).notNull(),
  fingerprint: text("fingerprint").notNull(),
  errorName: text("error_name").notNull(),
  topFrame: text("top_frame"),
  occurrenceCount: integer("occurrence_count").default(1).notNull(),
  status: text("status", { enum: ["unresolved", "resolved", "ignored"] }).default("unresolved").notNull(),
  firstSeenAt: text("first_seen_at").default(sql`(CURRENT_TIMESTAMP)`).notNull(),
  lastSeenAt: text("last_seen_at").default(sql`(CURRENT_TIMESTAMP)`).notNull(),
  lastAlertedAt: text("last_alerted_at"),
});

/**
 * Pending Presigned Upload Reservations (reconciled on crash/report confirm or expired by cron)
 */
export const pendingUploads = sqliteTable("pending_uploads", {
  objectKey: text("object_key").primaryKey(),
  userId: text("user_id").references(() => users.id, { onDelete: "cascade" }).notNull(),
  projectId: text("project_id").references(() => projects.id, { onDelete: "cascade" }).notNull(),
  sizeBytes: integer("size_bytes").notNull(),
  confirmed: integer("confirmed", { mode: "boolean" }).default(false).notNull(),
  expiresAt: integer("expires_at").notNull(),
  createdAt: text("created_at").default(sql`(CURRENT_TIMESTAMP)`).notNull(),
});

/**
 * Public Status Page Email Subscribers (notified on monitor downtime / incident transitions)
 */
export const statusSubscribers = sqliteTable("status_subscribers", {
  id: text("id").primaryKey(),
  projectId: text("project_id").references(() => projects.id, { onDelete: "cascade" }).notNull(),
  email: text("email").notNull(),
  isActive: integer("is_active", { mode: "boolean" }).default(true).notNull(),
  unsubscribeToken: text("unsubscribe_token").notNull(),
  createdAt: text("created_at").default(sql`(CURRENT_TIMESTAMP)`).notNull(),
});

/**
 * Public Feature Requests & Roadmap Voting (tied to Release versions)
 */
export const featureRequests = sqliteTable("feature_requests", {
  id: text("id").primaryKey(),
  projectId: text("project_id").references(() => projects.id, { onDelete: "cascade" }).notNull(),
  title: text("title").notNull(),
  description: text("description").notNull(),
  category: text("category", { enum: ["feature", "improvement", "integration", "sdk"] }).default("feature").notNull(),
  status: text("status", { enum: ["open", "planned", "in_progress", "shipped"] }).default("open").notNull(),
  targetVersion: text("target_version"),
  voteCount: integer("vote_count").default(1).notNull(),
  authorName: text("author_name"),
  authorEmail: text("author_email"),
  createdAt: text("created_at").default(sql`(CURRENT_TIMESTAMP)`).notNull(),
});

/**
 * Deduplicated Upvotes per Feature Request
 */
export const featureVotes = sqliteTable("feature_votes", {
  id: text("id").primaryKey(),
  featureId: text("feature_id").references(() => featureRequests.id, { onDelete: "cascade" }).notNull(),
  voterHash: text("voter_hash").notNull(),
  createdAt: text("created_at").default(sql`(CURRENT_TIMESTAMP)`).notNull(),
});

/**
 * Hourly Pre-Aggregated Analytics Rollups (avoids full raw pageviews table scans)
 */
export const metricsHourly = sqliteTable("metrics_hourly", {
  id: text("id").primaryKey(),
  projectId: text("project_id").references(() => projects.id, { onDelete: "cascade" }).notNull(),
  hourBucket: text("hour_bucket").notNull(), // YYYY-MM-DDTHH
  sourceType: text("source_type").default("web").notNull(),
  hits: integer("hits").default(0).notNull(),
  updatedAt: text("updated_at").default(sql`(CURRENT_TIMESTAMP)`).notNull(),
});

