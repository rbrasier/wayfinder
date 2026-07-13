# v1.59.0 Implementation Summary

Security hardening from a branch audit: encrypt integration credentials at rest,
and close IDOR gaps on the raw session-scoped REST routes.

## What was built

### 1. Encryption at rest for secret-bearing system settings

Every integration credential (AI provider keys incl. Bedrock secret access key,
MinIO/S3 secret key, n8n API key, Entra client secret, SMTP password / M365
client secret) was previously stored as plaintext in `admin_system_settings.value`.
They are now encrypted with AES-256-GCM before they reach the database.

- A new `SettingsEncryptionService` encrypts values into a versioned, authenticated
  envelope (`enc:v1:<base64(iv|authTag|ciphertext)>`). Decryption is envelope-aware,
  so pre-existing plaintext rows keep working and are re-encrypted on next write
  (lazy migration — no data migration required).
- A new `EncryptedSystemSettingsRepository` decorator wraps the Drizzle repository
  and encrypts only the five secret-bearing keys (`SENSITIVE_SETTING_KEYS`), leaving
  non-secret keys (feature flags, prefs, budgets) as queryable plaintext.
- The key comes from a new **required** `SETTINGS_ENCRYPTION_KEY` env var (64 hex
  chars or a base64-encoded 32-byte value), validated in both apps' env schemas so a
  deployment can never silently fall back to plaintext. `restart.sh` generates one
  into `.env` on first run.

### 2. IDOR fixes on session-scoped REST routes

The tRPC layer authorises against participant membership (`ResolveSessionAccess`,
scaling wall #11), but the raw file-serving routes only checked authentication —
any logged-in user could read, write, or delete another session's uploads and
generated documents by supplying its UUID. All now authorise against membership:

- `GET/POST /api/chat/[sessionId]/uploads`, `DELETE …/uploads/[uploadId]`
- `GET/POST /api/documents/[documentId]`

Reads require session access (honouring the ADR-018 approver grant); writes
(upload, delete, regenerate) require send access.

## Files created

- `packages/adapters/src/config/settings-encryption.ts` (+ `.test.ts`)
- `packages/adapters/src/repositories/encrypted-system-settings-repository.ts` (+ `.test.ts`)
- `apps/web/src/lib/session-access.ts` (+ `.test.ts`) — shared REST authorization helper

## Files modified

- `packages/domain/src/entities/runtime-config.ts` — `SENSITIVE_SETTING_KEYS` + `isSensitiveSettingKey`
- `packages/adapters/src/config/index.ts`, `.../repositories/index.ts` — exports
- `apps/web/src/lib/container.ts`, `apps/api/src/container.ts` — wire the encrypting repository
- `apps/web/src/lib/env.ts`, `apps/api/src/env.ts` (+ `env.test.ts`) — require `SETTINGS_ENCRYPTION_KEY`
- `apps/web/src/app/api/chat/[sessionId]/uploads/route.ts`, `.../uploads/[uploadId]/route.ts`
- `apps/web/src/app/api/documents/[documentId]/route.ts`
- `.env.example`, `restart.sh`

## Tests

- Unit: encryption round-trip / tamper / wrong-key / legacy-plaintext passthrough;
  decorator encrypt-on-write, decrypt-on-read, plaintext for non-sensitive keys;
  `authorizeSessionAccess` member / non-member / read-only / not-found / error paths;
  env schema requires and validates the key.
- End-to-end: cross-user access to another session's document/upload returning 403
  is not covered by an automated Playwright spec in this change — the E2E suite needs
  a running app + infra (Postgres/Redis/MinIO), which was not available in the audit
  environment. Recommended follow-up once infra is up.

## Migrations

None. Existing plaintext rows decrypt transparently and are re-encrypted on next save.

## Version

MINOR bump → 1.59.0 (new capability + new required env var; no schema change).

## Deferred audit findings (not in this change)

- PKI trusted-proxy check trusts a spoofable `X-Forwarded-For` last hop.
- No rate limiting on document-regeneration / upload routes (LLM/extraction cost).
- `BETTER_AUTH_SECRET` minimum length is 16; recommend ≥32.
