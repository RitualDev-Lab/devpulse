/**
 * SAML 2.0 Core
 *
 * Implements:
 *   - ASN.1 DER X.509 Certificate -> SubjectPublicKeyInfo (SPKI) extraction
 *   - SP-initiated AuthnRequest (HTTP-Redirect Binding: DEFLATE-raw + Base64)
 *   - IdP HTTP-POST SAMLResponse validation via @node-saml/node-saml:
 *       * XML-DSig signature and reference verification (XSW-safe)
 *       * Issuer, Audience, time window (±120s), and InResponseTo binding
 *       * Allowed email domain enforcement & RBAC role mapping
 *   - SP Metadata XML generation for Okta, Azure AD (Entra ID), and Google Workspace
 */

import { DOMParser } from "@xmldom/xmldom";
import { clampProvisionedRole, type OrgRole } from "../security/org-roles";
import {
  SAML,
  ValidateInResponseTo,
  type CacheProvider,
  type Profile,
} from "@node-saml/node-saml";

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
  role: OrgRole;
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

function xmlEscape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
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
): Promise<{ redirectUrl: string; requestId: string }> {
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

  return { redirectUrl: `${config.idpSsoUrl}${separator}${params.toString()}`, requestId: id };
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
// XML-DSig verification (signature, reference digests, signed-element binding, XSW
// protection), Issuer, Audience, and time-window checks are delegated to
// @node-saml/node-saml. Only the claim mapping below is local.

function toCertificatePem(certPemOrBase64: string): string {
  if (certPemOrBase64.includes("BEGIN ")) return certPemOrBase64.trim();
  const b64 = certPemOrBase64.replace(/\s+/g, "");
  if (!b64) throw new Error("SAML: Empty IdP certificate");
  const lines = b64.match(/.{1,64}/g)?.join("\n") ?? b64;
  return `-----BEGIN CERTIFICATE-----\n${lines}\n-----END CERTIFICATE-----`;
}

function normalizeEntityId(value: string): string {
  return value.trim().replace(/\/+$/, "");
}

function firstString(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    const found = value.find((v) => typeof v === "string");
    return typeof found === "string" ? found : "";
  }
  return "";
}

/** Lifetime of an AuthnRequest / RelayState session. */
export const SAML_REQUEST_TTL_MS = 10 * 60 * 1000;

export interface ExpectedAuthnRequest {
  id: string;
  issuedAt: number;
}

/**
 * Answers node-saml only for the one AuthnRequest we issued. The library expects the
 * cache value to be the issue time of that request. Single use is enforced by the
 * caller, which deletes the RelayState session row before validation.
 */
function singleUseRequestCache(expected: ExpectedAuthnRequest): CacheProvider {
  const lookup = (key: string) =>
    key === expected.id ? new Date(expected.issuedAt).toISOString() : null;
  return {
    async saveAsync() {
      return null;
    },
    async getAsync(key) {
      return lookup(key);
    },
    async removeAsync() {
      return null;
    },
    async consumeAsync(key) {
      return lookup(key);
    },
  };
}

/**
 * Parses, cryptographically verifies, and validates an IdP HTTP-POST SAMLResponse
 * for an SP-initiated flow. `expectedRequestId` is the AuthnRequest ID stored with
 * the RelayState session; IdP-initiated (unsolicited) responses are rejected.
 */
export async function parseSamlResponse(
  samlResponseBase64: string,
  config: SamlConfigRecord,
  options: { acsUrl: string; expectedRequest: ExpectedAuthnRequest | null }
): Promise<SamlUserInfo> {
  if (!samlResponseBase64 || !samlResponseBase64.trim()) {
    throw new Error("SAML: Missing SAMLResponse payload");
  }
  if (!options.expectedRequest) {
    throw new Error("SAML: Unsolicited response; no pending AuthnRequest");
  }

  const saml = new SAML({
    idpCert: toCertificatePem(config.idpCertificate),
    issuer: config.spEntityId,
    callbackUrl: options.acsUrl,
    audience: config.spEntityId,
    idpIssuer: config.idpEntityId,
    wantAssertionsSigned: true,
    wantAuthnResponseSigned: false,
    acceptedClockSkewMs: 120_000,
    validateInResponseTo: ValidateInResponseTo.always,
    requestIdExpirationPeriodMs: SAML_REQUEST_TTL_MS,
    cacheProvider: singleUseRequestCache(options.expectedRequest),
  });

  let profile: Profile | null;
  try {
    const result = await saml.validatePostResponseAsync({ SAMLResponse: samlResponseBase64 });
    profile = result.profile;
  } catch (err) {
    // Library detail stays server-side; callers map this to a generic error code.
    throw new Error(`SAML: verification failed (${(err as Error).message})`);
  }
  if (!profile) {
    throw new Error("SAML: response did not contain an authenticated assertion");
  }

  if (normalizeEntityId(profile.issuer) !== normalizeEntityId(config.idpEntityId)) {
    throw new Error("SAML: assertion issuer does not match the configured IdP");
  }

  const nameId = profile.nameID || "";
  const email = (
    firstString(profile[config.attributeEmail]) ||
    firstString(profile.email) ||
    firstString(profile.mail) ||
    firstString(profile["http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress"]) ||
    (nameId.includes("@") ? nameId : "")
  )
    .trim()
    .toLowerCase();

  if (!email || !email.includes("@")) {
    throw new Error("SAML: Missing valid email attribute or NameID in assertion");
  }

  const name =
    firstString(profile[config.attributeName]) ||
    firstString(profile.name) ||
    firstString(profile.displayName) ||
    firstString(profile["http://schemas.microsoft.com/identity/claims/displayname"]) ||
    firstString(profile["http://schemas.xmlsoap.org/ws/2005/05/identity/claims/name"]) ||
    email.split("@")[0];

  const roleClaim =
    firstString(profile[config.attributeRole]) ||
    firstString(profile.role) ||
    firstString(profile["http://schemas.microsoft.com/ws/2008/06/identity/claims/role"]) ||
    "";

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
    issuer: profile.issuer,
    assertionId: typeof profile.ID === "string" ? profile.ID : null,
  };
}

function mapRole(claim: string, defaultRole: string): OrgRole {
  const c = claim.trim().toLowerCase();
  if (!c) return clampProvisionedRole(defaultRole);
  // Owner-level claims are capped at admin: SSO never grants ownership.
  if (c.includes("admin") || c.includes("owner")) return "admin";
  if (c.includes("maintain") || c.includes("developer") || c.includes("write") || c.includes("editor")) {
    return "developer";
  }
  if (c.includes("viewer") || c.includes("read")) return "viewer";
  return clampProvisionedRole(defaultRole);
}
