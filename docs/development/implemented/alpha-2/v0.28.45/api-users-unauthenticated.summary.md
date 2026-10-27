# Summary — `/v1/users` requires a service key (v0.28.45)

## Root cause

`apps/api/src/app.ts` mounted the scaffold-era users router with only `cors()`
and `express.json()` in front of it, so the list, create, update and delete
routes ran for any caller who could reach the API port. The stock production
compose keeps that port private, but nothing in code enforced it.

## Fix applied

- `API_SERVICE_KEY` (optional) added to `apps/api/src/env.ts` and `.env.example`.
- `apps/api/src/middleware/require-service-key.ts`: accepts only
  `Authorization: Bearer <API_SERVICE_KEY>`, compared as SHA-256 digests with
  `timingSafeEqual`; anything else, and every request while the key is unset,
  gets `401 UNAUTHORIZED`.
- `app.ts` mounts it in front of `/v1/users`.
- ADR-067 records the choice (service key over a Better Auth session, because
  the only callers are scripts and services), and that a key holder is the
  system: when ADR-066's `AdminCaller` lands, the API passes
  `{ isAdmin: true, userId: null }` on purpose.

## Deviation from the brief

The brief said to replace a `SYSTEM_CALLER` on `release/alpha-2`. ADR-066 and
`AdminCaller` exist only as plans on `docs/admin-permission-split/claude-rbrasier`,
so there was nothing to replace; ADR-067 states what that caller must be.

## Regression tests

- `apps/api/src/routes/users.test.ts` (new) — through the real `buildApp`, each
  of the four routes is refused with `401` with no header, a wrong key, and no
  configured key, without reaching its use case; with the right key it reaches
  the use case. The 12 refusal cases failed before the fix.
- `apps/api/src/middleware/require-service-key.test.ts` (new) — scheme handling,
  near-miss keys (prefix, suffix, one character off), unset and empty keys.

## E2E

None. The behaviour falls in none of the six groups of
`docs/guides/e2e-test-policy.md`; the route test is the guard.

## Not done

- `/v1/errors` has the same gap; tracked separately.
