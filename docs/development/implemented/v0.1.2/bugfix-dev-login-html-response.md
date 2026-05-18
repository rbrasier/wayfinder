# Bug Fix: dev-login returns HTML on session-insert failure

## Symptom

After submitting the admin login form in development, the user sees:

> Unexpected token '<', "<!DOCTYPE "... is not valid JSON

## Reproduction

1. Navigate to `/admin/login` in development mode.
2. Submit a valid `ADMIN_SEED_EMAIL`.

## Root Cause

`apps/web/src/app/api/dev-login/route.ts` line 36:

```ts
await db.insert(schema.core_sessions).values({ user_id, token, expires_at });
```

This `db.insert` is not wrapped in a try/catch. If it throws (table does not
exist, connection error, unique-token collision, etc.), the exception propagates
out of the Next.js route handler. Next.js catches it and returns an HTML error
page (status 500).

The login page's `onSubmit` handler then:

1. Sees `!res.ok` → calls `await res.json()` on the HTML response body.
2. `JSON.parse` throws `SyntaxError: Unexpected token '<'`.
3. The outer `catch` block receives this error and calls `setError(...)`.

## Affected File

- `apps/web/src/app/api/dev-login/route.ts`

## Fix Plan

Wrap the `db.insert(schema.core_sessions)` call in a try/catch block that
returns `NextResponse.json({ error: "Failed to create session." }, { status: 500 })`.

## Version Bump

PATCH — `0.1.1 → 0.1.2`
