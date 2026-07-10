# Bug Fix: Auth Session Expiry Redirect and Register Page Redirect

## Symptoms

1. When a session expires, navigating to a protected page (`/admin`, `/chats`, `/flows`) renders the page shell with broken data instead of redirecting to the login page with an explanatory message.
2. Navigating to `/register` with an expired session cookie redirects to `/admin` instead of showing the register form.

## Root Cause

`apps/web/src/middleware.ts` checks only for the *presence* of a session cookie value, not its validity against the database. Better Auth does not remove the browser cookie when a server-side session expires (`expires_at` in `core_sessions` passes). The stale cookie has a non-empty value, so all middleware checks that test `getSessionCookie(req)?.value` pass as if the user were authenticated.

Two consequences:

### Bug 1 — Expired session bypasses layout guards
- Middleware allows requests to `/admin`, `/chats`, `/flows` through because the cookie exists.
- `(user)/layout.tsx` and `(admin)/admin/layout.tsx` do not validate the session — they call `createServerHelpers()` which resolves `userId = null` silently.
- tRPC prefetches (`user.me`, `session.list`, etc.) throw `UNAUTHORIZED` internally but the page shell (sidebar, chrome) still renders.
- Users see a broken authenticated-looking UI with no error or redirect.

### Bug 2 — `/register` redirect fires on stale cookies
- Middleware's `/register` block redirects to `/admin` whenever `getSessionCookie(req)?.value` is truthy.
- A stale (expired) cookie satisfies this test.
- Users with expired sessions cannot reach the register page.

## Reproduction Steps

1. Log in and receive a valid session cookie.
2. Artificially expire the session: update `core_sessions.expires_at` in the DB to a past timestamp, or wait for natural expiry.
3. Navigate to `/chats` or `/admin` — observe broken shell instead of login redirect.
4. Navigate to `/register` — observe redirect to `/admin` instead of register form.

## Fix Plan

### 1. `apps/web/src/middleware.ts`
- Remove the `/register` redirect block entirely (session validity cannot be checked in edge middleware without a DB call).
- Remove `/register` from the `config.matcher` array.

### 2. `apps/web/src/app/(user)/layout.tsx`
- Validate the session server-side.
- If no cookie → `redirect("/login")`.
- If cookie present but `resolveSession` returns null → `redirect("/login?expired=true")`.

### 3. `apps/web/src/app/(admin)/admin/layout.tsx`
- Same session validation as the user layout.

### 4. `apps/web/src/app/(auth)/login/page.tsx`
- Use `useSearchParams` to read `expired` query param.
- Display "Your session has expired, please sign in again." banner when `expired=true`.
- Wrap in `<Suspense>` as required by Next.js for `useSearchParams`.

### 5. `apps/web/src/app/(auth)/register/`
- Extract current client component to `register-form.tsx`.
- Replace `page.tsx` with a server component that validates the session and redirects authenticated users to `/admin`, otherwise renders `<RegisterForm />`.

## Files Changed

- `apps/web/src/middleware.ts`
- `apps/web/src/app/(user)/layout.tsx`
- `apps/web/src/app/(admin)/admin/layout.tsx`
- `apps/web/src/app/(auth)/login/page.tsx`
- `apps/web/src/app/(auth)/register/page.tsx` (converted to server component)
- `apps/web/src/app/(auth)/register/register-form.tsx` (new — extracted client form)

## Version Bump

PATCH — no schema changes, no new features.

---

## Implementation Summary

**Root cause confirmed:** `middleware.ts` checked cookie presence only, not validity. Better Auth retains the browser cookie after server-side session expiry, so stale cookies passed all middleware checks.

**Fix applied:**

1. `middleware.ts` — Removed the `/register` redirect block (session validity requires a DB call, not possible in edge middleware). Protected route guard unchanged (cookie presence check is sufficient as a fast path; layout provides the authoritative check).

2. `(user)/layout.tsx` and `(admin)/admin/layout.tsx` — Added server-side session validation. Redirects to `/login` if no cookie, `/login?expired=true` if the cookie exists but `resolveSession` returns null (expired/invalid session).

3. `login/page.tsx` — Extracted form logic into `LoginForm` component using `useSearchParams` to read `?expired=true`. Wrapped in `<Suspense>` per Next.js requirements. Displays an amber banner: "Your session has expired, please sign in again."

4. `register/page.tsx` — Converted to a server component that validates the session before deciding to redirect (valid session → `/admin`) or render the form. Client form extracted to `register-form.tsx`.

5. `settings/page.tsx` — Removed unused card component imports (commented-out code left behind; pre-existing lint failure).

**Regression test added:** `apps/web/src/middleware.test.ts` — new test group "middleware — /register access" with case "does not redirect /register to /admin even when a session cookie is present". Previously failing; passes after fix.

**E2e test added:** `tests/e2e/fix-auth-session-expiry-and-register-redirect.spec.ts` — covers both bugs via stale cookie injection: no-session redirects, stale-cookie redirects to `/login?expired=true`, expired session banner visibility, and `/register` accessibility with a stale cookie.
