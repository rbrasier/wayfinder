# Bug fix — the API served user and error management without authentication

- **Severity**: Major
- **Base**: `feature/admin-permission-split/claude-rbrasier` (#355), shipping with it in v0.28.45
- **Source issue**: none

## Symptom

`apps/api` mounted two routers with no authentication in front of them:

- `/v1/users` — `GET` listed every user, `POST` created one (including with
  `isAdmin: true`), `PATCH /:id` changed any account's email, name or admin flag,
  `DELETE /:id` deleted any account.
- `/v1/errors` — `POST` wrote error-log rows, `GET /grouped` read logged error
  messages, `PATCH /status` marked errors resolved, hiding them from admins.

Anyone who could reach the API port could do all of it. With #355, the user
routes passed a hard-coded `SYSTEM_CALLER = { isAdmin: true, userId: null }`, so
an anonymous request also bypassed the new delegated-admin guards.

## Reproduction

1. `./restart.sh` (the API listens on `0.0.0.0:3001`).
2. `curl -X POST localhost:3001/v1/users -H 'Content-Type: application/json' \
   -d '{"email":"x@example.com","isAdmin":true}'`
3. `201 Created` — an admin account now exists, created by an anonymous caller.

## Root cause (verified)

Both routers are leftovers of the alpha-1 scaffold (v0.1), from before the web
app took these jobs over. Today:

- `apps/web/src/server/routers/user.ts` serves `list`, `create`, `update`,
  `delete` and `resetPassword` behind `adminProcedure` (Better Auth session), over
  the same use cases.
- `apps/web/src/server/routers/error.ts` serves `log`, `listGrouped`,
  `listInGroup`, `updateStatus` and `deleteAll`, the reads and changes behind
  `adminProcedure`.
- Nothing calls the API copies. `docs/guides/setup-aws.md` states `web` never
  calls `api`; no script, load test or doc does either. Every other area (flows,
  synthesise, sessions) exists only in tRPC.

`docker-compose.prod.yml` publishes no port for `api`, but that is a convention:
`restart.sh`, and any install that opens 3001 for the n8n callback webhook,
exposed the routes.

## Fix

Remove the duplicates instead of authenticating them. The API keeps only what it
is for: `/health`, the n8n callback webhook (HMAC-verified), and the scheduler,
retention and extraction workers.

- Deleted `apps/api/src/routes/users.ts` and `apps/api/src/routes/errors.ts`, their
  mounts in `app.ts` and exports in `routes/index.ts`.
- Removed the use cases only they used from `apps/api/src/container.ts`
  (`createUser`, `updateUser`, `deleteUser`, `listUsers`, `logError`, `listErrors`,
  `updateErrorStatus`) and the `DrizzleUserRoleRepository` #355 added for them.
  The use cases stay in `packages/application`; the web container still wires them.
- `SYSTEM_CALLER` goes with `users.ts`. ADR-066's guards now have only
  authenticated callers.

An earlier revision of this fix added a service key (`API_SERVICE_KEY`) and
ADR-067; both were dropped in favour of removal, so no new mechanism ships.

## Tests

- `apps/api/src/routes/removed-routes.test.ts` (regression, written first):
  through the real `buildApp`, each of the seven former routes answers `404`.
  All seven failed before the removal.
- No e2e: the behaviour is in none of the six groups of `e2e-test-policy.md`.

## Not done

- The web app's own `/api/*` routes were spot-checked (test and dev-login routes
  404 outside their environments) but not audited.
