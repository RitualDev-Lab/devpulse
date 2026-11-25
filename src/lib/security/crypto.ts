/**
 * Envelope Encryption Helper (AES-256-GCM)
 * Encrypts sensitive user tokens & provider credentials at rest in Turso
 * using ENCRYPTION_MASTER_KEY (stored strictly in Cloudflare / server env).
 *
 * Ciphertext format: `enc:v1:<12-byte-iv-base64>:<ciphertext+tag-base64>`
 */

const PREFIX = "enc:v1:";

function decodeKeyBytes(raw: string): Uint8Array {
  const trimmed = raw.trim();
  // Support 64-char hex or base64-encoded 32-byte key or fallback SHA-256 derivation
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
    // fall through
  }
  throw new Error("ENCRYPTION_MASTER_KEY must be a 32-byte base64 or 64-char hex string.");
}

async function importMasterKey(): Promise<CryptoKey> {
  const raw = process.env.ENCRYPTION_MASTER_KEY?.trim();
  if (!raw) {
    throw new Error("ENCRYPTION_MASTER_KEY is not configured in server environment.");
  }

  let keyBytes: Uint8Array;
  try {
    keyBytes = decodeKeyBytes(raw);
  } catch {
    // Derive exact 256-bit AES key via SHA-256 if non-standard length string supplied
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(raw));
    keyBytes = new Uint8Array(digest);
  }

  const cleanBytes = new Uint8Array(keyBytes);
  return crypto.subtle.importKey(
    "raw",
    cleanBytes,
    { name: "AES-GCM" },
    false,
    ["encrypt", "decrypt"]
  );
}

export function isEncryptedValue(val?: string | null): boolean {
  return Boolean(val && val.startsWith(PREFIX));
}

export async function encryptSecret(plaintext?: string | null): Promise<string | null> {
  if (!plaintext) return null;
  const trimmed = plaintext.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith(PREFIX)) return trimmed;

  const key = await importMasterKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(trimmed);

  const cipherBuf = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    encoded
  );

  const ivB64 = btoa(String.fromCharCode(...iv));
  const ctB64 = btoa(String.fromCharCode(...new Uint8Array(cipherBuf)));
  return `${PREFIX}${ivB64}:${ctB64}`;
}

export async function decryptSecret(stored?: string | null): Promise<string | null> {
  if (!stored) return null;
  const trimmed = stored.trim();
  if (!trimmed) return null;

  // Transparent migration compatibility for pre-encryption plaintext records
  if (!trimmed.startsWith(PREFIX)) {
    return trimmed;
  }

  const parts = trimmed.slice(PREFIX.length).split(":");
  if (parts.length !== 2) {
    throw new Error("Malformed encrypted secret envelope.");
  }

  const iv = Uint8Array.from(atob(parts[0]), (c) => c.charCodeAt(0));
  const cipherBytes = Uint8Array.from(atob(parts[1]), (c) => c.charCodeAt(0));
  const key = await importMasterKey();

  const plainBuf = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv },
    key,
    cipherBytes
  );
  return new TextDecoder().decode(plainBuf);
}
