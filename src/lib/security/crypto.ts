/**
 * Envelope Encryption Helper (AES-256-GCM) with Versioned Key Support
 * Encrypts sensitive user tokens & provider credentials at rest in Turso
 * using SECRET_ENCRYPTION_KEY (or ENCRYPTION_MASTER_KEY) stored in server env.
 *
 * Ciphertext format: `enc:<keyVersion>:<12-byte-iv-base64>:<ciphertext+tag-base64>`
 * Supports key rotation via SECRET_ENCRYPTION_KEY_VERSION (default `v1`) and
 * optional legacy decryption keys (`ENCRYPTION_MASTER_KEY`, `SECRET_ENCRYPTION_KEY_PREVIOUS`).
 */

const CURRENT_KEY_VERSION = (
  process.env.SECRET_ENCRYPTION_KEY_VERSION?.trim() || "v1"
).replace(/[^a-zA-Z0-9_-]/g, "");

function prefixForVersion(version: string): string {
  return `enc:${version}:`;
}

function decodeKeyBytes(raw: string): Uint8Array {
  const trimmed = raw.trim();
  if (/^[0-9a-fA-F]{64}$/.test(trimmed)) {
    const out = new Uint8Array(32);
    for (let i = 0; i < 32; i++) {
      out[i] = parseInt(trimmed.slice(i * 2, i * 2 + 2), 16);
    }
    return out;
  }
  try {
    const bin = atob(trimmed);
    if (bin.length === 32) {
      return Uint8Array.from(bin, (c) => c.charCodeAt(0));
    }
  } catch {
    // fall through to SHA-256 KDF
  }
  throw new Error("Encryption key must be a 32-byte base64 or 64-char hex string.");
}

async function importAesKeyFromString(raw: string): Promise<CryptoKey> {
  let keyBytes: Uint8Array;
  try {
    keyBytes = decodeKeyBytes(raw);
  } catch {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(raw));
    keyBytes = new Uint8Array(digest);
  }
  return crypto.subtle.importKey(
    "raw",
    new Uint8Array(keyBytes),
    { name: "AES-GCM" },
    false,
    ["encrypt", "decrypt"]
  );
}

function getPrimaryKeyMaterial(): string {
  const raw =
    process.env.SECRET_ENCRYPTION_KEY?.trim() ||
    process.env.ENCRYPTION_MASTER_KEY?.trim();
  if (!raw) {
    throw new Error(
      "SECRET_ENCRYPTION_KEY or ENCRYPTION_MASTER_KEY must be configured in server environment."
    );
  }
  return raw;
}

function getCandidateKeyMaterials(version?: string): string[] {
  const candidates: string[] = [];
  if (version) {
    const versionSpecific = process.env[`SECRET_ENCRYPTION_KEY_${version.toUpperCase()}`]?.trim();
    if (versionSpecific) candidates.push(versionSpecific);
  }
  const secretKey = process.env.SECRET_ENCRYPTION_KEY?.trim();
  const masterKey = process.env.ENCRYPTION_MASTER_KEY?.trim();
  const prevKey = process.env.SECRET_ENCRYPTION_KEY_PREVIOUS?.trim();

  for (const k of [secretKey, masterKey, prevKey]) {
    if (k && !candidates.includes(k)) candidates.push(k);
  }
  if (candidates.length === 0) {
    throw new Error(
      "SECRET_ENCRYPTION_KEY or ENCRYPTION_MASTER_KEY must be configured in server environment."
    );
  }
  return candidates;
}

export function isEncryptedValue(val?: string | null): boolean {
  return Boolean(val && /^enc:[a-zA-Z0-9_-]+:/.test(val));
}

export async function encryptSecret(plaintext?: string | null): Promise<string | null> {
  if (!plaintext) return null;
  const trimmed = plaintext.trim();
  if (!trimmed) return null;

  const targetPrefix = prefixForVersion(CURRENT_KEY_VERSION);
  if (trimmed.startsWith(targetPrefix)) return trimmed;

  // If re-encrypting an older envelope version, decrypt first and re-wrap under active key version
  const rawPlain = isEncryptedValue(trimmed) ? await decryptSecret(trimmed) : trimmed;
  if (!rawPlain) return null;

  const key = await importAesKeyFromString(getPrimaryKeyMaterial());
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(rawPlain);

  const cipherBuf = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    encoded
  );

  const ivB64 = btoa(String.fromCharCode(...iv));
  const ctB64 = btoa(String.fromCharCode(...new Uint8Array(cipherBuf)));
  return `${targetPrefix}${ivB64}:${ctB64}`;
}

export async function decryptSecret(stored?: string | null): Promise<string | null> {
  if (!stored) return null;
  const trimmed = stored.trim();
  if (!trimmed) return null;

  // Backward compatibility for legacy pre-encryption records
  if (!isEncryptedValue(trimmed)) {
    return trimmed;
  }

  const match = trimmed.match(/^enc:([a-zA-Z0-9_-]+):([^:]+):([^:]+)$/);
  if (!match) {
    throw new Error("Malformed encrypted secret envelope.");
  }

  const [, version, ivB64, ctB64] = match;
  const iv = Uint8Array.from(atob(ivB64), (c) => c.charCodeAt(0));
  const cipherBytes = Uint8Array.from(atob(ctB64), (c) => c.charCodeAt(0));

  const candidates = getCandidateKeyMaterials(version);
  let lastError: unknown = null;
  for (const rawKey of candidates) {
    try {
      const key = await importAesKeyFromString(rawKey);
      const plainBuf = await crypto.subtle.decrypt(
        { name: "AES-GCM", iv },
        key,
        cipherBytes
      );
      return new TextDecoder().decode(plainBuf);
    } catch (err) {
      lastError = err;
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error("Failed to decrypt secret with available encryption keys.");
}
