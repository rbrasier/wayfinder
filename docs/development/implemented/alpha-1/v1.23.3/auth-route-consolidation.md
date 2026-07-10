# Enhancement — Consolidate auth routes to `/login` and `/register`

## What changes and why

The site's only authentication pages live under `/admin`:

- `apps/web/src/app/(admin)/admin/login/page.tsx`
- `apps/web/src/app/(admin)/admin/register/page.tsx`

There are no other `/login` or `/register` routes — every user (admin or not)
signs in through `/admin/login`, and `middleware.ts` plus `(user)/page.tsx`
redirect unauthenticated visitors there. Labelling the site-wide sign-in surface
as "admin" is misleading for ordinary users and makes a shared register link look
like an admin-only page.

This enhancement renames the pages to top-level `/login` and `/register`. It is a
routing/UI change only — no domain entities, use cases, or DB schema are touched.
Admin promotion is unchanged: `ADMIN_SEED_EMAIL` seeding (`seed-admin.ts`) plus
manual promotion via the admin Users page remain exactly as they are.

The old `/admin/login` and `/admin/register` URLs are removed entirely (they will
404). No backward-compatibility redirect stubs are kept.

## Affected entities / use cases

None. No changes to `packages/domain`, `packages/application`, or the database.

## DB changes

None.

## Scope of changes

1. **Move pages into a new `(auth)` route group** so they render under the root
   layout with no sidebar:
   - `(admin)/admin/login/page.tsx` → `(auth)/login/page.tsx`
   - `(admin)/admin/register/page.tsx` → `(auth)/register/page.tsx`
   - New `(auth)/layout.tsx` providing a full-height centered container (the
     `admin/layout.tsx` flex container previously supplied that height).

2. **In-page links** (relative to the moved pages):
   - login page "Register" link `/admin/register` → `/register`
   - register page "Sign in" links `/admin/login` → `/login` (two occurrences)
   - Post-authentication target stays `/admin` — unchanged, out of scope.

3. **`middleware.ts`**
   - Non-PKI `redirectToLogin` target `/admin/login` → `/login`.
   - Move the "session cookie present → redirect to `/admin`" guard from
     `/admin/register` to `/register`; `/login` passes through.
   - Add `/login` and `/register` to the matcher so the register guard runs.

4. **`(user)/page.tsx`** — two `redirect("/admin/login")` → `/login`.

5. **`components/sidebar.tsx`**
   - Sign-out redirect `/admin/login` → `/login`.
   - Remove the now-dead early-return guard for `/admin/login` / `/admin/register`
     (those pages no longer render the sidebar).

6. **Copy / comments**
   - `(admin)/admin/settings/page.tsx` text referencing `/admin/register` →
     `/register`.
   - `server/routers/settings.ts` comment referencing `/admin/register`.

## Tests

- Update `apps/web/src/middleware.test.ts` to the new `/register` and `/login`
  paths (redirect-when-authenticated, pass-through when not).
- Update e2e specs `tests/e2e/auth-username-password.spec.ts` and
  `tests/e2e/fix-logout-and-register-sidebar.spec.ts` to the new paths.
- Add `tests/e2e/enhance-auth-route-consolidation.spec.ts` covering that
  `/login` and `/register` render the sign-in / create-account forms and that
  `/admin/login` no longer serves the login form.

## Version

PATCH bump: `1.23.2 → 1.23.3` (routing/UI change, no schema impact).

## Implementation summary

**What changed**
- Moved the login and register pages out of the `(admin)` route group into a new
  `(auth)` route group, so they now resolve at `/login` and `/register` and
  render under the root layout with no sidebar:
  - `(auth)/login/page.tsx`, `(auth)/register/page.tsx`
  - `(auth)/layout.tsx` — `min-h-screen` centered container supplying the height
    the admin layout used to provide.
- The old `/admin/login` and `/admin/register` directories were removed; those
  paths no longer host pages. For an unauthenticated visitor, `/admin/*` is
  caught by the middleware and redirected to `/login`.
- `middleware.ts`: redirect-to-login target is now `/login`; the
  "session present → redirect to `/admin`" guard moved from `/admin/register` to
  `/register`; `/login` and `/register` were added to the matcher so the guard
  runs.
- Updated redirects/links: `(user)/page.tsx` → `/login`; sidebar sign-out →
  `/login`; in-page links between login/register; admin Settings copy and a
  `settings.ts` comment now reference `/register`.
- Removed the now-dead `/admin/login` / `/admin/register` early-return guard in
  `sidebar.tsx` (those pages no longer mount the sidebar).
- Admin promotion (`ADMIN_SEED_EMAIL` seeding + manual UI) and the post-auth
  destination (`/admin`) were intentionally left unchanged.

**Tests**
- `apps/web/src/middleware.test.ts` — updated to the new paths: `/register` with a
  session cookie redirects to `/admin`, `/register` and `/login` pass through
  unauthenticated, and a protected route redirects to `/login`. Confirmed red
  before the middleware change (`/admin/login` returned), green after.
- E2E specs `tests/e2e/auth-username-password.spec.ts` and
  `tests/e2e/fix-logout-and-register-sidebar.spec.ts` updated to `/login` +
  `/register`.
- New `tests/e2e/enhance-auth-route-consolidation.spec.ts` covers `/login` and
  `/register` rendering their forms and the old `/admin/login` redirecting an
  unauthenticated visitor to `/login`.
