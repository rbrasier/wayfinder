# Bug fix — Missing logout button & `/admin/register` shows admin sidebar

## Symptoms

1. **No logout button.** Once signed in there is no way to sign out from the UI.
2. **`/admin/register` renders inside the full admin sidebar.** When an admin is
   already logged in (or the URL is shared and opened directly), the registration
   page appears wrapped in admin navigation, which is confusing for a new
   registrant.

## Reproduction

1. Sign in as an admin.
2. Observe the sidebar footer — it shows the user's name/email but offers no
   sign-out control.
3. Navigate directly to `/admin/register`. The page renders with the full admin
   navigation sidebar instead of a bare registration screen.

## Root cause

- **Logout:** Better Auth's `authClient.signOut()` is available but is never wired
  to any UI element. `apps/web/src/components/sidebar.tsx` renders the user's
  identity in the footer with no action to end the session.
- **Register sidebar:** `apps/web/src/app/(admin)/admin/layout.tsx` always renders
  `<AppSidebar isAdmin />` for every route under `/admin`. The sidebar only
  suppresses itself for `/admin/login` (`sidebar.tsx`), so `/admin/register`
  inherits the full admin navigation. Separately, `middleware.ts` allows any
  visitor — including an already-authenticated admin — through to
  `/admin/register`, so a logged-in admin who lands there sees the registration
  form inside admin chrome rather than being sent to the app.

## Fix plan

1. **`apps/web/src/components/sidebar.tsx`**
   - Add a **Sign out** button to the footer (desktop sidebar and mobile drawer)
     that calls `authClient.signOut()` and then redirects to `/admin/login`.
   - Extend the early-return guard so the sidebar is hidden on `/admin/register`
     as well as `/admin/login`, giving registrants a bare layout.

2. **`apps/web/src/middleware.ts`**
   - When a session cookie is present on a `/admin/register` request, redirect to
     `/admin` so logged-in admins never see the registration form.

## Tests

- **Regression (vitest):** `apps/web/src/middleware.test.ts` — a `/admin/register`
  request with a session cookie redirects to `/admin`; without a cookie it passes
  through. Fails on the unfixed middleware.
- **Playwright e2e:** `tests/e2e/fix-logout-and-register-sidebar.spec.ts` —
  - the sign-out button is visible and signing out lands on `/admin/login`;
  - a fresh visitor on `/admin/register` sees no admin navigation;
  - a logged-in admin visiting `/admin/register` is redirected to `/admin`.

## Version

PATCH bump: `1.23.1 → 1.23.2` (UI/behaviour fix, no schema impact).

## Implementation summary

**Root cause**
- `authClient.signOut()` was available but never wired to any UI element.
- The admin layout always rendered `<AppSidebar isAdmin />`; the sidebar only
  suppressed itself for `/admin/login`, so `/admin/register` inherited admin
  navigation. `middleware.ts` also let authenticated users reach
  `/admin/register`.

**Fix applied**
- `apps/web/src/components/sidebar.tsx`: added a `handleSignOut` handler
  (`authClient.signOut()` → redirect to `/admin/login`) and a **Sign out** button
  in both the desktop footer and the mobile drawer footer. Extended the
  early-return guard to hide the sidebar on `/admin/register` as well as
  `/admin/login`.
- `apps/web/src/middleware.ts`: requests to `/admin/register` that carry a
  session cookie are now redirected to `/admin`; unauthenticated visitors still
  pass through.

**Regression test added**
- `apps/web/src/middleware.test.ts` — verifies the `/admin/register` redirect for
  a request with a session cookie, pass-through without a cookie, and that
  `/admin/login` still passes through. Confirmed red on the unfixed middleware
  (200 instead of 307), green after the fix.

**E2E test added**
- `tests/e2e/fix-logout-and-register-sidebar.spec.ts` — covers the sign-out
  button signing the user out to `/admin/login`, a fresh visitor on
  `/admin/register` seeing no admin navigation, and a signed-in admin being
  redirected away from `/admin/register` to `/admin`.
