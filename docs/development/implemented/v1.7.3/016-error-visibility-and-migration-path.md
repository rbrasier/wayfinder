# Bug Fix: Buried errors and bundler-fragile runtime migrations

## Symptom

The previous v1.7.1 fix added `runMigrations()` to `instrumentation.ts` to apply
migration 0005 (`expert_role` column on `app_flows`) at startup, but the same
runtime errors continue to surface:

```
TRPCError: Failed to create flow.   trpc:mutation:flow.create
TRPCError: Failed to list flows.    trpc:query:flow.list
```

The error logger shows only the generic shrink-wrap message — the underlying
Postgres / Drizzle exception is nowhere to be found, so each fix has had to
guess at the root cause.

## Root Cause Diagnosis

### 1. The real cause is being swallowed at three layers

`packages/adapters/src/repositories/drizzle-flow-repository.ts:51-53`:

```ts
} catch (cause) {
  return err(domainError("INFRA_FAILURE", "Failed to create flow.", cause));
}
```

The `cause` is captured in the `DomainError` but never logged. Every sibling
`drizzle-*-repository.ts` has the same pattern (12 files).

`apps/web/src/server/routers/flow.ts:218` (and every other router):

```ts
if (result.error) throw new TRPCError({
  code: "INTERNAL_SERVER_ERROR",
  message: result.error.message,   // cause dropped here
});
```

`apps/web/src/server/trpc.ts:55-65` — the `errorLogging` middleware persists
only `message`, `stack`, and `code`. There is no `cause` field on the payload,
so even if a `TRPCError` carries one it never lands in `error_logs.metadata`.

`packages/adapters/src/errors/drizzle-error-logger.ts` — only mirrors to
console when *persistence itself* fails. Every other persisted error is
invisible on stderr.

Net effect: the operator sees `"Failed to create flow."` in the error UI and
nothing else. There is no way to distinguish "column doesn't exist" from
"connection refused" from "JSON column type mismatch" without attaching a
debugger.

### 2. The v1.7.1 auto-migrate fix likely never runs migrations

`packages/adapters/src/db/migrate.ts:11`:

```ts
const migrationsFolder = join(dirname(fileURLToPath(import.meta.url)), "..", "drizzle");
```

`apps/web/next.config.ts` lists `@rbrasier/adapters` under `transpilePackages`,
so Next webpack-bundles the adapter into `.next/server/...` chunks. After
bundling, `import.meta.url` resolves to a webpack chunk path, not to
`packages/adapters/src/db/`. The `".."` no longer lands next to the SQL files.
`migrate()` then throws ENOENT, which `instrumentation.ts:6-9` swallows into a
bare `console.error`. If the operator's deployment doesn't surface stdout (or
the dev environment isn't being watched), the failure is invisible.

The downstream consequence is exactly what the user observes: the
`expert_role` column never gets created, so every `SELECT` / `INSERT` against
`app_flows` fails, gets re-wrapped as `"Failed to ..."`, and the cycle repeats.

### 3. Persisted errors are buried (user-reported)

Even when an error reaches `error_logs`, there is no console mirror. The user
explicitly asked that DB-persisted errors also surface on stderr so they are
findable without opening the admin UI.

## Reproduction

1. Fresh DB at migration 0004 (no `expert_role` column).
2. Start `apps/web` in dev. `runMigrations()` runs from `instrumentation.ts`
   and silently fails (path not found).
3. Hit `flow.list` or `flow.create`. Observe `"Failed to ..."` in error_logs,
   no underlying cause, no stderr trace.

## Fix Plan

### Phase A — Make the real error visible

1. **`DrizzleErrorLogger.log()` mirrors to console for every payload.** Use
   `console.error` for `error`/`fatal` and `console.warn` for lower levels.
   Include `page`, `metadata`, and `stack`. Runs before the DB write so a
   logger DB failure can't hide the underlying error.

2. **tRPC middleware propagates `cause`.** In `apps/web/src/server/trpc.ts`,
   the `errorLogging` middleware extracts `result.error.cause` (and nested
   Error chains) into `metadata.cause` (stringified, with stack).

3. **Routers pass `cause` into `TRPCError`.** Update `flow.ts` and any other
   router that re-throws a `Result` error to pass `cause: result.error.cause`.
   This is a mechanical change at call sites.

4. **Repository catch blocks log via `console.error`.** Each
   `drizzle-*-repository.ts` catch block logs `[<RepoName>.<method>] <msg>:`
   with the cause before returning the `DomainError`. This is the last line
   of defence if any of the above is bypassed.

5. **Instrumentation migration failure is loud.** `instrumentation.ts`
   continues to console.error on migration failure (it can't reach the
   container at this point), but the message is unmistakable.

### Phase B — Fix the migration root cause

6. **Remove `runMigrations()` from `instrumentation.ts`.** Replace with a
   pre-start migration step in `apps/web/package.json`:

   ```json
   "dev": "pnpm --filter @rbrasier/adapters db:migrate && next dev -p 3000",
   "start": "pnpm --filter @rbrasier/adapters db:migrate && next start -p 3000"
   ```

   `drizzle-kit migrate` resolves the SQL folder from the workspace, not from
   webpack chunks, so it actually works. The Node.js-only check and the
   `DATABASE_URL` guard are no longer needed in instrumentation.

## Version

PATCH bump: 1.7.2 → 1.7.3 (no schema or API change).

## Implementation Summary

### Phase A — visibility

- `packages/adapters/src/errors/drizzle-error-logger.ts`: every `log()`
  call now mirrors to `console.warn` (level=warn) or `console.error` (any
  other level) before attempting persistence. The mirror includes page,
  message, metadata, and stack. This addresses the user-reported "errors
  buried in the DB" complaint — every persisted error also reaches stderr.
- `apps/web/src/server/error-metadata.ts`: new `causeToMetadata()` helper.
  Walks `Error.cause` chains (depth 4), extracts `name`, `message`,
  `stack`, Postgres `code`/`detail`, and recursively nested causes.
- `apps/web/src/server/trpc.ts`: `errorLogging` middleware now passes
  `causeToMetadata(result.error.cause)` into `metadata.cause`.
- `apps/web/src/server/trpc-errors.ts`: new `toTrpcError(domainError)`
  helper. Maps `DomainErrorCode` → tRPC status, and crucially passes
  `cause` through to `TRPCError`.
- All routers (`flow`, `user`, `settings`, `feature-flag`, `usage`,
  `message`, `session`, `error`) replaced
  `throw new TRPCError({ ..., message: result.error.message })` with
  `throw toTrpcError(result.error)` so cause is preserved.
- `packages/adapters/src/repositories/log-repo-error.ts`: new helper.
- `packages/adapters/src/repositories/drizzle-flow-repository.ts`: every
  catch block now calls `logRepoError(<location>, cause)` before
  returning the wrapped `DomainError` — defense in depth for non-tRPC
  code paths.

### Phase B — migration path

- `apps/web/src/instrumentation.ts`: removed `runMigrations()` block.
  Reverted to the original production-only uncaughtException /
  unhandledRejection handlers.
- `scripts/migrate-if-configured.sh`: new wrapper that runs
  `pnpm --filter @rbrasier/adapters db:migrate` only when `DATABASE_URL`
  is set, so `pnpm dev` still works in environments without a configured
  DB.
- `apps/web/package.json`: `dev` and `start` scripts now chain
  `migrate-if-configured.sh` before launching Next. Drizzle-kit reads SQL
  files from the workspace path directly, bypassing the
  `import.meta.url`/webpack bundling problem entirely.

### Regression tests

- `packages/adapters/src/errors/drizzle-error-logger.test.ts` (4 cases):
  console mirror fires for error/fatal/warn levels and survives
  persistence failure.
- `apps/web/src/server/error-metadata.test.ts` (6 cases): null/undefined,
  Error with message+stack, nested causes, non-Error values, and Postgres
  `code`/`detail` extraction.

### Why this should stop the recurrence

Before: a missing column produced "Failed to create flow." with no further
information. Each fix attempt was a guess.

After:
1. The Postgres error (e.g. `column "expert_role" does not exist`,
   sqlstate `42703`) reaches both `error_logs.metadata.cause` and stderr.
2. Migrations run via `drizzle-kit migrate` from the actual workspace, so
   `expert_role` actually gets created on `app_flows`.
3. If migrations DO fail in future, the failure is loud — the prestart
   script exits non-zero before Next even boots, so the app fails to
   start instead of silently serving a broken schema.
