import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { SignedXml } from "xml-crypto";
import { parseSamlResponse, SAML_REQUEST_TTL_MS, type SamlConfigRecord } from "../src/lib/saml/saml-core";

const IDP = "https://idp.example.com/entity";
const SP = "https://app.example.com/saml/sp";
const ACS = "https://app.example.com/api/auth/saml";
const REQUEST_ID = "_dpreq123";

const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const publicPem = publicKey.export({ type: "spki", format: "pem" }).toString();
const privatePem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const otherKeys = generateKeyPairSync("rsa", { modulusLength: 2048 });
const otherPrivatePem = otherKeys.privateKey.export({ type: "pkcs8", format: "pem" }).toString();

const config: SamlConfigRecord = {
  idpEntityId: IDP,
  idpSsoUrl: "https://idp.example.com/sso",
  idpCertificate: publicPem,
  spEntityId: SP,
  attributeEmail: "email",
  attributeName: "name",
  attributeRole: "role",
  defaultRole: "viewer",
  allowedDomains: null,
} as unknown as SamlConfigRecord;

function isoOffset(ms: number) {
  return new Date(Date.now() + ms).toISOString();
}

function assertionXml(opts: { email?: string; issuer?: string; notOnOrAfter?: string; audience?: string; inResponseTo?: string } = {}) {
  const email = opts.email ?? "alice@example.com";
  const issuer = opts.issuer ?? IDP;
  const notOnOrAfter = opts.notOnOrAfter ?? isoOffset(5 * 60_000);
  const audience = opts.audience ?? SP;
  const inResponseTo = opts.inResponseTo ?? REQUEST_ID;
  return `<saml:Assertion ID="_assertion1" Version="2.0" IssueInstant="${isoOffset(0)}">` +
    `<saml:Issuer>${issuer}</saml:Issuer>` +
    `<saml:Subject><saml:NameID Format="urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress">${email}</saml:NameID>` +
    `<saml:SubjectConfirmation Method="urn:oasis:names:tc:SAML:2.0:cm:bearer">` +
    `<saml:SubjectConfirmationData NotOnOrAfter="${notOnOrAfter}" Recipient="${ACS}" InResponseTo="${inResponseTo}"/>` +
    `</saml:SubjectConfirmation></saml:Subject>` +
    `<saml:Conditions NotBefore="${isoOffset(-60_000)}" NotOnOrAfter="${notOnOrAfter}">` +
    `<saml:AudienceRestriction><saml:Audience>${audience}</saml:Audience></saml:AudienceRestriction></saml:Conditions>` +
    `<saml:AttributeStatement>` +
    `<saml:Attribute Name="email"><saml:AttributeValue>${email}</saml:AttributeValue></saml:Attribute>` +
    `<saml:Attribute Name="name"><saml:AttributeValue>Alice</saml:AttributeValue></saml:Attribute>` +
    `<saml:Attribute Name="role"><saml:AttributeValue>admin</saml:AttributeValue></saml:Attribute>` +
    `</saml:AttributeStatement></saml:Assertion>`;
}

function responseXml(assertion: string, inResponseTo = REQUEST_ID) {
  return `<samlp:Response xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol" xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion" ` +
    `ID="_resp1" Version="2.0" IssueInstant="${isoOffset(0)}" Destination="${ACS}" InResponseTo="${inResponseTo}">` +
    `<saml:Issuer>${IDP}</saml:Issuer>` +
    `<samlp:Status><samlp:StatusCode Value="urn:oasis:names:tc:SAML:2.0:status:Success"/></samlp:Status>` +
    assertion +
    `</samlp:Response>`;
}

/** Signs the Assertion element (enveloped signature) with the given private key. */
function signAssertion(xml: string, key: string): string {
  const sig = new SignedXml({
    privateKey: key,
    signatureAlgorithm: "http://www.w3.org/2001/04/xmldsig-more#rsa-sha256",
    canonicalizationAlgorithm: "http://www.w3.org/2001/10/xml-exc-c14n#",
  });
  sig.addReference({
    xpath: "//*[local-name(.)='Assertion']",
    transforms: [
      "http://www.w3.org/2000/09/xmldsig#enveloped-signature",
      "http://www.w3.org/2001/10/xml-exc-c14n#",
    ],
    digestAlgorithm: "http://www.w3.org/2001/04/xmlenc#sha256",
  });
  sig.computeSignature(xml, {
    location: { reference: "//*[local-name(.)='Assertion']/*[local-name(.)='Issuer']", action: "after" },
  });
  return sig.getSignedXml();
}

function encode(xml: string) {
  return Buffer.from(xml, "utf8").toString("base64");
}

const expectedRequest = { id: REQUEST_ID, issuedAt: Date.now() - 60_000 };

async function expectRejected(xml: string, request: typeof expectedRequest | null = expectedRequest) {
  await assert.rejects(parseSamlResponse(encode(xml), config, { acsUrl: ACS, expectedRequest: request }));
}

test("accepts a correctly signed, bound, in-window response", async () => {
  const xml = signAssertion(responseXml(assertionXml()), privatePem);
  const user = await parseSamlResponse(encode(xml), config, { acsUrl: ACS, expectedRequest });
  assert.equal(user.email, "alice@example.com");
  assert.equal(user.name, "Alice");
  // Owner-level IdP claims are capped at admin; SSO never grants ownership.
  assert.equal(user.role, "admin");
});

test("rejects an unsigned assertion", async () => {
  await expectRejected(responseXml(assertionXml()));
});

test("rejects an assertion signed by a different key", async () => {
  await expectRejected(signAssertion(responseXml(assertionXml()), otherPrivatePem));
});

test("rejects a signed assertion whose content was altered after signing", async () => {
  const signed = signAssertion(responseXml(assertionXml()), privatePem);
  const tampered = signed.replace("alice@example.com</saml:AttributeValue>", "mallory@example.com</saml:AttributeValue>");
  assert.notEqual(tampered, signed);
  await expectRejected(tampered);
});

test("rejects signature wrapping: an unsigned forged assertion next to a valid signed one", async () => {
  const signed = signAssertion(responseXml(assertionXml()), privatePem);
  const forged = assertionXml({ email: "admin@example.com" }).replace('ID="_assertion1"', 'ID="_forged"');
  // Put the forged, unsigned assertion first so a naive "find the first Assertion" reader accepts it.
  const wrapped = signed.replace("<saml:Assertion ", `${forged}<saml:Assertion `);
  await expectRejected(wrapped);
});

test("rejects a response with a wrong InResponseTo", async () => {
  const signed = signAssertion(responseXml(assertionXml({ inResponseTo: "_other" }), "_other"), privatePem);
  await expectRejected(signed);
});

test("rejects an unsolicited response (no pending AuthnRequest)", async () => {
  const signed = signAssertion(responseXml(assertionXml()), privatePem);
  await expectRejected(signed, null);
});

test("rejects an assertion from a different issuer", async () => {
  const signed = signAssertion(responseXml(assertionXml({ issuer: "https://evil.example.com" })), privatePem);
  await expectRejected(signed);
});

test("rejects an assertion for a different audience", async () => {
  const signed = signAssertion(responseXml(assertionXml({ audience: "https://other-sp.example.com" })), privatePem);
  await expectRejected(signed);
});

test("rejects an expired assertion", async () => {
  const signed = signAssertion(
    responseXml(assertionXml({ notOnOrAfter: isoOffset(-10 * 60_000) })),
    privatePem
  );
  await expectRejected(signed);
});
