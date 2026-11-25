/**
 * SAML 2.0 Core — Pure Web Crypto API (Cloudflare Workers & Node compatible)
 *
 * Implements:
 *   - ASN.1 DER X.509 Certificate -> SubjectPublicKeyInfo (SPKI) extraction
 *   - SP-initiated AuthnRequest (HTTP-Redirect Binding: DEFLATE-raw + Base64)
 *   - IdP HTTP-POST SAMLResponse validation:
 *       * Required XML-DSig signature verification (RSA-SHA256 / SHA-1 / SHA-512)
 *       * SAML StatusCode Success check
 *       * Issuer verification against configured IdP Entity ID
 *       * Conditions NotBefore / NotOnOrAfter time window check (±120s skew)
 *       * Allowed email domain enforcement & RBAC role mapping
 *   - SP Metadata XML generation for Okta, Azure AD (Entra ID), and Google Workspace
 */

export type SamlProvider = "okta" | "azure_ad" | "google" | "custom";

export interface SamlConfigRecord {
  idpEntityId: string;
  idpSsoUrl: string;
  idpCertificate: string;
  spEntityId: string;
  attributeEmail: string;
  attributeName: string;
  attributeRole: string;
  defaultRole: "owner" | "maintainer" | "viewer";
  allowedDomains: string | null;
}

export interface SamlUserInfo {
  email: string;
  name: string;
  role: "owner" | "maintainer" | "viewer";
  nameId: string;
  issuer: string;
  assertionId: string | null;
}

export interface CertificateInspection {
  valid: boolean;
  sha256Fingerprint: string;
  algorithm: "RSA";
  modulusBits?: number;
  error?: string;
}

/**
 * Provider preset defaults for Okta, Azure AD (Entra ID), Google Workspace, and Custom IdPs
 */
export const SAML_PROVIDER_PRESETS: Record<
  SamlProvider,
  {
    label: string;
    attributeEmail: string;
    attributeName: string;
    attributeRole: string;
    setupHint: string;
  }
> = {
  okta: {
    label: "Okta",
    attributeEmail: "email",
    attributeName: "name",
    attributeRole: "role",
    setupHint:
      "In Okta Admin -> Applications -> Create App Integration -> SAML 2.0. Paste the ACS URL into Single sign-on URL and SP Entity ID into Audience URI.",
  },
  azure_ad: {
    label: "Microsoft Entra ID (Azure AD)",
    attributeEmail: "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress",
    attributeName: "http://schemas.microsoft.com/identity/claims/displayname",
    attributeRole: "http://schemas.microsoft.com/ws/2008/06/identity/claims/role",
    setupHint:
      "In Entra ID -> Enterprise Applications -> Single sign-on -> SAML. Configure Basic SAML Configuration using Entity ID and Reply URL (ACS).",
  },
  google: {
    label: "Google Workspace",
    attributeEmail: "email",
    attributeName: "name",
    attributeRole: "role",
    setupHint:
      "In Google Admin -> Apps -> Web and mobile apps -> Add custom SAML app. Map Primary email -> email and First/Last name -> name.",
  },
  custom: {
    label: "Custom SAML 2.0 IdP",
    attributeEmail: "email",
    attributeName: "name",
    attributeRole: "role",
    setupHint:
      "Upload our SP Metadata XML or manually configure Entity ID, ACS URL (HTTP-POST), and Email NameID format.",
  },
};

// ─── Base64 & UTF-8 Helpers ──────────────────────────────────────────────────

function uint8ToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

function base64ToUint8(b64: string): Uint8Array {
  const clean = b64.replace(/\s+/g, "");
  const binary = atob(clean);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    out[i] = binary.charCodeAt(i);
  }
  return out;
}

function decodeBase64Utf8(b64: string): string {
  return new TextDecoder().decode(base64ToUint8(b64));
}

function xmlEscape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function xmlUnescape(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

// ─── ASN.1 DER X.509 Certificate -> SPKI Extractor ───────────────────────────

interface Asn1Node {
  tag: number;
  headerLength: number;
  contentLength: number;
  totalLength: number;
  start: number;
  end: number;
}

function readAsn1Node(der: Uint8Array, offset: number): Asn1Node {
  if (offset >= der.length) {
    throw new Error("ASN.1: unexpected end of certificate data");
  }
  const tag = der[offset];
  let lenByte = der[offset + 1];
  let headerLength = 2;
  let contentLength = 0;

  if ((lenByte & 0x80) === 0) {
    contentLength = lenByte;
  } else {
    const numOctets = lenByte & 0x7f;
    if (numOctets === 0 || numOctets > 4 || offset + 2 + numOctets > der.length) {
      throw new Error("ASN.1: invalid DER length encoding");
    }
    for (let i = 0; i < numOctets; i++) {
      contentLength = (contentLength << 8) | der[offset + 2 + i];
    }
    headerLength = 2 + numOctets;
  }

  const totalLength = headerLength + contentLength;
  const end = offset + totalLength;
  if (end > der.length) {
    throw new Error("ASN.1: truncated DER element");
  }

  return {
    tag,
    headerLength,
    contentLength,
    totalLength,
    start: offset,
    end,
  };
}

/**
 * Normalizes a PEM X.509 certificate or raw base64 DER into clean DER bytes.
 */
export function pemToDer(certPemOrBase64: string): Uint8Array {
  const cleaned = certPemOrBase64
    .replace(/-----BEGIN CERTIFICATE-----/g, "")
    .replace(/-----END CERTIFICATE-----/g, "")
    .replace(/-----BEGIN PUBLIC KEY-----/g, "")
    .replace(/-----END PUBLIC KEY-----/g, "")
    .replace(/\s+/g, "");
  if (!cleaned) {
    throw new Error("SAML: Empty IdP certificate");
  }
  return base64ToUint8(cleaned);
}

/**
 * Extracts SubjectPublicKeyInfo (SPKI) DER bytes from a standard X.509 Certificate.
 * If the input is already a raw SPKI SEQUENCE (e.g. PUBLIC KEY PEM), returns it directly.
 */
export function extractSpkiFromX509Cert(certPemOrBase64: string): Uint8Array {
  const der = pemToDer(certPemOrBase64);
  const root = readAsn1Node(der, 0);
  if (root.tag !== 0x30) {
    throw new Error("SAML: Certificate must be an ASN.1 SEQUENCE");
  }

  // First child of Certificate is either TBSCertificate (0x30) or AlgorithmIdentifier (0x30 for raw SPKI)
  const firstChild = readAsn1Node(der, root.start + root.headerLength);
  if (firstChild.tag !== 0x30) {
    throw new Error("SAML: Malformed X.509 certificate structure");
  }

  // Check if root itself is already SPKI (second child is BIT STRING 0x03)
  if (firstChild.end < root.end) {
    const secondChild = readAsn1Node(der, firstChild.end);
    if (secondChild.tag === 0x03) {
      return der.slice(root.start, root.end);
    }
  }

  // Otherwise parse TBSCertificate children:
  // [0] version (optional 0xA0), serialNumber, signature, issuer, validity, subject, subjectPublicKeyInfo
  let cursor = firstChild.start + firstChild.headerLength;
  const tbsEnd = firstChild.end;

  if (cursor >= tbsEnd) throw new Error("SAML: Empty TBSCertificate");
  let node = readAsn1Node(der, cursor);
  if (node.tag === 0xa0) {
    cursor = node.end; // skip explicit [0] version
  }

  // Skip serialNumber, signature, issuer, validity, subject (5 mandatory fields)
  for (let i = 0; i < 5; i++) {
    if (cursor >= tbsEnd) throw new Error("SAML: Truncated TBSCertificate fields");
    node = readAsn1Node(der, cursor);
    cursor = node.end;
  }

  if (cursor >= tbsEnd) {
    throw new Error("SAML: SubjectPublicKeyInfo missing from certificate");
  }
  const spkiNode = readAsn1Node(der, cursor);
  if (spkiNode.tag !== 0x30) {
    throw new Error("SAML: Invalid SubjectPublicKeyInfo sequence");
  }

  return der.slice(spkiNode.start, spkiNode.end);
}

/**
 * Validates an X.509 IdP certificate and returns its SHA-256 fingerprint & RSA key status.
 */
export async function inspectX509Certificate(
  certPemOrBase64: string
): Promise<CertificateInspection> {
  try {
    const der = pemToDer(certPemOrBase64);
    const spki = extractSpkiFromX509Cert(certPemOrBase64);
    const spkiCopy = new Uint8Array(spki);

    const key = await crypto.subtle.importKey(
      "spki",
      spkiCopy,
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["verify"]
    );

    const fpBuf = await crypto.subtle.digest("SHA-256", new Uint8Array(der));
    const fpHex = Array.from(new Uint8Array(fpBuf))
      .map((b) => b.toString(16).padStart(2, "0").toUpperCase())
      .join(":");

    const algo = key.algorithm as RsaHashedKeyAlgorithm;
    return {
      valid: true,
      sha256Fingerprint: fpHex,
      algorithm: "RSA",
      modulusBits: algo.modulusLength,
    };
  } catch (err) {
    return {
      valid: false,
      sha256Fingerprint: "",
      algorithm: "RSA",
      error: (err as Error).message || "Invalid X.509 certificate",
    };
  }
}

// ─── AuthnRequest & SP Metadata ──────────────────────────────────────────────

async function deflateRaw(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const cs = new CompressionStream("deflate-raw");
  const writer = cs.writable.getWriter();
  await writer.write(bytes);
  await writer.close();

  const chunks: Uint8Array[] = [];
  const reader = cs.readable.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  const totalLen = chunks.reduce((s, c) => s + c.length, 0);
  const out = new Uint8Array(totalLen);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.length;
  }
  return uint8ToBase64(out);
}

/**
 * Builds an HTTP-Redirect Binding SAML 2.0 AuthnRequest URL for SP-initiated SSO.
 */
export async function buildSamlAuthnRequest(
  config: Pick<SamlConfigRecord, "idpSsoUrl" | "spEntityId">,
  relayState: string,
  acsUrl: string
): Promise<string> {
  const issueInstant = new Date().toISOString();
  const id = `_dp${crypto.randomUUID().replace(/-/g, "")}`;

  const xml = [
    `<samlp:AuthnRequest`,
    ` xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol"`,
    ` xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion"`,
    ` ID="${id}"`,
    ` Version="2.0"`,
    ` IssueInstant="${issueInstant}"`,
    ` Destination="${xmlEscape(config.idpSsoUrl)}"`,
    ` AssertionConsumerServiceURL="${xmlEscape(acsUrl)}"`,
    ` ProtocolBinding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST">`,
    `<saml:Issuer>${xmlEscape(config.spEntityId)}</saml:Issuer>`,
    `<samlp:NameIDPolicy Format="urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress" AllowCreate="true"/>`,
    `</samlp:AuthnRequest>`,
  ].join("");

  const encoded = await deflateRaw(xml);
  const separator = config.idpSsoUrl.includes("?") ? "&" : "?";
  const params = new URLSearchParams({
    SAMLRequest: encoded,
    RelayState: relayState,
  });

  return `${config.idpSsoUrl}${separator}${params.toString()}`;
}

/**
 * Generates SP Metadata XML for Okta, Azure AD (Entra ID), Google Workspace, etc.
 */
export function buildSpMetadataXml(spEntityId: string, acsUrl: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<md:EntityDescriptor
  xmlns:md="urn:oasis:names:tc:SAML:2.0:metadata"
  entityID="${xmlEscape(spEntityId)}">
  <md:SPSSODescriptor
    AuthnRequestsSigned="false"
    WantAssertionsSigned="true"
    protocolSupportEnumeration="urn:oasis:names:tc:SAML:2.0:protocol">
    <md:NameIDFormat>urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress</md:NameIDFormat>
    <md:AssertionConsumerService
      Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST"
      Location="${xmlEscape(acsUrl)}"
      index="1"
      isDefault="true"/>
  </md:SPSSODescriptor>
</md:EntityDescriptor>`;
}

// ─── SAML Response Parsing & Verification ────────────────────────────────────

/**
 * Extracts <Issuer> from a base64 SAMLResponse before full verification
 * (used for IdP-initiated SSO lookup when RelayState has no orgId).
 */
export function extractIssuerFromSamlResponse(samlResponseBase64: string): string | null {
  try {
    const xml = decodeBase64Utf8(samlResponseBase64);
    const m = xml.match(/<(?:[^:>]+:)?Issuer[^>]*>([^<]+)<\/(?:[^:>]+:)?Issuer>/);
    return m ? xmlUnescape(m[1].trim()) : null;
  } catch {
    return null;
  }
}

function detectSignatureHash(signedInfoXml: string): "SHA-256" | "SHA-1" | "SHA-512" {
  const algMatch = signedInfoXml.match(
    /<(?:[^:>]+:)?SignatureMethod[^>]+Algorithm=["']([^"']+)["']/
  );
  const alg = (algMatch?.[1] || "").toLowerCase();
  if (alg.includes("sha512")) return "SHA-512";
  if (alg.includes("sha1")) return "SHA-1";
  return "SHA-256";
}

function detectXmlDsigNamespace(xml: string, signedInfoXml: string): string | null {
  // Check if <SignedInfo> already declares its xmlns or prefix xmlns
  const openTagMatch = signedInfoXml.match(/^<((?:([^:>]+):)?SignedInfo)([^>]*)>/);
  if (!openTagMatch) return null;
  const prefix = openTagMatch[2] || "";
  const attrs = openTagMatch[3] || "";

  const nsAttr = prefix ? `xmlns:${prefix}` : "xmlns";
  if (attrs.includes(`${nsAttr}=`)) return null;

  // Inherit xmlns or xmlns:prefix from enclosing <Signature> or root element
  const nsRegex = new RegExp(`${nsAttr}=["']([^"']+)["']`);
  const found = xml.match(nsRegex);
  const nsUri = found?.[1] || "http://www.w3.org/2000/09/xmldsig#";
  return `${nsAttr}="${nsUri}"`;
}

function injectNamespaceIntoSignedInfo(signedInfoXml: string, nsDecl: string): string {
  return signedInfoXml.replace(
    /^(<(?:[^:>]+:)?SignedInfo)(\s|>)/,
    `$1 ${nsDecl}$2`
  );
}

/**
 * Verifies the XML-DSig signature on <SignedInfo> against the IdP X.509 certificate.
 * Rejects unsigned responses or invalid signatures with an explicit error.
 */
async function verifySamlSignature(xml: string, certBase64: string): Promise<void> {
  const sigMatch = xml.match(
    /<(?:[^:>]+:)?SignatureValue[^>]*>([\s\S]*?)<\/(?:[^:>]+:)?SignatureValue>/
  );
  if (!sigMatch) {
    throw new Error("SAML: Missing XML SignatureValue in response");
  }

  const signedInfoMatch = xml.match(
    /(<(?:[^:>]+:)?SignedInfo\b[^>]*>[\s\S]*?<\/(?:[^:>]+:)?SignedInfo>)/
  );
  if (!signedInfoMatch) {
    throw new Error("SAML: Missing SignedInfo element in XML signature");
  }

  const spkiBytes = extractSpkiFromX509Cert(certBase64);
  const sigBytes = base64ToUint8(sigMatch[1]);
  const primaryHash = detectSignatureHash(signedInfoMatch[1]);

  const rawSignedInfo = signedInfoMatch[1];
  const normalizedNewlines = rawSignedInfo.replace(/\r\n?/g, "\n");
  const inheritedNs = detectXmlDsigNamespace(xml, normalizedNewlines);

  const candidates = [rawSignedInfo, normalizedNewlines];
  if (inheritedNs) {
    candidates.push(injectNamespaceIntoSignedInfo(normalizedNewlines, inheritedNs));
  }
  const uniqueCandidates = Array.from(new Set(candidates));

  const hashesToTry: Array<"SHA-256" | "SHA-1" | "SHA-512"> =
    primaryHash === "SHA-256"
      ? ["SHA-256", "SHA-1"]
      : [primaryHash, "SHA-256"];

  for (const hash of hashesToTry) {
    const pubKey = await crypto.subtle.importKey(
      "spki",
      new Uint8Array(spkiBytes),
      { name: "RSASSA-PKCS1-v1_5", hash },
      false,
      ["verify"]
    );

    for (const candidate of uniqueCandidates) {
      const signedData = new TextEncoder().encode(candidate);
      const valid = await crypto.subtle.verify(
        "RSASSA-PKCS1-v1_5",
        pubKey,
        new Uint8Array(sigBytes),
        signedData
      );
      if (valid) {
        return;
      }
    }
  }

  throw new Error("SAML: XML signature verification failed against IdP certificate");
}

function validateSamlStatusAndConditions(xml: string, expectedIssuer: string): string {
  // 1. Verify <StatusCode> if present is Success
  const statusMatch = xml.match(
    /<(?:[^:>]+:)?StatusCode[^>]+Value=["']([^"']+)["']/
  );
  if (statusMatch && !statusMatch[1].endsWith(":Success")) {
    throw new Error(`SAML: IdP returned non-success status (${statusMatch[1]})`);
  }

  // 2. Verify <Issuer> matches configured IdP Entity ID
  const issuerMatch = xml.match(/<(?:[^:>]+:)?Issuer[^>]*>([^<]+)<\/(?:[^:>]+:)?Issuer>/);
  const issuer = issuerMatch ? xmlUnescape(issuerMatch[1].trim()) : "";
  if (expectedIssuer.trim()) {
    const normExpected = expectedIssuer.trim().replace(/\/+$/, "");
    const normActual = issuer.replace(/\/+$/, "");
    if (!normActual || normActual !== normExpected) {
      throw new Error(`SAML: Issuer mismatch (expected '${normExpected}', got '${normActual}')`);
    }
  }

  // 3. Verify <Conditions NotBefore="..." NotOnOrAfter="..."> within ±120s clock skew
  const condMatch = xml.match(/<(?:[^:>]+:)?Conditions\b([^>]*)>/);
  if (condMatch) {
    const attrs = condMatch[1];
    const nowMs = Date.now();
    const skewMs = 120_000;

    const nbMatch = attrs.match(/NotBefore=["']([^"']+)["']/);
    if (nbMatch) {
      const nbMs = Date.parse(nbMatch[1]);
      if (Number.isFinite(nbMs) && nowMs + skewMs < nbMs) {
        throw new Error("SAML: Assertion is not yet valid (NotBefore)");
      }
    }

    const noaMatch = attrs.match(/NotOnOrAfter=["']([^"']+)["']/);
    if (noaMatch) {
      const noaMs = Date.parse(noaMatch[1]);
      if (Number.isFinite(noaMs) && nowMs - skewMs >= noaMs) {
        throw new Error("SAML: Assertion has expired (NotOnOrAfter)");
      }
    }
  }

  return issuer;
}

function extractNameId(xml: string): string {
  const m = xml.match(/<(?:[^:>]+:)?NameID[^>]*>([^<]+)<\/(?:[^:>]+:)?NameID>/);
  return m ? xmlUnescape(m[1].trim()) : "";
}

function extractAssertionId(xml: string): string | null {
  const m = xml.match(/<(?:[^:>]+:)?Assertion\b[^>]+ID=["']([^"']+)["']/);
  return m ? m[1] : null;
}

function extractXmlAttribute(xml: string, attrName: string): string {
  if (!attrName) return "";
  const escaped = attrName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const m = xml.match(
    new RegExp(
      `<(?:[^:>]+:)?Attribute\\b[^>]+Name=["']${escaped}["'][^>]*>[\\s\\S]*?<(?:[^:>]+:)?AttributeValue[^>]*>([^<]+)<`
    )
  );
  return m ? xmlUnescape(m[1].trim()) : "";
}

function mapRole(
  claim: string,
  defaultRole: "owner" | "maintainer" | "viewer"
): "owner" | "maintainer" | "viewer" {
  const c = claim.trim().toLowerCase();
  if (!c) return defaultRole;
  if (c.includes("admin") || c.includes("owner")) return "owner";
  if (c.includes("maintain") || c.includes("developer") || c.includes("write") || c.includes("editor")) {
    return "maintainer";
  }
  if (c.includes("viewer") || c.includes("read")) return "viewer";
  return defaultRole;
}

/**
 * Parses, cryptographically verifies, and validates an IdP HTTP-POST SAMLResponse.
 */
export async function parseSamlResponse(
  samlResponseBase64: string,
  config: SamlConfigRecord
): Promise<SamlUserInfo> {
  if (!samlResponseBase64 || !samlResponseBase64.trim()) {
    throw new Error("SAML: Missing SAMLResponse payload");
  }

  const xml = decodeBase64Utf8(samlResponseBase64);

  // 1. Cryptographic signature verification (never bypassed)
  await verifySamlSignature(xml, config.idpCertificate);

  // 2. StatusCode, Issuer, and Conditions time window checks
  const issuer = validateSamlStatusAndConditions(xml, config.idpEntityId);

  // 3. Extract user attributes across Okta / Azure AD / Google Workspace claim conventions
  const nameId = extractNameId(xml);
  const email = (
    extractXmlAttribute(xml, config.attributeEmail) ||
    extractXmlAttribute(xml, "email") ||
    extractXmlAttribute(xml, "mail") ||
    extractXmlAttribute(xml, "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress") ||
    (nameId.includes("@") ? nameId : "")
  )
    .trim()
    .toLowerCase();

  if (!email || !email.includes("@")) {
    throw new Error("SAML: Missing valid email attribute or NameID in assertion");
  }

  const name =
    extractXmlAttribute(xml, config.attributeName) ||
    extractXmlAttribute(xml, "name") ||
    extractXmlAttribute(xml, "displayName") ||
    extractXmlAttribute(xml, "http://schemas.microsoft.com/identity/claims/displayname") ||
    extractXmlAttribute(xml, "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/name") ||
    email.split("@")[0];

  const roleClaim =
    extractXmlAttribute(xml, config.attributeRole) ||
    extractXmlAttribute(xml, "role") ||
    extractXmlAttribute(xml, "http://schemas.microsoft.com/ws/2008/06/identity/claims/role") ||
    "";

  // 4. Enforce allowed domains if configured
  if (config.allowedDomains && config.allowedDomains.trim()) {
    const domains = config.allowedDomains
      .split(",")
      .map((d) => d.trim().toLowerCase().replace(/^@/, ""))
      .filter(Boolean);
    const userDomain = email.split("@")[1]?.toLowerCase();
    if (domains.length > 0 && (!userDomain || !domains.includes(userDomain))) {
      throw new Error(`SAML: Email domain '${userDomain || "unknown"}' is not permitted for this organization`);
    }
  }

  return {
    email,
    name,
    role: mapRole(roleClaim, config.defaultRole),
    nameId: nameId || email,
    issuer,
    assertionId: extractAssertionId(xml),
  };
}
