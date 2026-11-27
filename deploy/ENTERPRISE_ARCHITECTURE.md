# DevPulse Enterprise & Air-Gapped VPC Architecture Guide

This document defines the deployment topology, storage modes, database tenant isolation, IAM/ReBAC authorization, and network security boundary for running **DevPulse** inside private cloud VPCs or air-gapped enterprise networks.

---

## 1. Dual-Mode Storage Adapter (`src/db/enterprise-adapter.ts`)

Configure `DEVPULSE_STORAGE_MODE` via Helm (`architecture.mode`) or environment variables:

| Mode | Relational Store | Analytical Time-Series Store | Object Store | Use Case |
| :--- | :--- | :--- | :--- | :--- |
| **`edge`** (default) | Managed libSQL / Turso | Hourly rollup tables | Cloudflare R2 | SaaS Cloud & lightweight edge workers |
| **`lean`** | PostgreSQL 16 + `FORCE RLS` | TimescaleDB hypertables | AWS S3 / MinIO | Single-VPC teams up to 50M events/mo |
| **`scale`** | PostgreSQL 16 + `FORCE RLS` | ClickHouse cluster | AWS S3 / MinIO | Enterprise fleets 100M–10B+ events/mo |

---

## 2. Zero-Egress Air-Gapped Kubernetes Deployment (`deploy/helm/devpulse/`)

- Containers enforce `runAsNonRoot: true`, `readOnlyRootFilesystem: true`, `allowPrivilegeEscalation: false`, `capabilities.drop: ["ALL"]`, and `RuntimeDefault` seccomp profile.
- When `networkPolicy.airgappedZeroEgress=true`, Kubernetes `NetworkPolicy` blocks all public internet egress and permits traffic strictly to internal CoreDNS, VPC PostgreSQL/ClickHouse, internal OIDC/Keycloak, and OpenFGA.
- Set `global.imageRegistry` to your internal mirror (Harbor / Artifactory / ECR Private).

---

## 3. PostgreSQL Row-Level Security (`FORCE ROW LEVEL SECURITY`)

Apply `drizzle/pg-rls-migration.sql` to enable `FORCE ROW LEVEL SECURITY` on all tenant-scoped tables. All backend queries execute inside `withTenantTx(client, orgId, ...)` (`src/db/postgres-rls.ts`), which binds `set_config('app.current_org_id', $1, true)` to the transaction lifecycle so pooled connections cannot leak rows across organizations.

---

## 4. Air-Gapped IAM & OpenFGA ReBAC (`src/lib/security/openfga.ts`)

- Supports internal **OIDC / Keycloak / Dex** and **SAML 2.0 + SCIM v2** directory sync with zero external auth dependencies.
- Evaluates fine-grained resource inheritance (`organization` &rarr; `workspace` &rarr; `project` &rarr; `secret_vault`) through `evaluateRebacPermission`, enforcing fail-closed separation between read-only `viewer` roles and `can_read_secrets`.
