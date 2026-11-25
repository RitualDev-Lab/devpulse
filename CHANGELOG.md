# Changelog

## Unreleased

### Security
- SAML: replaced the regex-based XML signature check with `@node-saml/node-saml`. Signed assertions are required, `InResponseTo` is bound to a stored AuthnRequest ID, unsolicited (IdP-initiated) responses are rejected, and verification errors are returned generically.
- Dodo billing webhook: signature verification is required; the live-API fallback that accepted unsigned events was removed.
- GitHub webhook: `GITHUB_WEBHOOK_SECRET` is required (503 when unset) and signatures are verified.
- Rate limiter and Turnstile checks fail closed when the backing store or secret is unavailable.
- API keys are accepted only in headers (`Authorization: Bearer` or `X-DevPulse-Key`); query-string keys were removed.
- `prj_ritual_core` demo bypass requires `DEVPULSE_PUBLIC_DEMO_PROJECT=true`.
- Error responses return generic messages; upstream error detail is logged server-side only.
- Telemetry ingest paths (OTLP, Loki, logs, analytics, deploy webhook, reports) scrub emails, tokens, and similar PII; event reports no longer store reporter email.
- Cron sync no longer accepts `?secret=`.
- Committed infrastructure identifiers were removed from `wrangler.toml`; the zone ID and Turso/Supabase values must now be configured.

### Changed
- Public origin, portal domain, CNAME target, and alert sender come from configuration (`NEXT_PUBLIC_APP_URL`, `DEVPULSE_PORTAL_DOMAIN`, `DEVPULSE_CNAME_TARGET`) instead of hardcoded literals.
- JS SDK: `dist/index.d.ts` is generated; oversized payloads are refused instead of truncated; the API key is sent only as a Bearer header.
- MCP server, Flutter SDK, and dashboard snippets send the key as a Bearer header.

### Added
- `npm test` and `npm run typecheck`; CI workflow (`.github/workflows/ci.yml`).
- LICENSE (MIT) and this changelog.

### Known gaps
- ESLint reports pre-existing errors (`no-explicit-any`, unused variables); the lint job is non-gating.
- Local development requires a libSQL server (`turso dev`); `file:` URLs are not supported by the web client.
