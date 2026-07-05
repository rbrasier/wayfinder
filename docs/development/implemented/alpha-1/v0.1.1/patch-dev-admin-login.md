# Phase: Dev-mode admin direct login

- **Status**: In Review
- **Date**: 2026-05-08
- **Target version**: 0.1.1 (bump: PATCH)

## Problem

The admin login page sends a magic link via email. In development there is no
email service, so the developer must read the URL from stdout and open it
manually. This slows down local iteration.

## Goal

When `NODE_ENV=development`, the admin login page accepts an email address and
logs the user in immediately if it matches `ADMIN_SEED_EMAIL` from the
environment. No email is sent.

## Non-goals

- This bypass must not work in production.
- No changes to the magic link flow (used in production).
- No schema changes.

## Key entities

| Entity           | Lives in                  | Change   |
| ---------------- | ------------------------- | -------- |
| `core_sessions`  | `packages/adapters/db`    | existing |
| `core_users`     | `packages/adapters/db`    | existing |

## Implementation plan

### New file: `apps/web/src/app/api/dev-login/route.ts`

POST handler.

1. Return 404 immediately unless `process.env.NODE_ENV === 'development'`.
2. Parse `{ email }` from JSON body.
3. Return 401 if `email !== env.ADMIN_SEED_EMAIL` or `ADMIN_SEED_EMAIL` is unset.
4. Call `container.repos.users.findByEmail(email)`; return 404 if user not found.
5. Generate a 32-byte random hex session token.
6. Insert `{ user_id, token, expires_at: +30 days }` into `core_sessions` via
   `container.db` + `schema.core_sessions`.
7. Set `better-auth.session_token=<token>` as an `HttpOnly`, `SameSite=Lax`
   cookie (non-secure for http localhost) in the `NextResponse`.
8. Return `{ ok: true }`.

### Modified file: `apps/web/src/app/(admin)/admin/login/page.tsx`

- When `process.env.NODE_ENV === 'development'`:
  - POST `{ email }` to `/api/dev-login`.
  - On success (`res.ok`): `window.location.href = '/admin'`.
  - On failure: show error from response JSON.
  - Button label: "Sign in".
- When not development: existing magic-link flow unchanged.
  - Button label: "Send magic link" (no change).

## DB changes

None. A new row in `core_sessions` (existing table) is created at runtime.

## Version bump

PATCH → `0.1.1`
