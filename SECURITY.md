# Security Policy

## Reporting a Vulnerability

The RitualDev Lab team takes security seriously across both the Managed SaaS control plane (`https://devpulse.ritualdev.in`) and Self-Hosted / Air-Gapped deployments.

Please report suspected vulnerabilities privately to **security@ritualdev.in** (never open a public GitHub Issue for an unpatched exploit).

### Standard Response SLAs
| Severity | Scope | Initial Acknowledgment | Status Update Cadence |
| --- | --- | --- | --- |
| **Critical (P0)** | Remote code execution, auth/tenant isolation bypass, secret exposure | **< 1 hour** | Every 4 hours until mitigated |
| **High (P1)** | Privilege escalation, CSRF/XSS, webhook signature bypass | **< 4 hours** | Every 24 hours |
| **Medium / Low (P2–P3)** | Defense-in-depth hardening, DoS edge cases, header improvements | **< 12 hours** | Weekly triage |

---

## Telemetry & Data Sovereignty Boundary

- **Managed SaaS (`devpulse.ritualdev.in`):** Public registry metrics (GitHub stars, npm/PyPI/Crates downloads) use public APIs or user-supplied read-only encrypted tokens. Crash/log payloads undergo pre-storage edge secret & PII scrubbing.
- **Private VPC / Self-Hosted Mode:** Zero bytes of runtime crash stacks, private repository slugs, or telemetry events leave your VPC perimeter.
- **Cryptographic Controls:** Telemetry API keys are stored as SHA-256 hashes, third-party tokens use AES-256-GCM encryption at rest, administrative mutations are hash-chained (`HMAC-SHA256`), and outbound webhooks follow the Standard Webhooks (`webhook-id`, `webhook-timestamp`, `webhook-signature`) specification with `crypto.timingSafeEqual`.

---

## Supported Versions

| Version | Supported |
| --- | --- |
| `1.x` (`main`) | Yes (Active security patches) |
| `< 1.0` | No — please upgrade to latest `main` |
