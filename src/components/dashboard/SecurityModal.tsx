"use client";

import React, { useState, useEffect, useCallback } from "react";
import {
  Shield,
  X,
  Key,
  Users,
  ScrollText,
  RefreshCw,
  Trash2,
  Plus,
  Copy,
  Check,
  AlertCircle,
  Loader2,
  Lock,
} from "lucide-react";

interface SecurityModalProps {
  isOpen: boolean;
  onClose: () => void;
  projectId: string;
  projectName: string;
  accessRole?: "owner" | "maintainer" | "viewer";
  isDemo?: boolean;
}

interface TelemetryKeyRow {
  id: string;
  name: string;
  keyPrefix: string;
  keyHashPreview: string;
  status: "active" | "revoked";
  lastUsedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
}

interface OrgMember {
  id: string;
  githubUsername: string;
  email: string | null;
  role: "owner" | "maintainer" | "viewer";
  status: "active" | "pending";
}

interface OrganizationRow {
  id: string;
  name: string;
  slug: string;
  myRole: "owner" | "maintainer" | "viewer";
  members: OrgMember[];
}

interface AuditLogRow {
  id: string;
  actorUsername: string;
  action: string;
  resourceType: string;
  resourceId: string | null;
  status: "success" | "denied";
  ipAddress: string | null;
  createdAt: string;
  metadataJson: string | null;
}

export function SecurityModal({
  isOpen,
  onClose,
  projectId,
  projectName,
  accessRole = "owner",
  isDemo = false,
}: SecurityModalProps) {
  const [activeTab, setActiveTab] = useState<"keys" | "rbac" | "audit">("keys");
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // API Keys State
  const [keys, setKeys] = useState<TelemetryKeyRow[]>([]);
  const [canManageSecurity, setCanManageSecurity] = useState(accessRole === "owner");
  const [newKeyName, setNewKeyName] = useState("");
  const [revealedRawKey, setRevealedRawKey] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState(false);
  const [keyBusy, setKeyBusy] = useState(false);

  // Organizations & RBAC State
  const [orgs, setOrgs] = useState<OrganizationRow[]>([]);
  const [ownedProjects, setOwnedProjects] = useState<
    Array<{ id: string; name: string; slug: string; organizationId: string | null }>
  >([]);
  const [newOrgName, setNewOrgName] = useState("");
  const [inviteOrgId, setInviteOrgId] = useState("");
  const [inviteHandle, setInviteHandle] = useState("");
  const [inviteRole, setInviteRole] = useState<"owner" | "maintainer" | "viewer">("maintainer");
  const [orgBusy, setOrgBusy] = useState(false);

  // Audit Log State
  const [auditLogs, setAuditLogs] = useState<AuditLogRow[]>([]);

  const loadTabData = useCallback(async () => {
    if (isDemo || !isOpen) return;
    setLoading(true);
    setErrorMsg(null);
    try {
      if (activeTab === "keys") {
        const res = await fetch(`/api/v1/security/keys?projectId=${encodeURIComponent(projectId)}`);
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Failed to load API keys");
        setKeys(data.keys || []);
        setCanManageSecurity(Boolean(data.canManageSecurity));
      } else if (activeTab === "rbac") {
        const res = await fetch("/api/v1/security/orgs");
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Failed to load organizations");
        setOrgs(data.organizations || []);
        setOwnedProjects(data.ownedProjects || []);
        if (data.organizations?.length > 0 && !inviteOrgId) {
          setInviteOrgId(data.organizations[0].id);
        }
      } else if (activeTab === "audit") {
        const res = await fetch(`/api/v1/security/audit?projectId=${encodeURIComponent(projectId)}`);
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Failed to load audit log");
        setAuditLogs(data.logs || []);
      }
    } catch (e: any) {
      setErrorMsg(e.message || "Security data load failed");
    } finally {
      setLoading(false);
    }
  }, [activeTab, isDemo, isOpen, projectId, inviteOrgId]);

  useEffect(() => {
    loadTabData();
  }, [loadTabData]);

  if (!isOpen) return null;

  const handleKeyAction = async (action: "generate" | "rotate" | "revoke", keyId?: string) => {
    if (isDemo) {
      setErrorMsg("Sign in with GitHub to manage live SHA-256 telemetry keys.");
      return;
    }
    setKeyBusy(true);
    setErrorMsg(null);
    setRevealedRawKey(null);
    try {
      const res = await fetch("/api/v1/security/keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId,
          action,
          keyId,
          name: newKeyName || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Key action failed");
      if (data.rawKey) setRevealedRawKey(data.rawKey);
      setNewKeyName("");
      await loadTabData();
    } catch (e: any) {
      setErrorMsg(e.message || "Failed to update key");
    } finally {
      setKeyBusy(false);
    }
  };

  const handleCreateOrg = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isDemo || !newOrgName.trim()) return;
    setOrgBusy(true);
    setErrorMsg(null);
    try {
      const res = await fetch("/api/v1/security/orgs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "create_org", name: newOrgName, projectId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to create organization");
      setNewOrgName("");
      setInviteOrgId(data.organizationId);
      await loadTabData();
    } catch (e: any) {
      setErrorMsg(e.message || "Failed to create organization");
    } finally {
      setOrgBusy(false);
    }
  };

  const handleInviteMember = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isDemo || !inviteOrgId || !inviteHandle.trim()) return;
    setOrgBusy(true);
    setErrorMsg(null);
    try {
      const res = await fetch("/api/v1/security/orgs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "invite_member",
          organizationId: inviteOrgId,
          githubUsername: inviteHandle,
          role: inviteRole,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to invite member");
      setInviteHandle("");
      await loadTabData();
    } catch (e: any) {
      setErrorMsg(e.message || "Failed to invite member");
    } finally {
      setOrgBusy(false);
    }
  };

  const handleRoleChange = async (
    organizationId: string,
    memberId: string,
    role: "owner" | "maintainer" | "viewer"
  ) => {
    if (isDemo) return;
    setOrgBusy(true);
    try {
      const res = await fetch("/api/v1/security/orgs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "update_role", organizationId, memberId, role }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to update role");
      await loadTabData();
    } catch (e: any) {
      setErrorMsg(e.message);
    } finally {
      setOrgBusy(false);
    }
  };

  const handleAssignProject = async (organizationId: string, targetProjectId: string) => {
    if (isDemo) return;
    setOrgBusy(true);
    try {
      const res = await fetch("/api/v1/security/orgs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "assign_project", organizationId, projectId: targetProjectId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to assign project");
      await loadTabData();
    } catch (e: any) {
      setErrorMsg(e.message);
    } finally {
      setOrgBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-150">
      <div className="w-full max-w-4xl bg-zinc-900 border border-zinc-700 rounded-2xl shadow-2xl p-6 text-left relative max-h-[92vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between mb-4 pb-3 border-b border-zinc-800">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-amber-950 border border-amber-700/60 flex items-center justify-center text-amber-400">
              <Shield className="w-4 h-4" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-bold text-white text-base">
                  Enterprise Security & Governance
                </h3>
                <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-300 border border-amber-500/30">
                  Role: {accessRole}
                </span>
              </div>
              <p className="text-xs text-zinc-400">
                SHA-256 Telemetry Keys • Organization RBAC • Immutable Security Audit Log ({projectName})
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="text-zinc-400 hover:text-white p-1.5 rounded-lg hover:bg-zinc-800 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tab Bar */}
        <div className="flex flex-wrap gap-2 mb-4">
          <button
            type="button"
            onClick={() => setActiveTab("keys")}
            className={`flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold transition ${
              activeTab === "keys"
                ? "bg-amber-600 text-white"
                : "bg-zinc-950 border border-zinc-800 text-zinc-400 hover:text-white"
            }`}
          >
            <Key className="w-3.5 h-3.5" />
            <span>API Keys (SHA-256)</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("rbac")}
            className={`flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold transition ${
              activeTab === "rbac"
                ? "bg-indigo-600 text-white"
                : "bg-zinc-950 border border-zinc-800 text-zinc-400 hover:text-white"
            }`}
          >
            <Users className="w-3.5 h-3.5" />
            <span>Organizations & RBAC</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("audit")}
            className={`flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold transition ${
              activeTab === "audit"
                ? "bg-emerald-600 text-white"
                : "bg-zinc-950 border border-zinc-800 text-zinc-400 hover:text-white"
            }`}
          >
            <ScrollText className="w-3.5 h-3.5" />
            <span>Immutable Audit Log</span>
          </button>
        </div>

        {errorMsg && (
          <div className="p-3 rounded-xl bg-red-950/60 border border-red-800/70 text-xs mb-4 text-red-200 flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
            <span>{errorMsg}</span>
          </div>
        )}

        <div className="flex-1 overflow-y-auto pr-1 space-y-5">
          {loading ? (
            <div className="p-6 rounded-xl bg-zinc-950 border border-zinc-800 flex items-center gap-2 text-xs text-zinc-400">
              <Loader2 className="w-4 h-4 animate-spin text-amber-400" />
              <span>Loading enterprise security records...</span>
            </div>
          ) : activeTab === "keys" ? (
            <>
              <div className="p-4 rounded-xl bg-zinc-950 border border-zinc-800 flex flex-wrap items-center justify-between gap-3 text-xs">
                <div className="flex items-center gap-2 text-zinc-300">
                  <Lock className="w-4 h-4 text-emerald-400 shrink-0" />
                  <span>
                    Beacons on <code className="text-zinc-200">/api/v1/event</code> are SHA-256 verified and Cloudflare edge + Turso rate-limited at{" "}
                    <strong className="text-white">500 beacons/min per key</strong>.
                  </span>
                </div>
              </div>

              {revealedRawKey && (
                <div className="p-4 rounded-xl bg-emerald-950/50 border border-emerald-500/50 space-y-2">
                  <div className="text-xs font-bold text-emerald-300">
                    New Key Generated — Copy Now (Stored Only as SHA-256 Hash Going Forward)
                  </div>
                  <div className="flex items-center gap-2">
                    <code className="flex-1 px-3 py-2 rounded-lg bg-zinc-950 border border-zinc-800 font-mono text-xs text-white select-all">
                      {revealedRawKey}
                    </code>
                    <button
                      type="button"
                      onClick={() => {
                        navigator.clipboard.writeText(revealedRawKey);
                        setCopiedKey(true);
                        setTimeout(() => setCopiedKey(false), 1500);
                      }}
                      className="px-3 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold flex items-center gap-1"
                    >
                      {copiedKey ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                      <span>{copiedKey ? "Copied" : "Copy"}</span>
                    </button>
                  </div>
                </div>
              )}

              {canManageSecurity && (
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    type="text"
                    value={newKeyName}
                    onChange={(e) => setNewKeyName(e.target.value)}
                    placeholder="Key label (e.g. CI/CD Runner)"
                    className="flex-1 min-w-[200px] px-3 py-2 rounded-xl bg-zinc-950 border border-zinc-800 text-xs text-white placeholder-zinc-500"
                  />
                  <button
                    type="button"
                    disabled={keyBusy}
                    onClick={() => handleKeyAction("generate")}
                    className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold disabled:opacity-50"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Generate Key</span>
                  </button>
                  <button
                    type="button"
                    disabled={keyBusy}
                    onClick={() => handleKeyAction("rotate")}
                    className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-amber-600 hover:bg-amber-500 text-white text-xs font-semibold disabled:opacity-50"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                    <span>Rotate Active Keys</span>
                  </button>
                </div>
              )}

              <div className="rounded-xl bg-zinc-950 border border-zinc-800 overflow-hidden">
                <table className="w-full text-left text-xs">
                  <thead className="bg-zinc-900/70 text-zinc-400 border-b border-zinc-800">
                    <tr>
                      <th className="py-2.5 px-3 font-medium">Label</th>
                      <th className="py-2.5 px-3 font-medium">Prefix</th>
                      <th className="py-2.5 px-3 font-medium">SHA-256 Digest</th>
                      <th className="py-2.5 px-3 font-medium">Status</th>
                      <th className="py-2.5 px-3 font-medium text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-800/70 text-zinc-300">
                    {keys.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="py-6 px-3 text-center text-zinc-500">
                          {isDemo
                            ? "Demo Preview: Sign in with GitHub to manage hashed telemetry keys."
                            : "No telemetry keys recorded yet."}
                        </td>
                      </tr>
                    ) : (
                      keys.map((k) => (
                        <tr key={k.id}>
                          <td className="py-2.5 px-3 font-medium text-white">{k.name}</td>
                          <td className="py-2.5 px-3 font-mono text-[11px]">{k.keyPrefix}</td>
                          <td className="py-2.5 px-3 font-mono text-[11px] text-zinc-400">
                            {k.keyHashPreview}
                          </td>
                          <td className="py-2.5 px-3">
                            <span
                              className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                                k.status === "active"
                                  ? "bg-emerald-500/15 text-emerald-300 border border-emerald-500/30"
                                  : "bg-red-500/15 text-red-300 border border-red-500/30"
                              }`}
                            >
                              {k.status}
                            </span>
                          </td>
                          <td className="py-2.5 px-3 text-right">
                            {canManageSecurity && k.status === "active" ? (
                              <button
                                type="button"
                                disabled={keyBusy}
                                onClick={() => handleKeyAction("revoke", k.id)}
                                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-red-950/70 hover:bg-red-900 border border-red-800/60 text-red-300 text-[11px]"
                              >
                                <Trash2 className="w-3 h-3" />
                                <span>Revoke</span>
                              </button>
                            ) : (
                              <span className="text-zinc-600">—</span>
                            )}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </>
          ) : activeTab === "rbac" ? (
            <>
              <form onSubmit={handleCreateOrg} className="flex flex-wrap gap-2">
                <input
                  type="text"
                  value={newOrgName}
                  onChange={(e) => setNewOrgName(e.target.value)}
                  placeholder="Create Organization (e.g. RitualDev Core Team)"
                  className="flex-1 min-w-[220px] px-3 py-2 rounded-xl bg-zinc-950 border border-zinc-800 text-xs text-white placeholder-zinc-500"
                />
                <button
                  type="submit"
                  disabled={orgBusy || isDemo || !newOrgName.trim()}
                  className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold disabled:opacity-50"
                >
                  Create Organization
                </button>
              </form>

              {orgs.length > 0 && (
                <form
                  onSubmit={handleInviteMember}
                  className="p-4 rounded-xl bg-zinc-950 border border-zinc-800 grid grid-cols-1 sm:grid-cols-4 gap-2"
                >
                  <select
                    value={inviteOrgId}
                    onChange={(e) => setInviteOrgId(e.target.value)}
                    className="px-3 py-2 rounded-xl bg-zinc-900 border border-zinc-800 text-xs text-white"
                  >
                    {orgs.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.name}
                      </option>
                    ))}
                  </select>
                  <input
                    type="text"
                    value={inviteHandle}
                    onChange={(e) => setInviteHandle(e.target.value)}
                    placeholder="GitHub username"
                    className="px-3 py-2 rounded-xl bg-zinc-900 border border-zinc-800 text-xs text-white placeholder-zinc-500"
                  />
                  <select
                    value={inviteRole}
                    onChange={(e) => setInviteRole(e.target.value as any)}
                    className="px-3 py-2 rounded-xl bg-zinc-900 border border-zinc-800 text-xs text-white"
                  >
                    <option value="viewer">Viewer (Read-Only)</option>
                    <option value="maintainer">Maintainer (Triage & Config)</option>
                    <option value="owner">Owner (Full Admin & Keys)</option>
                  </select>
                  <button
                    type="submit"
                    disabled={orgBusy || !inviteHandle.trim()}
                    className="px-3 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold disabled:opacity-50"
                  >
                    Invite Member
                  </button>
                </form>
              )}

              <div className="space-y-3">
                {orgs.length === 0 ? (
                  <div className="p-5 rounded-xl bg-zinc-950 border border-zinc-800 text-xs text-zinc-500">
                    {isDemo
                      ? "Demo Preview: Organizations support Owner, Maintainer, and Viewer RBAC roles across shared projects."
                      : "No organizations yet. Create an organization above to invite Maintainers and Viewers."}
                  </div>
                ) : (
                  orgs.map((org) => (
                    <div
                      key={org.id}
                      className="p-4 rounded-xl bg-zinc-950 border border-zinc-800 space-y-3"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <span className="text-sm font-bold text-white">{org.name}</span>
                          <span className="ml-2 text-[10px] font-mono text-zinc-500">
                            {org.slug}
                          </span>
                        </div>
                        {org.myRole === "owner" && ownedProjects.length > 0 && (
                          <div className="flex items-center gap-2 text-xs">
                            <span className="text-zinc-500">Link Project:</span>
                            <select
                              value={
                                ownedProjects.find((p) => p.organizationId === org.id)?.id || ""
                              }
                              onChange={(e) =>
                                e.target.value && handleAssignProject(org.id, e.target.value)
                              }
                              className="px-2 py-1 rounded-lg bg-zinc-900 border border-zinc-800 text-xs text-zinc-200"
                            >
                              <option value="">Select project...</option>
                              {ownedProjects.map((p) => (
                                <option key={p.id} value={p.id}>
                                  {p.name} {p.organizationId === org.id ? "(Linked)" : ""}
                                </option>
                              ))}
                            </select>
                          </div>
                        )}
                      </div>

                      <div className="divide-y divide-zinc-800/70">
                        {org.members.map((m) => (
                          <div
                            key={m.id}
                            className="py-2 flex items-center justify-between text-xs"
                          >
                            <div className="flex items-center gap-2">
                              <span className="font-mono text-white">@{m.githubUsername}</span>
                              <span className="text-[10px] px-2 py-0.5 rounded-full bg-zinc-800 text-zinc-400">
                                {m.status}
                              </span>
                            </div>
                            {org.myRole === "owner" ? (
                              <select
                                value={m.role}
                                onChange={(e) =>
                                  handleRoleChange(org.id, m.id, e.target.value as any)
                                }
                                className="px-2 py-1 rounded-lg bg-zinc-900 border border-zinc-800 text-xs text-zinc-200"
                              >
                                <option value="owner">Owner</option>
                                <option value="maintainer">Maintainer</option>
                                <option value="viewer">Viewer</option>
                              </select>
                            ) : (
                              <span className="uppercase text-[10px] font-bold text-indigo-300">
                                {m.role}
                              </span>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </>
          ) : (
            <div className="rounded-xl bg-zinc-950 border border-zinc-800 overflow-hidden">
              <table className="w-full text-left text-xs">
                <thead className="bg-zinc-900/70 text-zinc-400 border-b border-zinc-800">
                  <tr>
                    <th className="py-2.5 px-3 font-medium">Actor</th>
                    <th className="py-2.5 px-3 font-medium">Action</th>
                    <th className="py-2.5 px-3 font-medium">Resource</th>
                    <th className="py-2.5 px-3 font-medium">Outcome</th>
                    <th className="py-2.5 px-3 font-medium">IP</th>
                    <th className="py-2.5 px-3 font-medium">Timestamp</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800/70 text-zinc-300">
                  {auditLogs.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="py-6 px-3 text-center text-zinc-500">
                        {isDemo
                          ? "Demo Preview: Security events (key rotations, domains, RBAC changes, billing) appear here immutably."
                          : "No security audit events recorded yet."}
                      </td>
                    </tr>
                  ) : (
                    auditLogs.map((log) => (
                      <tr key={log.id}>
                        <td className="py-2 px-3 font-mono text-white">@{log.actorUsername}</td>
                        <td className="py-2 px-3 font-mono text-[11px] text-indigo-300">
                          {log.action}
                        </td>
                        <td className="py-2 px-3 text-zinc-400">
                          {log.resourceType}
                          {log.resourceId ? ` (${log.resourceId.slice(0, 14)})` : ""}
                        </td>
                        <td className="py-2 px-3">
                          <span
                            className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                              log.status === "success"
                                ? "bg-emerald-500/15 text-emerald-300"
                                : "bg-red-500/15 text-red-300"
                            }`}
                          >
                            {log.status}
                          </span>
                        </td>
                        <td className="py-2 px-3 font-mono text-[11px] text-zinc-500">
                          {log.ipAddress || "—"}
                        </td>
                        <td className="py-2 px-3 text-zinc-500">
                          {new Date(log.createdAt).toLocaleString()}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
