# Contributing to DevPulse

Thank you for helping improve **DevPulse** — the open-source Developer Headquarters & Multi-Registry Telemetry Engine by RitualDev Lab!

## Local Development Setup

```bash
git clone https://github.com/RitualDev-Lab/devpulse.git
cd devpulse
npm install
cp .env.example .env.local   # Add Turso, Supabase, and encryption secrets
npm run dev
```

## Verification Checklist Before Every PR

All pull requests must pass TypeScript typechecking, the unit test suite, and a production webpack build locally before merge:

```bash
npm run typecheck
npm test
npm run build
```

## Code & UI Guidelines

- **Type Safety:** Keep `tsc --noEmit` strictly clean (`0` errors).
- **Accessibility:** Target **WCAG 2.2 AA** across all dashboard widgets (minimum `>= 24x24px` hit areas on icon buttons, `tabular-nums` for changing numeric counters, clear text/icon pairs alongside status dots, and `Esc` / backdrop closing on modals).
- **Hydration Determinism:** Avoid locale/timezone mismatches (`toLocaleDateString()`) during SSR; format initial timestamps deterministically in UTC or wrap dynamic local times cleanly.
- **Telemetry & Security:** Never commit real API keys, tokens, or secrets. Keep PII scrubbing intact across ingestion collectors and SDKs.

## Community Standards

Please review our [Code of Conduct](CODE_OF_CONDUCT.md) and [Security Policy](SECURITY.md) before contributing.
