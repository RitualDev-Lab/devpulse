# Phase 5: External RitualDev Ecosystem & Brand Hygiene Checklist

This runbook captures the ready-to-paste copy, unified SLAs, email hygiene, and Open VSX commands for **external RitualDev properties** managed outside the `RitualDev-Lab/devpulse` repository (`ritualdev.in`, `devshelf.ritualdev.in`, `mcp.ritualdev.in`, `RitualDev-Lab/.github`, and Open VSX).

---

## 1. Unified Contact & Brand Hygiene (`@ritualdev.in`)

Replace any legacy `@ritualdev.com` references across org READMEs and marketing pages with these canonical addresses matching [`SECURITY.md`](../SECURITY.md), [`CODE_OF_CONDUCT.md`](../CODE_OF_CONDUCT.md), and [`ACCESSIBILITY.md`](../ACCESSIBILITY.md):

| Channel | Email | Scope |
| :--- | :--- | :--- |
| Security Disclosures | `security@ritualdev.in` | Vulnerability reports, CVEs, responsible disclosure |
| Accessibility | `accessibility@ritualdev.in` | WCAG 2.2 AA feedback & remediation requests |
| Code of Conduct | `conduct@ritualdev.in` | Community & contributor enforcement |
| General & Enterprise | `team@ritualdev.in` | VPC licensing, SLA inquiries & partner support |

---

## 2. Unified Trust, Data Flow & SLA Matrix (for `ritualdev.in/trust/`, `/enterprise/`, `/about/`, `/contact/`)

### Response SLAs
- **P0 (Critical / Active Exploit / Tenant Isolation):** Initial acknowledgement in **< 1 hour**, emergency mitigation target **< 4 hours**.
- **P1 (High Severity / Auth or Data Boundary Defect):** Initial acknowledgement in **< 4 hours**, patch PR/advisory within **24 hours**.
- **P2–P3 (Medium / Low / Hardening):** Initial acknowledgement in **< 12 hours**, triage within **72 hours**.

### DevPulse Data Flow & Retention Boundary
- **Managed SaaS (`devpulse.ritualdev.in`):** Public registry snapshots cached at the edge; runtime telemetry passes through server-side PII scrubbing (`ingest-scrub.ts`) and optional BYO S3/R2 storage for large traces/source maps; analytics visitor hashes rotate monthly with zero persistent raw IP storage.
- **Self-Hosted Air-Gapped / Private VPC (`deploy/helm/devpulse/`):** Enforces non-root `RuntimeDefault` seccomp pods, default-deny external internet egress (`NetworkPolicy`), PostgreSQL `FORCE ROW LEVEL SECURITY` (`withTenantTx`), and internal OIDC/Keycloak + OpenFGA authorization with zero third-party cloud callbacks.

---

## 3. Ready-to-Paste Cross-Links & Quickstart (`ritualdev.in`, `devshelf.ritualdev.in`, `RitualDev-Lab/.github`)

### 60-Second DevPulse Quickstart (for `ritualdev.in/docs/`)
```bash
# 1. Inspect the zero-auth interactive workspace
open https://devpulse.ritualdev.in/dashboard?demo=1

# 2. Install the JS/TS or Python SDK
npm install @ritualdev/pulse
pip install devpulse-sdk

# 3. Embed live maintainer SVG badges (stars, downloads, health, security)
# Convert existing OSSInsight URLs at https://devpulse.ritualdev.in/ossinsight-alternative
```

### Open VSX Publisher Namespace Verification
```bash
# Authenticate with Open VSX Personal Access Token and claim the ritualdev-lab namespace
npx ovsx create-namespace ritualdev-lab -p "$OVSX_PAT"
npx ovsx publish -p "$OVSX_PAT"
```
