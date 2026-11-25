import { db } from "@/db";
import { projects, telemetryKeys } from "@/db/schema";
import { eq, and } from "drizzle-orm";

export async function hashApiKey(rawKey: string): Promise<string> {
  const data = new TextEncoder().encode(rawKey.trim());
  const hashBuf = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hashBuf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function generateRawTelemetryKey(): { rawKey: string; keyPrefix: string } {
  const bytes = new Uint8Array(20);
  crypto.getRandomValues(bytes);
  const token = Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  const rawKey = `dp_live_${token}`;
  return {
    rawKey,
    keyPrefix: rawKey.slice(0, 14) + "...",
  };
}

export interface VerifiedProjectRecord {
  id: string;
  userId: string;
  organizationId: string | null;
  name: string;
  slug: string;
  discordWebhookUrl: string | null;
  slackWebhookUrl: string | null;
  telegramBotToken: string | null;
  telegramChatId: string | null;
  genericWebhookUrl: string | null;
  pagerdutyRoutingKey: string | null;
  notificationEmail: string | null;
  emailProvider: string | null;
  emailApiKeyEncrypted: string | null;
  matchedKeyId: string | null;
}

/**
 * Verifies a telemetry API key by computing its SHA-256 digest and looking up active hashes
 * in telemetry_keys. Falls back to legacy projects.telemetry_api_key only when not revoked,
 * transparently registering its SHA-256 hash.
 */
export async function verifyTelemetryApiKey(rawKey: string): Promise<VerifiedProjectRecord | null> {
  const trimmed = rawKey.trim();
  if (!trimmed) return null;

  const keyHash = await hashApiKey(trimmed);

  const [keyRow] = await db
    .select()
    .from(telemetryKeys)
    .where(eq(telemetryKeys.keyHash, keyHash))
    .limit(1);

  if (keyRow) {
    if (keyRow.status === "revoked") {
      return null;
    }

    const [proj] = await db
      .select({
        id: projects.id,
        userId: projects.userId,
        organizationId: projects.organizationId,
        name: projects.name,
        slug: projects.slug,
        discordWebhookUrl: projects.discordWebhookUrl,
        slackWebhookUrl: projects.slackWebhookUrl,
        telegramBotToken: projects.telegramBotToken,
        telegramChatId: projects.telegramChatId,
        genericWebhookUrl: projects.genericWebhookUrl,
        pagerdutyRoutingKey: projects.pagerdutyRoutingKey,
        notificationEmail: projects.notificationEmail,
        emailProvider: projects.emailProvider,
        emailApiKeyEncrypted: projects.emailApiKeyEncrypted,
      })
      .from(projects)
      .where(eq(projects.id, keyRow.projectId))
      .limit(1);

    if (!proj) return null;

    // Best-effort lastUsedAt stamp
    db.update(telemetryKeys)
      .set({ lastUsedAt: new Date().toISOString() })
      .where(eq(telemetryKeys.id, keyRow.id))
      .catch(() => {});

    return { ...proj, matchedKeyId: keyRow.id };
  }

  // Legacy project column fallback: allow pre-Phase-7 keys if not revoked, and seed SHA-256 record
  const [legacyProj] = await db
    .select({
      id: projects.id,
      userId: projects.userId,
      organizationId: projects.organizationId,
      name: projects.name,
      slug: projects.slug,
      discordWebhookUrl: projects.discordWebhookUrl,
      slackWebhookUrl: projects.slackWebhookUrl,
      telegramBotToken: projects.telegramBotToken,
      telegramChatId: projects.telegramChatId,
      genericWebhookUrl: projects.genericWebhookUrl,
      pagerdutyRoutingKey: projects.pagerdutyRoutingKey,
      notificationEmail: projects.notificationEmail,
      emailProvider: projects.emailProvider,
      emailApiKeyEncrypted: projects.emailApiKeyEncrypted,
    })
    .from(projects)
    .where(eq(projects.telemetryApiKey, trimmed))
    .limit(1);

  if (!legacyProj) return null;

  // Register SHA-256 hash idempotently
  const newKeyId = `key_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
  db.insert(telemetryKeys)
    .values({
      id: newKeyId,
      projectId: legacyProj.id,
      name: "Primary SDK Key",
      keyPrefix: trimmed.slice(0, 14) + "...",
      keyHash,
      status: "active",
      createdByUserId: legacyProj.userId,
      lastUsedAt: new Date().toISOString(),
    })
    .onConflictDoNothing()
    .catch(() => {});

  return { ...legacyProj, matchedKeyId: newKeyId };
}

export async function ensurePrimaryKeyHashRecorded(params: {
  projectId: string;
  rawKey: string;
  userId: string;
  name?: string;
}) {
  const keyHash = await hashApiKey(params.rawKey);
  const id = `key_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
  await db
    .insert(telemetryKeys)
    .values({
      id,
      projectId: params.projectId,
      name: params.name || "Primary SDK Key",
      keyPrefix: params.rawKey.slice(0, 14) + "...",
      keyHash,
      status: "active",
      createdByUserId: params.userId,
    })
    .onConflictDoNothing();
  return { id, keyPrefix: params.rawKey.slice(0, 14) + "...", keyHash };
}

export async function revokeProjectActiveKeys(projectId: string) {
  await db
    .update(telemetryKeys)
    .set({ status: "revoked", revokedAt: new Date().toISOString() })
    .where(and(eq(telemetryKeys.projectId, projectId), eq(telemetryKeys.status, "active")));
}
