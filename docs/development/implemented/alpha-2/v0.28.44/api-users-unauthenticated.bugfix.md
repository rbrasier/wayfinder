# Bug fix — `/v1/users` on the API answers without authentication

- **Severity**: Major
- **Base branch**: `release/alpha-2`
- **Source issue**: none

## Symptom

`apps/api` mounts `buildUsersRouter(container)` at `/v1/users` with no
authentication. Anyone who can reach the API port can:

- `GET /v1/users` — list every user;
- `POST /v1/users` — create a user, including one with `isAdmin: true`;
- `PATCH /v1/users/:id` — change any account's email, name or admin flag;
- `DELETE /v1/users/:id` — delete any account.

## Reproduction

1. `./restart.sh` (the API listens on `0.0.0.0:3001`).
2. `curl -X POST localhost:3001/v1/users -H 'Content-Type: application/json' \
   -d '{"email":"x@example.com","name":"X","isAdmin":true}'`
3. `201 Created` — an admin account now exists, created by an anonymous caller.

## Root cause (verified)

- `apps/api/src/app.ts` applies only `cors()` and `express.json()` before the
  routers. Nothing on the request path checks who the caller is.
- `apps/api/src/routes/users.ts` passes the validated body straight to the
  `createUser` / `updateUser` / `deleteUser` / `listUsers` use cases.
- The route is a leftover of the initial scaffold (alpha-1, v0.1). Nothing calls
  it: the web app manages users through tRPC behind Better Auth, and
  `docs/guides/setup-aws.md` states `web` never calls `api`.
- `docker-compose.prod.yml` publishes no port for `api`, so the stock production
  compose keeps it private. That is a deployment convention, not a check: local
  `restart.sh`, and any install that opens 3001 for the n8n callback webhook
  (`docs/guides/setup-aws.md`, `setup-azure.md`), expose it.

The brief cites ADR-066's `AdminCaller` / `SYSTEM_CALLER`. Neither exists on
`release/alpha-2`; ADR-066 is still a plan on
`docs/admin-permission-split/claude-rbrasier`. The use cases take no caller
today, so there is nothing to pass yet.

## Fix plan

- Callers are machines or operators, never a browser (no session cookie reaches
  this origin), so authenticate with a shared service key rather than a Better
  Auth session — see ADR-067.
- New optional env var `API_SERVICE_KEY`. New middleware
  `requireServiceKey(expectedKey)` accepts only `Authorization: Bearer <key>`,
  compared in constant time; anything else, including an unset key, is `401`.
- Mount it in front of the users router in `app.ts`.
- A key holder is the system: when ADR-066 lands, the API passes
  `{ isAdmin: true, userId: null }` deliberately, because no user stands behind a
  service key.

## Tests

- `apps/api/src/routes/users.test.ts` (regression, written first): each route
  refused with `401` with no header, a wrong key, and when no key is configured,
  without calling the use case; a request with the right key reaches it.
- `apps/api/src/middleware/require-service-key.test.ts`: header parsing and
  comparison edge cases.
- No e2e: the behaviour is in none of the six groups of `e2e-test-policy.md`;
  the route test is the guard.

## Out of scope

- `/v1/errors` has the same gap (`GET /grouped` returns error messages). Tracked
  separately.
- Implementing `AdminCaller` (ADR-066).
