# Summary — remove the API's unauthenticated user and error routes (v0.28.45)

## Root cause

`apps/api` still mounted the alpha-1 scaffold's `/v1/users` and `/v1/errors`
routers with no authentication. They duplicate the web app's tRPC `user` and
`error` routers, which sit behind Better Auth, and nothing called them. With the
admin permission split they also passed a hard-coded system caller, so an
anonymous request skipped the new guards.

## Fix applied

- Deleted both routers, their mounts and exports, and the seven use cases plus
  `DrizzleUserRoleRepository` that only they used in `apps/api/src/container.ts`.
- `SYSTEM_CALLER` removed with `users.ts`; corrected the matching known
  limitation in `admin-permission-split.summary.md`.

## Deviation from the first revision

The first revision (PR #360, against `release/alpha-2`) authenticated the routes
with a new `API_SERVICE_KEY` and ADR-067. On review there was no caller to
authenticate, so the routes are removed instead, the key and ADR are dropped, and
the fix moved onto the admin permission split branch (#355) — it ships in that
PR's v0.28.45 rather than taking its own version.

## Regression tests

- `apps/api/src/routes/removed-routes.test.ts` — all seven former routes return
  `404` through the real `buildApp`; each failed before the removal.

## E2E

None. The behaviour falls in none of the six groups of
`docs/guides/e2e-test-policy.md`; the route test is the guard.
