"use client";

import React, { useState, useEffect, useCallback } from "react";
import {
  KeyRound,
  ShieldCheck,
  Copy,
  Check,
  AlertCircle,
  Loader2,
  Plus,
  Trash2,
  ExternalLink,
  CheckCircle2,
  Building2,
} from "lucide-react";

interface OrgSummary {
  id: string;
  name: string;
  slug: string;
  myRole: "owner" | "maintainer" | "viewer";
}

interface ScimTokenRow {
  id: string;
  label: string;
  tokenPrefix: string;
  status: "active" | "revoked";
  lastUsedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
}

interface SpEndpoints {
  acsUrl: string;
  spEntityId: string;
  metadataUrl: string;
  loginUrl: string;
  scimBaseUrl: string;
}

const PROVIDER_CARDS = [
  {
    id: "okta" as const,
    name: "Okta",
    badge: "SAML + SCIM",
    attrEmail: "email",
    attrName: "name",
    attrRole: "role",
    hint: "Okta Admin → Applications → SAML 2.0. Set Single sign-on URL to ACS URL & Audience URI to SP Entity ID.",
  },
  {
    id: "azure_ad" as const,
    name: "Microsoft Entra ID",
    badge: "Azure AD",
    attrEmail: "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress",
    attrName: "http://schemas.microsoft.com/identity/claims/displayname",
    attrRole: "http://schemas.microsoft.com/ws/2008/06/identity/claims/role",
    hint: "Entra ID → Enterprise Applications → Single sign-on → SAML. Paste Entity ID & Reply URL (ACS).",
  },
  {
    id: "google" as const,
    name: "Google Workspace",
    badge: "SAML 2.0",
    attrEmail: "email",
    attrName: "name",
    attrRole: "role",
    hint: "Google Admin → Web & mobile apps → Add custom SAML app. Map Primary email → email, First/Last name → name.",
  },
  {
    id: "custom" as const,
    name: "Custom SAML 2.0",
    badge: "RFC / IdP",
    attrEmail: "email",
    attrName: "name",
    attrRole: "role",
    hint: "Upload SP Metadata XML or manually enter ACS URL (HTTP-POST) and SP Entity ID.",
  },
];

export function SsoScimPanel({ isDemo = false }: { isDemo?: boolean }) {
  const [orgs, setOrgs] = useState<OrgSummary[]>([]);
  const [selectedOrgId, setSelectedOrgId] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [tokenBusy, setTokenBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  // SP Metadata & Endpoints
  const [sp, setSp] = useState<SpEndpoints>({
    acsUrl: "https://devpulse.ritualdev.in/api/auth/saml",
    spEntityId: "https://devpulse.ritualdev.in/api/auth/saml",
    metadataUrl: "https://devpulse.ritualdev.in/api/auth/saml/metadata",
    loginUrl: "https://devpulse.ritualdev.in/api/auth/saml",
    scimBaseUrl: "https://devpulse.ritualdev.in/api/scim/v2",
  });

  // SAML Form Fields
  const [provider, setProvider] = useState<"okta" | "azure_ad" | "google" | "custom">("okta");
  const [idpEntityId, setIdpEntityId] = useState("");
  const [idpSsoUrl, setIdpSsoUrl] = useState("");
  const [idpCertificate, setIdpCertificate] = useState("");
  const [spEntityId, setSpEntityId] = useState("");
  const [attributeEmail, setAttributeEmail] = useState("email");
  const [attributeName, setAttributeName] = useState("name");
  const [attributeRole, setAttributeRole] = useState("role");
  const [defaultRole, setDefaultRole] = useState<"owner" | "maintainer" | "viewer">("viewer");
  const [allowedDomains, setAllowedDomains] = useState("");
  const [isActive, setIsActive] = useState(false);
  const [certResult, setCertResult] = useState<{
    valid: boolean;
    sha256Fingerprint?: string;
    modulusBits?: number;
  } | null>(null);

  // SCIM Tokens State
  const [scimTokens, setScimTokens] = useState<ScimTokenRow[]>([]);
  const [scimLabel, setScimLabel] = useState("");
  const [revealedScimToken, setRevealedScimToken] = useState<string | null>(null);

  // Quick Org Creation (if user has none yet)
  const [quickOrgName, setQuickOrgName] = useState("");

  const copyVal = (key: string, val: string) => {
    navigator.clipboard.writeText(val);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 1500);
  };

  const loadOrganizations = useCallback(async () => {
    if (isDemo) {
      setOrgs([{ id: "org_demo", name: "RitualDev Enterprise (Demo)", slug: "ritualdev-demo", myRole: "owner" }]);
      setSelectedOrgId("org_demo");
      return;
    }
    setLoading(true);
    setErrorMsg(null);
    try {
      const res = await fetch("/api/v1/security/orgs");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load organizations");
      const list = (data.organizations || []) as OrgSummary[];
      setOrgs(list);
      if (list.length > 0 && !selectedOrgId) {
        const owned = list.find((o) => o.myRole === "owner") || list[0];
        setSelectedOrgId(owned.id);
      }
    } catch (err) {
      setErrorMsg((err as Error).message || "Failed to load organizations");
    } finally {
      setLoading(false);
    }
  }, [isDemo, selectedOrgId]);

  const loadSamlSettings = useCallback(async () => {
    if (!selectedOrgId || isDemo) return;
    setLoading(true);
    setErrorMsg(null);
    try {
      const res = await fetch(
        `/api/v1/security/saml?organizationId=${encodeURIComponent(selectedOrgId)}`
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load SAML settings");

      if (data.sp) setSp(data.sp);
      setScimTokens(data.scimTokens || []);

      if (data.samlConfig) {
        const c = data.samlConfig;
        setProvider(c.provider || "okta");
        setIdpEntityId(c.idpEntityId || "");
        setIdpSsoUrl(c.idpSsoUrl || "");
        setIdpCertificate(c.idpCertificate || "");
        setSpEntityId(c.spEntityId || data.sp?.spEntityId || "");
        setAttributeEmail(c.attributeEmail || "email");
        setAttributeName(c.attributeName || "name");
        setAttributeRole(c.attributeRole || "role");
        setDefaultRole(c.defaultRole || "viewer");
        setAllowedDomains(c.allowedDomains || "");
        setIsActive(Boolean(c.isActive));
      } else {
        setIdpEntityId("");
        setIdpSsoUrl("");
        setIdpCertificate("");
        setSpEntityId(data.sp?.spEntityId || "");
        setAllowedDomains("");
        setIsActive(false);
      }
    } catch (err) {
      setErrorMsg((err as Error).message || "Failed to load SAML config");
    } finally {
      setLoading(false);
    }
  }, [isDemo, selectedOrgId]);

  useEffect(() => {
    loadOrganizations();
  }, [loadOrganizations]);

  useEffect(() => {
    if (selectedOrgId && !isDemo) {
      loadSamlSettings();
    }
  }, [selectedOrgId, isDemo, loadSamlSettings]);

  const handleSelectProvider = (p: (typeof PROVIDER_CARDS)[number]) => {
    setProvider(p.id);
    setAttributeEmail(p.attrEmail);
    setAttributeName(p.attrName);
    setAttributeRole(p.attrRole);
  };

  const handleCreateQuickOrg = async () => {
    if (isDemo || !quickOrgName.trim()) return;
    setSaving(true);
    setErrorMsg(null);
    try {
      const res = await fetch("/api/v1/security/orgs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "create_org", name: quickOrgName.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to create organization");
      setQuickOrgName("");
      await loadOrganizations();
      if (data.organizationId) setSelectedOrgId(data.organizationId);
    } catch (err) {
      setErrorMsg((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const handleValidateCert = async () => {
    if (isDemo) {
      setStatusMsg("Demo mode: Certificate validation requires live session.");
      return;
    }
    setTesting(true);
    setErrorMsg(null);
    setCertResult(null);
    try {
      const res = await fetch("/api/v1/security/saml", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          organizationId: selectedOrgId,
          action: "test_saml",
          idpEntityId,
          idpSsoUrl,
          idpCertificate,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Certificate validation failed");
      setCertResult(data.certificate);
      setStatusMsg(
        `Valid X.509 RSA-${data.certificate?.modulusBits || 2048} certificate verified.`
      );
    } catch (err) {
      setErrorMsg((err as Error).message);
    } finally {
      setTesting(false);
    }
  };

  const handleSaveSaml = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isDemo) {
      setErrorMsg("Sign in with GitHub to save live SAML SSO configurations.");
      return;
    }
    setSaving(true);
    setErrorMsg(null);
    setStatusMsg(null);
    try {
      const res = await fetch("/api/v1/security/saml", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          organizationId: selectedOrgId,
          action: "save_saml",
          provider,
          idpEntityId,
          idpSsoUrl,
          idpCertificate,
          spEntityId: spEntityId || sp.spEntityId,
          attributeEmail,
          attributeName,
          attributeRole,
          defaultRole,
          allowedDomains,
          isActive,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to save SAML configuration");
      if (data.certificate) setCertResult(data.certificate);
      setStatusMsg("SAML 2.0 SSO configuration saved to Turso.");
      await loadSamlSettings();
    } catch (err) {
      setErrorMsg((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const handleCreateScimToken = async () => {
    if (isDemo) {
      setErrorMsg("Sign in with GitHub to generate live SCIM 2.0 Bearer tokens.");
      return;
    }
    setTokenBusy(true);
    setErrorMsg(null);
    setRevealedScimToken(null);
    try {
      const res = await fetch("/api/v1/security/saml", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          organizationId: selectedOrgId,
          action: "create_scim_token",
          label: scimLabel || `${PROVIDER_CARDS.find((p) => p.id === provider)?.name || "IdP"} SCIM`,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to create SCIM token");
      setRevealedScimToken(data.rawToken);
      setScimLabel("");
      await loadSamlSettings();
    } catch (err) {
      setErrorMsg((err as Error).message);
    } finally {
      setTokenBusy(false);
    }
  };

  const handleRevokeScimToken = async (tokenId: string) => {
    if (isDemo) return;
    setTokenBusy(true);
    setErrorMsg(null);
    try {
      const res = await fetch("/api/v1/security/saml", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          organizationId: selectedOrgId,
          action: "revoke_scim_token",
          tokenId,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to revoke SCIM token");
      await loadSamlSettings();
    } catch (err) {
      setErrorMsg((err as Error).message);
    } finally {
      setTokenBusy(false);
    }
  };

  const activeProviderCard =
    PROVIDER_CARDS.find((p) => p.id === provider) || PROVIDER_CARDS[0];

  if (!loading && orgs.length === 0 && !isDemo) {
    return (
      <div className="p-5 rounded-2xl bg-zinc-950 border border-zinc-800 space-y-3">
        <div className="flex items-center gap-2 text-sm font-bold text-white">
          <Building2 className="w-4 h-4 text-indigo-400" />
          <span>Create an Organization to Enable SAML SSO &amp; SCIM</span>
        </div>
        <p className="text-xs text-zinc-400">
          Enterprise SAML 2.0 and SCIM 2.0 user provisioning are scoped per Organization so you can auto-provision Maintainers &amp; Viewers cleanly.
        </p>
        <div className="flex flex-wrap gap-2">
          <input
            type="text"
            value={quickOrgName}
            onChange={(e) => setQuickOrgName(e.target.value)}
            placeholder="Organization Name (e.g. Acme Engineering)"
            className="flex-1 min-w-[220px] px-3 py-2 rounded-xl bg-zinc-900 border border-zinc-800 text-xs text-white"
          />
          <button
            type="button"
            disabled={saving || !quickOrgName.trim()}
            onClick={handleCreateQuickOrg}
            className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold flex items-center gap-1.5 disabled:opacity-50"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Create Organization</span>
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {errorMsg && (
        <div className="p-3 rounded-xl bg-red-950/60 border border-red-800/70 text-xs text-red-200 flex items-center gap-2">
          <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
          <span>{errorMsg}</span>
        </div>
      )}

      {statusMsg && (
        <div className="p-3 rounded-xl bg-emerald-950/50 border border-emerald-700/60 text-xs text-emerald-200 flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
          <span>{statusMsg}</span>
        </div>
      )}

      {/* Organization Selector + Status */}
      <div className="flex flex-wrap items-center justify-between gap-3 p-3.5 rounded-xl bg-zinc-950 border border-zinc-800">
        <div className="flex items-center gap-2.5">
          <Building2 className="w-4 h-4 text-indigo-400" />
          <span className="text-xs font-semibold text-zinc-300">Organization:</span>
          <select
            value={selectedOrgId}
            onChange={(e) => setSelectedOrgId(e.target.value)}
            className="px-3 py-1.5 rounded-lg bg-zinc-900 border border-zinc-700 text-xs text-white font-semibold"
          >
            {orgs.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name} ({o.myRole})
              </option>
            ))}
          </select>
        </div>
        {isActive && sp.loginUrl && (
          <a
            href={sp.loginUrl}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600/20 border border-emerald-500/40 text-emerald-300 text-xs font-semibold hover:bg-emerald-600/30 transition"
          >
            <span>Test SSO Sign-In</span>
            <ExternalLink className="w-3 h-3" />
          </a>
        )}
      </div>

      {/* SP Metadata / ACS / SCIM Endpoints */}
      <div className="p-4 rounded-xl bg-zinc-950 border border-zinc-800 space-y-2.5">
        <div className="flex items-center justify-between">
          <h4 className="text-xs font-bold text-white flex items-center gap-1.5">
            <ShieldCheck className="w-3.5 h-3.5 text-cyan-400" />
            <span>Service Provider (SP) &amp; SCIM 2.0 Endpoints — Copy to Your IdP</span>
          </h4>
          <a
            href={sp.metadataUrl}
            target="_blank"
            rel="noreferrer"
            className="text-[11px] text-cyan-400 hover:underline flex items-center gap-1"
          >
            <span>Download SP Metadata XML</span>
            <ExternalLink className="w-3 h-3" />
          </a>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-[11px] font-mono">
          {[
            { key: "acs", label: "ACS / Reply URL (HTTP-POST)", val: sp.acsUrl },
            { key: "entity", label: "SP Entity ID / Audience URI", val: spEntityId || sp.spEntityId },
            { key: "meta", label: "SP Metadata XML URL", val: sp.metadataUrl },
            { key: "scim", label: "SCIM 2.0 Base URL", val: sp.scimBaseUrl },
          ].map((item) => (
            <div
              key={item.key}
              className="flex items-center justify-between gap-2 p-2 rounded-lg bg-zinc-900 border border-zinc-800"
            >
              <div className="min-w-0">
                <div className="text-[10px] font-sans text-zinc-500">{item.label}</div>
                <div className="truncate text-zinc-200">{item.val}</div>
              </div>
              <button
                type="button"
                onClick={() => copyVal(item.key, item.val)}
                className="px-2 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-white shrink-0 flex items-center gap-1 font-sans"
              >
                {copiedKey === item.key ? (
                  <Check className="w-3 h-3 text-emerald-400" />
                ) : (
                  <Copy className="w-3 h-3" />
                )}
                <span>Copy</span>
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* Provider Presets */}
      <div className="space-y-2">
        <div className="text-xs font-bold text-white">1. Choose Identity Provider (IdP)</div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {PROVIDER_CARDS.map((p) => {
            const active = provider === p.id;
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => handleSelectProvider(p)}
                className={`p-3 rounded-xl border text-left transition ${
                  active
                    ? "bg-indigo-600/20 border-indigo-500 text-white"
                    : "bg-zinc-950 border-zinc-800 text-zinc-400 hover:border-zinc-700 hover:text-zinc-200"
                }`}
              >
                <div className="text-xs font-bold">{p.name}</div>
                <div className="text-[10px] text-indigo-300 mt-0.5">{p.badge}</div>
              </button>
            );
          })}
        </div>
        <p className="text-[11px] text-zinc-400 bg-zinc-950 border border-zinc-800/80 px-3 py-2 rounded-lg">
          {activeProviderCard.hint}
        </p>
      </div>

      {/* SAML 2.0 Configuration Form */}
      <form onSubmit={handleSaveSaml} className="p-4 rounded-xl bg-zinc-950 border border-zinc-800 space-y-3">
        <div className="flex items-center justify-between">
          <div className="text-xs font-bold text-white">2. Identity Provider (IdP) SAML 2.0 Credentials</div>
          <label className="flex items-center gap-2 text-xs text-zinc-200 cursor-pointer">
            <input
              type="checkbox"
              checked={isActive}
              onChange={(e) => setIsActive(e.target.checked)}
              className="rounded border-zinc-700 bg-zinc-900 text-indigo-500"
            />
            <span className="font-semibold">Enable SAML SSO</span>
          </label>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <label className="block text-[11px] text-zinc-400 mb-1">IdP Entity ID / Issuer URL *</label>
            <input
              type="text"
              value={idpEntityId}
              onChange={(e) => setIdpEntityId(e.target.value)}
              placeholder="http://www.okta.com/exk12345..."
              className="w-full px-3 py-2 rounded-lg bg-zinc-900 border border-zinc-800 text-xs text-white font-mono"
            />
          </div>
          <div>
            <label className="block text-[11px] text-zinc-400 mb-1">IdP SSO URL (HTTP-Redirect) *</label>
            <input
              type="url"
              value={idpSsoUrl}
              onChange={(e) => setIdpSsoUrl(e.target.value)}
              placeholder="https://company.okta.com/app/.../sso/saml"
              className="w-full px-3 py-2 rounded-lg bg-zinc-900 border border-zinc-800 text-xs text-white font-mono"
            />
          </div>
        </div>

        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="text-[11px] text-zinc-400">IdP X.509 Signing Certificate (PEM) *</label>
            {certResult?.valid && (
              <span className="text-[10px] font-mono text-emerald-400">
                SHA-256: {certResult.sha256Fingerprint?.slice(0, 29)}...
              </span>
            )}
          </div>
          <textarea
            rows={4}
            value={idpCertificate}
            onChange={(e) => setIdpCertificate(e.target.value)}
            placeholder={"-----BEGIN CERTIFICATE-----\nMIIDpDCCAoygAwIBAgIGAX...\n-----END CERTIFICATE-----"}
            className="w-full px-3 py-2 rounded-lg bg-zinc-900 border border-zinc-800 text-[11px] text-zinc-200 font-mono"
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <label className="block text-[11px] text-zinc-400 mb-1">Email Attribute</label>
            <input
              type="text"
              value={attributeEmail}
              onChange={(e) => setAttributeEmail(e.target.value)}
              className="w-full px-3 py-1.5 rounded-lg bg-zinc-900 border border-zinc-800 text-xs text-white font-mono"
            />
          </div>
          <div>
            <label className="block text-[11px] text-zinc-400 mb-1">Display Name Attribute</label>
            <input
              type="text"
              value={attributeName}
              onChange={(e) => setAttributeName(e.target.value)}
              className="w-full px-3 py-1.5 rounded-lg bg-zinc-900 border border-zinc-800 text-xs text-white font-mono"
            />
          </div>
          <div>
            <label className="block text-[11px] text-zinc-400 mb-1">Role Claim Attribute</label>
            <input
              type="text"
              value={attributeRole}
              onChange={(e) => setAttributeRole(e.target.value)}
              className="w-full px-3 py-1.5 rounded-lg bg-zinc-900 border border-zinc-800 text-xs text-white font-mono"
            />
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-[11px] text-zinc-400 mb-1">Allowed Corporate Domains (comma-separated)</label>
            <input
              type="text"
              value={allowedDomains}
              onChange={(e) => setAllowedDomains(e.target.value)}
              placeholder="acme.com, acme.io"
              className="w-full px-3 py-1.5 rounded-lg bg-zinc-900 border border-zinc-800 text-xs text-white"
            />
          </div>
          <div>
            <label className="block text-[11px] text-zinc-400 mb-1">Default JIT Provisioned Role</label>
            <select
              value={defaultRole}
              onChange={(e) => setDefaultRole(e.target.value as "owner" | "maintainer" | "viewer")}
              className="w-full px-3 py-1.5 rounded-lg bg-zinc-900 border border-zinc-800 text-xs text-white"
            >
              <option value="viewer">Viewer (Read-only telemetry)</option>
              <option value="maintainer">Maintainer (Issues, crashes, sync)</option>
              <option value="owner">Owner (Full RBAC &amp; billing admin)</option>
            </select>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 pt-1">
          <button
            type="button"
            disabled={testing || !idpCertificate.trim()}
            onClick={handleValidateCert}
            className="px-3.5 py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs font-semibold flex items-center gap-1.5 disabled:opacity-50"
          >
            {testing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ShieldCheck className="w-3.5 h-3.5 text-cyan-400" />}
            <span>Validate Certificate</span>
          </button>
          <button
            type="submit"
            disabled={saving}
            className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold flex items-center gap-1.5 disabled:opacity-50"
          >
            {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <KeyRound className="w-3.5 h-3.5" />}
            <span>Save SAML Configuration</span>
          </button>
        </div>
      </form>

      {/* SCIM 2.0 Provisioning Tokens */}
      <div className="p-4 rounded-xl bg-zinc-950 border border-zinc-800 space-y-3">
        <div>
          <h4 className="text-xs font-bold text-white">
            3. SCIM 2.0 Automated Provisioning &amp; Deprovisioning Tokens
          </h4>
          <p className="text-[11px] text-zinc-400 mt-0.5">
            Paste the SCIM Base URL and Bearer Token into Okta or Microsoft Entra ID to auto-create users on hire and instantly suspend access on offboarding.
          </p>
        </div>

        {revealedScimToken && (
          <div className="p-3 rounded-xl bg-emerald-950/50 border border-emerald-500/40 space-y-1.5">
            <div className="text-[11px] font-bold text-emerald-300">
              New SCIM Bearer Token — Copy Now (Stored as SHA-256 Hash Only)
            </div>
            <div className="flex items-center gap-2">
              <code className="flex-1 px-2.5 py-1.5 rounded bg-zinc-950 border border-zinc-800 font-mono text-xs text-white select-all truncate">
                {revealedScimToken}
              </code>
              <button
                type="button"
                onClick={() => copyVal("scim_raw", revealedScimToken)}
                className="px-3 py-1.5 rounded bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold flex items-center gap-1"
              >
                {copiedKey === "scim_raw" ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                <span>Copy</span>
              </button>
            </div>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <input
            type="text"
            value={scimLabel}
            onChange={(e) => setScimLabel(e.target.value)}
            placeholder="Token label (e.g. Okta Production SCIM)"
            className="flex-1 min-w-[200px] px-3 py-2 rounded-xl bg-zinc-900 border border-zinc-800 text-xs text-white"
          />
          <button
            type="button"
            disabled={tokenBusy}
            onClick={handleCreateScimToken}
            className="px-3.5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold flex items-center gap-1.5 disabled:opacity-50"
          >
            {tokenBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
            <span>Generate SCIM Token</span>
          </button>
        </div>

        <div className="space-y-1.5">
          {scimTokens.map((t) => (
            <div
              key={t.id}
              className="flex items-center justify-between gap-2 p-2.5 rounded-lg bg-zinc-900 border border-zinc-800 text-xs"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-white">{t.label}</span>
                  <code className="text-[11px] font-mono text-zinc-400">{t.tokenPrefix}</code>
                  <span
                    className={`text-[10px] px-1.5 py-0.5 rounded font-semibold ${
                      t.status === "active"
                        ? "bg-emerald-500/15 text-emerald-300"
                        : "bg-red-500/15 text-red-300"
                    }`}
                  >
                    {t.status}
                  </span>
                </div>
                <div className="text-[10px] text-zinc-500 mt-0.5">
                  Created {t.createdAt.slice(0, 10)}
                  {t.lastUsedAt ? ` • Last synced ${t.lastUsedAt.slice(0, 16).replace("T", " ")}` : " • Never synced yet"}
                </div>
              </div>
              {t.status === "active" && (
                <button
                  type="button"
                  disabled={tokenBusy}
                  onClick={() => handleRevokeScimToken(t.id)}
                  className="px-2.5 py-1 rounded-lg bg-red-950/60 hover:bg-red-900/60 border border-red-800/50 text-red-300 text-[11px] font-semibold flex items-center gap-1"
                >
                  <Trash2 className="w-3 h-3" />
                  <span>Revoke</span>
                </button>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
