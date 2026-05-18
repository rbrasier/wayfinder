# Implementation Summary — v0.5.0 PKI Certificate Authentication

**Date**: 2026-05-16  
**Version bump**: `0.4.1` → `0.5.0` (MINOR)

---

## What was built

PKI/client-certificate authentication as a first-class selectable auth method. The reverse proxy (nginx/Caddy) terminates mTLS and forwards validated certificate identity via request headers; the app authenticates, JIT-provisions users, and creates Better Auth sessions. The `init-project.sh` script now prompts for auth method at bootstrap time.

---

## Files created

| File | Purpose |
|---|---|
| `packages/adapters/src/auth/pki-cert-adapter.ts` | Core PKI auth logic — header validation, identity extraction, JIT provisioning, session creation |
| `packages/adapters/src/auth/__tests__/pki-cert-adapter.test.ts` | 16 unit tests covering all paths |
| `packages/adapters/drizzle/0003_naive_venom.sql` | Migration adding `cert_fingerprint` and `cert_subject_dn` to `core_users` |
| `packages/adapters/drizzle/meta/0003_snapshot.json` | Drizzle migration snapshot |
| `apps/web/src/app/api/auth/cert/route.ts` | Next.js route — `POST /api/auth/cert` — bridges PKI headers to session cookie |

## Files modified

| File | Change |
|---|---|
| `packages/adapters/src/db/schema/core.ts` | Added `cert_fingerprint text` and `cert_subject_dn text` (nullable) to `core_users` |
| `packages/adapters/src/auth/better-auth.ts` | Added `AuthMethod` discriminated union; `createAuth` now conditional on method |
| `packages/adapters/src/auth/index.ts` | Exports `PkiCertAdapter`, `AuthMethod`, `PkiConfig` |
| `apps/web/src/middleware.ts` | PKI modes redirect unauthenticated users to `/api/auth/cert` |
| `apps/web/src/lib/env.ts` | Added `AUTH_METHOD`, `PKI_TRUSTED_PROXY_IPS`, `PKI_SESSION_TTL_HOURS` |
| `apps/web/src/lib/container.ts` | Wires `authMethod` config and instantiates `PkiCertAdapter` when PKI active |
| `.env.example` | Added `AUTH_METHOD`, `PKI_TRUSTED_PROXY_IPS`, `PKI_SESSION_TTL_HOURS` |
| `scripts/init-project.sh` | Auth method selection prompt; writes `AUTH_METHOD` to `.env.example` |
| `VERSION` + `package.json` | `0.4.1` → `0.5.0` |

---

## Migrations run

Migration `0003_naive_venom.sql` adds two nullable columns to `core_users`:

```sql
ALTER TABLE "core_users" ADD COLUMN "cert_fingerprint" text;
ALTER TABLE "core_users" ADD COLUMN "cert_subject_dn" text;
```

These are backwards-compatible nullable additions; no data migration required.

---

## Architecture notes

- `PkiCertAdapter` takes `Database` (direct Drizzle) for cert-specific writes and session inserts, and `IUserRepository` for domain user operations. This keeps domain logic in the port while auth-infrastructure writes bypass the port (consistent with how `resolveSession` works).
- Identity extraction: SAN email header takes priority; CN value used as fallback only if it matches an email pattern. CN always used as display name regardless.
- Trusted proxy check: exact IP match against `PKI_TRUSTED_PROXY_IPS`. CIDR range support is a future enhancement.
- Session cookie: `HttpOnly`, `Secure` (when HTTPS), `SameSite=lax` — matching Better Auth's magic link session behaviour.
- Open redirect: `?redirect=` is validated to be a relative path (`/...` without `//` prefix); absolute URLs are discarded and default to `/`.

---

## Known limitations

- Trusted proxy check is exact-IP only — no CIDR range support. Deployments with multiple proxy IPs can comma-separate them; CIDR parsing is a future enhancement.
- Google OAuth is scaffolded (init script option present, `createAuth` throws with instructions) but not implemented.
- No CRL/OCSP revocation checking — the app trusts the proxy's validation entirely.
- JIT provisioning has no allowlist — any holder of a cert signed by the proxy's trusted CA gains access. Deployers must control CA trust at the reverse proxy level.
