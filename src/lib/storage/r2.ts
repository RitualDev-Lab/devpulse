import { db } from "@/db";
import { userStorageConfigs, users } from "@/db/schema";
import { eq, sql } from "drizzle-orm";
import { getPlanLimits } from "@/lib/billing/plans";
import crypto from "crypto";

export interface StorageCredentials {
  provider: "devpulse_r2" | "byos_r2" | "byos_s3" | "byos_supabase";
  endpoint: string;
  bucket: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  isByos: boolean;
}

const textEncoder = new TextEncoder();

async function hmacSha256(key: ArrayBuffer | Uint8Array, message: string): Promise<ArrayBuffer> {
  const keyBytes = key instanceof Uint8Array ? key : new Uint8Array(key);
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    keyBytes.buffer.slice(keyBytes.byteOffset, keyBytes.byteOffset + keyBytes.byteLength) as ArrayBuffer,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  return crypto.subtle.sign("HMAC", cryptoKey, textEncoder.encode(message));
}

async function sha256Hex(payload: Uint8Array | string): Promise<string> {
  const bytes = typeof payload === "string" ? textEncoder.encode(payload) : payload;
  const buf = await crypto.subtle.digest(
    "SHA-256",
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
  );
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function toHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * AWS Signature Version 4 request signer (Edge / Cloudflare Worker compatible).
 */
export async function signS3Request(params: {
  method: "PUT" | "GET" | "DELETE";
  url: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  body?: Uint8Array | string;
  contentType?: string;
}): Promise<Record<string, string>> {
  const parsed = new URL(params.url);
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  const dateStamp = amzDate.slice(0, 8);
  const payloadHash = await sha256Hex(params.body ?? "");

  const headers: Record<string, string> = {
    host: parsed.host,
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": amzDate,
  };
  if (params.contentType) {
    headers["content-type"] = params.contentType;
  }

  const sortedHeaderKeys = Object.keys(headers).sort();
  const canonicalHeaders = sortedHeaderKeys.map((k) => `${k}:${headers[k].trim()}\n`).join("");
  const signedHeaders = sortedHeaderKeys.join(";");

  const canonicalRequest = [
    params.method,
    parsed.pathname,
    parsed.searchParams.toString(),
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join("\n");

  const credentialScope = `${dateStamp}/${params.region}/s3/aws4_request`;
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    credentialScope,
    await sha256Hex(canonicalRequest),
  ].join("\n");

  const kDate = await hmacSha256(textEncoder.encode(`AWS4${params.secretAccessKey}`), dateStamp);
  const kRegion = await hmacSha256(kDate, params.region);
  const kService = await hmacSha256(kRegion, "s3");
  const kSigning = await hmacSha256(kService, "aws4_request");
  const signature = toHex(await hmacSha256(kSigning, stringToSign));

  return {
    ...headers,
    Authorization: `AWS4-HMAC-SHA256 Credential=${params.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
  };
}

export async function getUserStorageSummary(userId: string) {
  const [userRow] = await db
    .select({
      storageTier: users.storageTier,
      extraCustomDomains: users.extraCustomDomains,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  const limits = getPlanLimits(userRow?.storageTier || "free", userRow?.extraCustomDomains ?? 0);

  const [cfg] = await db
    .select()
    .from(userStorageConfigs)
    .where(eq(userStorageConfigs.userId, userId))
    .limit(1);

  if (!cfg) {
    await db
      .insert(userStorageConfigs)
      .values({
        id: `stg_${crypto.randomUUID().replace(/-/g, "").slice(0, 14)}`,
        userId,
        provider: "devpulse_r2",
        storageUsedBytes: 0,
        storageLimitBytes: limits.storageLimitBytes,
      })
      .onConflictDoNothing();
  } else if (cfg.storageLimitBytes !== limits.storageLimitBytes) {
    await db
      .update(userStorageConfigs)
      .set({ storageLimitBytes: limits.storageLimitBytes })
      .where(eq(userStorageConfigs.userId, userId));
  }

  return {
    tier: limits.tier,
    planLabel: limits.label,
    provider: cfg?.provider || "devpulse_r2",
    bucketName: cfg?.bucketName || process.env.R2_BUCKET_NAME || "devpulse-storage",
    endpoint: cfg?.endpoint || null,
    hasByosCredentials: Boolean(cfg?.accessKeyEncrypted && cfg?.secretKeyEncrypted),
    usedBytes: cfg?.storageUsedBytes ?? 0,
    limitBytes: limits.storageLimitBytes,
    retentionDays: limits.retentionDays,
    allowByos: limits.allowByos,
  };
}

export async function resolveStorageCredentials(userId: string): Promise<StorageCredentials | null> {
  const [cfg] = await db
    .select()
    .from(userStorageConfigs)
    .where(eq(userStorageConfigs.userId, userId))
    .limit(1);

  if (
    cfg &&
    (cfg.provider === "byos_r2" || cfg.provider === "byos_s3") &&
    cfg.endpoint &&
    cfg.bucketName &&
    cfg.accessKeyEncrypted &&
    cfg.secretKeyEncrypted
  ) {
    return {
      provider: cfg.provider,
      endpoint: cfg.endpoint.replace(/\/+$/, ""),
      bucket: cfg.bucketName,
      region: cfg.provider === "byos_r2" ? "auto" : "us-east-1",
      accessKeyId: cfg.accessKeyEncrypted,
      secretAccessKey: cfg.secretKeyEncrypted,
      isByos: true,
    };
  }

  const accountId = process.env.R2_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  const bucket = process.env.R2_BUCKET_NAME || "devpulse-storage";

  if (!accountId || !accessKeyId || !secretAccessKey) {
    return null;
  }

  return {
    provider: "devpulse_r2",
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    bucket,
    region: "auto",
    accessKeyId,
    secretAccessKey,
    isByos: false,
  };
}

export interface UploadAttachmentResult {
  uploaded: boolean;
  attachmentUrl: string | null;
  bytesWritten: number;
  quotaExceeded?: boolean;
  reason?: string;
}

export async function uploadCrashAttachment(params: {
  userId: string;
  projectId: string;
  eventId: string;
  filename: string;
  content: string | Uint8Array;
  contentType?: string;
}): Promise<UploadAttachmentResult> {
  const summary = await getUserStorageSummary(params.userId);
  const bytes =
    typeof params.content === "string" ? textEncoder.encode(params.content) : params.content;
  const size = bytes.byteLength;

  if (size <= 0) {
    return { uploaded: false, attachmentUrl: null, bytesWritten: 0 };
  }

  const creds = await resolveStorageCredentials(params.userId);
  const isByos = Boolean(creds?.isByos);

  if (!isByos && summary.usedBytes + size > summary.limitBytes) {
    return {
      uploaded: false,
      attachmentUrl: null,
      bytesWritten: 0,
      quotaExceeded: true,
      reason: `Storage quota exceeded (${summary.usedBytes}/${summary.limitBytes} bytes). Upgrade to Pro or configure BYOS R2.`,
    };
  }

  if (!creds) {
    return {
      uploaded: false,
      attachmentUrl: null,
      bytesWritten: 0,
      reason: "R2 object storage credentials are not configured on this runtime.",
    };
  }

  const safeFilename = params.filename.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 80) || "crash.log";
  const objectKey = `crashes/${params.projectId}/${params.eventId}/${safeFilename}`;
  const targetUrl = `${creds.endpoint}/${creds.bucket}/${objectKey}`;
  const contentType = params.contentType || "text/plain; charset=utf-8";

  const headers = await signS3Request({
    method: "PUT",
    url: targetUrl,
    region: creds.region,
    accessKeyId: creds.accessKeyId,
    secretAccessKey: creds.secretAccessKey,
    body: bytes,
    contentType,
  });

  const res = await fetch(targetUrl, {
    method: "PUT",
    headers,
    body: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    console.warn(`R2 PUT failed (${res.status}):`, errText.slice(0, 200));
    return {
      uploaded: false,
      attachmentUrl: null,
      bytesWritten: 0,
      reason: `Storage upload returned HTTP ${res.status}`,
    };
  }

  await db
    .update(userStorageConfigs)
    .set({
      storageUsedBytes: sql`${userStorageConfigs.storageUsedBytes} + ${size}`,
      updatedAt: sql`(CURRENT_TIMESTAMP)`,
    })
    .where(eq(userStorageConfigs.userId, params.userId));

  return {
    uploaded: true,
    attachmentUrl: `r2://${objectKey}`,
    bytesWritten: size,
  };
}

export async function fetchCrashAttachment(params: {
  userId: string;
  attachmentUrl: string;
}): Promise<{ ok: boolean; body?: ArrayBuffer; contentType?: string }> {
  if (!params.attachmentUrl.startsWith("r2://")) {
    return { ok: false };
  }
  const creds = await resolveStorageCredentials(params.userId);
  if (!creds) return { ok: false };

  const objectKey = params.attachmentUrl.slice("r2://".length);
  const targetUrl = `${creds.endpoint}/${creds.bucket}/${objectKey}`;
  const headers = await signS3Request({
    method: "GET",
    url: targetUrl,
    region: creds.region,
    accessKeyId: creds.accessKeyId,
    secretAccessKey: creds.secretAccessKey,
  });

  const res = await fetch(targetUrl, { method: "GET", headers });
  if (!res.ok) return { ok: false };

  return {
    ok: true,
    body: await res.arrayBuffer(),
    contentType: res.headers.get("content-type") || "text/plain; charset=utf-8",
  };
}

export async function deleteCrashAttachment(params: {
  userId: string;
  attachmentUrl: string;
}): Promise<boolean> {
  if (!params.attachmentUrl.startsWith("r2://")) return false;
  const creds = await resolveStorageCredentials(params.userId);
  if (!creds) return false;

  const objectKey = params.attachmentUrl.slice("r2://".length);
  const targetUrl = `${creds.endpoint}/${creds.bucket}/${objectKey}`;
  const headers = await signS3Request({
    method: "DELETE",
    url: targetUrl,
    region: creds.region,
    accessKeyId: creds.accessKeyId,
    secretAccessKey: creds.secretAccessKey,
  });

  const res = await fetch(targetUrl, { method: "DELETE", headers });
  return res.ok;
}
