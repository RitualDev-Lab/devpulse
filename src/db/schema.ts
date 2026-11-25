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
  subdomain: text("subdomain").unique(), // Free *.devpulse.ritualdev.in subdomain handle
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
  name: text("name").notNull(),
  slug: text("slug").notNull(), // Unique per user for subdomains/paths
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
  source: text("source", { enum: ["github", "npm", "pypi", "vscode", "docker", "web", "crates", "go"] }).notNull(),
  metricType: text("metric_type", { enum: ["downloads", "stars", "views", "clones", "installs", "pageviews", "pulls", "versions"] }).notNull(),
  date: text("date").notNull(), // YYYY-MM-DD
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
 * Organizations & RBAC Team Permissions
 * Supports Owner, Maintainer, and Viewer access control
 */
export const organizations = sqliteTable("organizations", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  ownerUserId: text("owner_user_id").references(() => users.id, { onDelete: "cascade" }).notNull(),
  createdAt: text("created_at").default(sql`(CURRENT_TIMESTAMP)`).notNull(),
});

export const organizationMembers = sqliteTable("organization_members", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").references(() => organizations.id, { onDelete: "cascade" }).notNull(),
  userId: text("user_id").references(() => users.id, { onDelete: "cascade" }),
  githubUsername: text("github_username").notNull(),
  email: text("email"),
  role: text("role", { enum: ["owner", "maintainer", "viewer"] }).default("viewer").notNull(),
  status: text("status", { enum: ["active", "pending"] }).default("pending").notNull(),
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
  projectId: text("project_id"),
  action: text("action").notNull(),
  resourceType: text("resource_type").notNull(),
  resourceId: text("resource_id"),
  status: text("status", { enum: ["success", "denied"] }).default("success").notNull(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  metadataJson: text("metadata_json"),
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

