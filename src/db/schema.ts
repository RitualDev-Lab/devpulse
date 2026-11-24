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
  telemetryApiKey: text("telemetry_api_key").unique().notNull(), // For crash reports & events
  isPublic: integer("is_public", { mode: "boolean" }).default(true).notNull(),
  customCss: text("custom_css"), // User custom CSS injection for public view
  theme: text("theme").default("dark").notNull(),

  // Instant Crash Alerts & Webhooks
  discordWebhookUrl: text("discord_webhook_url"),
  slackWebhookUrl: text("slack_webhook_url"),
  telegramBotToken: text("telegram_bot_token"),
  telegramChatId: text("telegram_chat_id"),
  genericWebhookUrl: text("generic_webhook_url"),

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
  source: text("source", { enum: ["github", "npm", "pypi", "vscode", "docker", "web", "crates"] }).notNull(),
  metricType: text("metric_type", { enum: ["downloads", "stars", "views", "clones", "installs", "pageviews", "pulls"] }).notNull(),
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
  createdAt: text("created_at").default(sql`(CURRENT_TIMESTAMP)`).notNull(),
});

