/**
 * Zero-Dependency Edge-Compatible S3 / Cloudflare R2 SigV4 Client
 * Uses Web Crypto API (crypto.subtle) so it runs seamlessly on Cloudflare Workers,
 * Next.js Edge/Server runtimes, and Node.js without bundling heavy AWS SDKs.
 */

export interface R2Credentials {
  endpoint: string;
  bucketName: string;
  accessKeyId: string;
  secretAccessKey: string;
  region?: string;
}

const encoder = new TextEncoder();

function toHex(buffer: ArrayBuffer | Uint8Array): string {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function sha256Hex(data: string | Uint8Array): Promise<string> {
  const bytes = typeof data === "string" ? encoder.encode(data) : data;
  const hash = await globalThis.crypto.subtle.digest("SHA-256", bytes as BufferSource);
  return toHex(hash);
}

async function hmacSha256(key: Uint8Array | ArrayBuffer, data: string): Promise<ArrayBuffer> {
  const cryptoKey = await globalThis.crypto.subtle.importKey(
    "raw",
    key as BufferSource,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  return globalThis.crypto.subtle.sign("HMAC", cryptoKey, encoder.encode(data));
}

async function getSigningKey(
  secretAccessKey: string,
  dateStamp: string,
  region: string,
  service = "s3"
): Promise<ArrayBuffer> {
  const kDate = await hmacSha256(encoder.encode(`AWS4${secretAccessKey}`), dateStamp);
  const kRegion = await hmacSha256(kDate, region);
  const kService = await hmacSha256(kRegion, service);
  return hmacSha256(kService, "aws4_request");
}

function getAmzDates(now = new Date()): { amzDate: string; dateStamp: string } {
  const iso = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  return {
    amzDate: iso, // YYYYMMDDTHHMMSSZ
    dateStamp: iso.slice(0, 8), // YYYYMMDD
  };
}

function encodeRfc3986(str: string): string {
  return encodeURIComponent(str).replace(
    /[!'()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`
  );
}

function encodeS3Key(key: string): string {
  return key
    .replace(/^\/+/, "")
    .split("/")
    .map((segment) => encodeRfc3986(segment))
    .join("/");
}

function inferRegion(endpoint: string, explicitRegion?: string): string {
  if (explicitRegion) return explicitRegion;
  if (endpoint.includes(".r2.cloudflarestorage.com")) return "auto";
  const awsMatch = endpoint.match(/s3[.-]([a-z0-9-]+)\.amazonaws\.com/i);
  if (awsMatch && awsMatch[1]) return awsMatch[1];
  return "us-east-1";
}

export function getHostedR2Credentials(): R2Credentials | null {
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  const bucketName = process.env.R2_BUCKET_NAME || "devpulse-storage";

  if (!accountId || !accessKeyId || !secretAccessKey) {
    return null;
  }

  return {
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    bucketName,
    accessKeyId,
    secretAccessKey,
    region: "auto",
  };
}

/**
 * Generates an AWS Signature V4 Presigned URL for PUT or GET directly against R2 or S3.
 */
export async function createPresignedUrl(
  creds: R2Credentials,
  options: {
    method: "GET" | "PUT";
    objectKey: string;
    expiresInSeconds?: number;
  }
): Promise<string> {
  const expires = Math.min(Math.max(options.expiresInSeconds ?? 900, 60), 604800);
  const cleanEndpoint = creds.endpoint.replace(/\/+$/, "");
  const endpointUrl = new URL(cleanEndpoint);
  const region = inferRegion(cleanEndpoint, creds.region);
  const { amzDate, dateStamp } = getAmzDates();
  const encodedKey = encodeS3Key(options.objectKey);
  const canonicalUri = `${endpointUrl.pathname.replace(/\/+$/, "")}/${encodeRfc3986(creds.bucketName)}/${encodedKey}`;

  const credentialScope = `${dateStamp}/${region}/s3/aws4_request`;
  const queryParams: Record<string, string> = {
    "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
    "X-Amz-Credential": `${creds.accessKeyId}/${credentialScope}`,
    "X-Amz-Date": amzDate,
    "X-Amz-Expires": String(expires),
    "X-Amz-SignedHeaders": "host",
  };

  const canonicalQuery = Object.keys(queryParams)
    .sort()
    .map((k) => `${encodeRfc3986(k)}=${encodeRfc3986(queryParams[k])}`)
    .join("&");

  const canonicalHeaders = `host:${endpointUrl.host}\n`;
  const canonicalRequest = [
    options.method,
    canonicalUri,
    canonicalQuery,
    canonicalHeaders,
    "host",
    "UNSIGNED-PAYLOAD",
  ].join("\n");

  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    credentialScope,
    await sha256Hex(canonicalRequest),
  ].join("\n");

  const signingKey = await getSigningKey(creds.secretAccessKey, dateStamp, region, "s3");
  const signature = toHex(await hmacSha256(signingKey, stringToSign));

  return `${endpointUrl.origin}${canonicalUri}?${canonicalQuery}&X-Amz-Signature=${signature}`;
}

async function signedFetch(
  creds: R2Credentials,
  method: "GET" | "PUT" | "HEAD" | "DELETE",
  objectKey: string,
  body?: Uint8Array | string,
  contentType?: string
): Promise<Response> {
  const cleanEndpoint = creds.endpoint.replace(/\/+$/, "");
  const endpointUrl = new URL(cleanEndpoint);
  const region = inferRegion(cleanEndpoint, creds.region);
  const { amzDate, dateStamp } = getAmzDates();

  const encodedKey = objectKey ? encodeS3Key(objectKey) : "";
  const basePath = `${endpointUrl.pathname.replace(/\/+$/, "")}/${encodeRfc3986(creds.bucketName)}`;
  const canonicalUri = encodedKey ? `${basePath}/${encodedKey}` : basePath;

  const payloadBytes =
    body === undefined ? new Uint8Array(0) : typeof body === "string" ? encoder.encode(body) : body;
  const payloadHash = await sha256Hex(payloadBytes);

  const headersMap: Record<string, string> = {
    host: endpointUrl.host,
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": amzDate,
  };
  if (contentType) {
    headersMap["content-type"] = contentType;
  }

  const sortedHeaderKeys = Object.keys(headersMap).sort();
  const canonicalHeaders = sortedHeaderKeys.map((k) => `${k}:${headersMap[k]}\n`).join("");
  const signedHeaders = sortedHeaderKeys.join(";");

  const canonicalRequest = [
    method,
    canonicalUri,
    "",
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join("\n");

  const credentialScope = `${dateStamp}/${region}/s3/aws4_request`;
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    credentialScope,
    await sha256Hex(canonicalRequest),
  ].join("\n");

  const signingKey = await getSigningKey(creds.secretAccessKey, dateStamp, region, "s3");
  const signature = toHex(await hmacSha256(signingKey, stringToSign));

  const authorization = `AWS4-HMAC-SHA256 Credential=${creds.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  const fetchHeaders: Record<string, string> = {
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": amzDate,
    Authorization: authorization,
  };
  if (contentType) {
    fetchHeaders["Content-Type"] = contentType;
  }

  return fetch(`${endpointUrl.origin}${canonicalUri}`, {
    method,
    headers: fetchHeaders,
    body: method === "PUT" ? (payloadBytes as BodyInit) : undefined,
  });
}

export async function putR2Object(
  creds: R2Credentials,
  objectKey: string,
  body: string | Uint8Array,
  contentType = "text/plain; charset=utf-8"
): Promise<{ ok: boolean; status: number; etag?: string }> {
  const res = await signedFetch(creds, "PUT", objectKey, body, contentType);
  return {
    ok: res.ok,
    status: res.status,
    etag: res.headers.get("etag") || undefined,
  };
}

export async function getR2ObjectText(
  creds: R2Credentials,
  objectKey: string
): Promise<string | null> {
  const res = await signedFetch(creds, "GET", objectKey);
  if (!res.ok) return null;
  return res.text();
}

export async function headR2Bucket(creds: R2Credentials): Promise<boolean> {
  try {
    const res = await signedFetch(creds, "HEAD", "");
    return res.ok;
  } catch {
    return false;
  }
}

export async function deleteR2Object(creds: R2Credentials, objectKey: string): Promise<boolean> {
  try {
    const res = await signedFetch(creds, "DELETE", objectKey);
    return res.ok || res.status === 204;
  } catch {
    return false;
  }
}
