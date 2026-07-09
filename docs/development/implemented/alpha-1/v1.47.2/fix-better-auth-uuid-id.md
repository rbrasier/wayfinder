# Bug fix — Better Auth string ids rejected by uuid columns

## Symptom

New-user registration fails. The web app logs a Postgres error during the
sign-up insert:

```
ERROR [Better Auth]: Failed to create user
PostgresError: invalid input syntax for type uuid: "0bHInbZn8y9WmFTTqhK74ntaKHKzOWks"
code: '22P02', routine: 'string_to_uuid'
```

The user row is never created, so registration is a hard blocker.

## Reproduction

1. Start the stack with email-password auth enabled.
2. Go to `/register`.
3. Fill name, email, password, confirm password and submit.
4. The insert into `core_users` fails; the form shows "Registration failed".

## Root cause (verified)

Better Auth generates its own random string ids (nanoid-style, e.g.
`0bHInbZn8y9WmFTTqhK74ntaKHKzOWks`) and passes them explicitly in the `INSERT`
for `core_users.id`. Every `core_*` auth table
(`packages/adapters/src/db/schema/core.ts`) declares `id` as a Postgres `uuid`
column:

```ts
id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
```

Postgres rejects the non-uuid string. The `gen_random_uuid()` default never
fires because Better Auth supplies a value for the column.

Verified against `node_modules` (`@better-auth/core@1.6.14`,
`dist/types/init-options.d.mts:268`): `advanced.database.generateId` accepts
`GenerateIdFn | false | "serial" | "uuid"`, and `"uuid"` makes Better Auth emit
`gen_random_uuid()` on Postgres for all id columns.

## Fix plan

Set `advanced.database.generateId: "uuid"` in `createAuth`
(`packages/adapters/src/auth/better-auth.ts`). This keeps the `uuid` columns
that CLAUDE.md mandates (`id (uuid)` on every table) and applies uniformly to
the user, session, account and verification tables — no DB migration needed.

## Tests

- Unit regression: `packages/adapters/src/auth/__tests__/better-auth.test.ts`
  asserts the constructed Better Auth instance carries
  `options.advanced.database.generateId === "uuid"`. Fails on the unfixed code.
- E2E: `apps/web/e2e/fix-better-auth-uuid-id.spec.ts` registers a fresh account
  through the UI and asserts the redirect to `/chats`.

## Implementation summary (v1.47.2)

- **Root cause:** Better Auth supplied its own random string ids for the
  `core_*` auth tables, whose `id` columns are Postgres `uuid` — Postgres
  rejected the insert (`22P02 invalid input syntax for type uuid`).
- **Fix applied:** Added `advanced.database.generateId: "uuid"` to the
  `betterAuth(...)` config in `packages/adapters/src/auth/better-auth.ts`, so
  ids are generated with `gen_random_uuid()`. No schema/migration change; the
  `uuid` columns are preserved per the `id (uuid)` convention.
- **Regression test added:** `better-auth.test.ts` builds the auth instance and
  asserts `options.advanced.database.generateId === "uuid"` (red before the
  fix, green after).
- **E2E test added:** `fix-better-auth-uuid-id.spec.ts` drives the `/register`
  form with a fresh email and asserts the `/chats` redirect.
- **Version bump:** PATCH `1.47.0 → 1.47.2` (bug fix, no schema impact;
  `1.47.1` was taken by a concurrent branch).
