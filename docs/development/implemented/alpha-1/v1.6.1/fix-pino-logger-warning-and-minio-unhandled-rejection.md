# Bug Fix: pino-logger webpack warning and MinIO unhandledRejection

## Root Cause Diagnosis

### Issue 1 — pino-logger webpack warning

`@rbrasier/adapters` is listed in `transpilePackages` in `next.config.ts`, which means
webpack bundles every source file in the package, including `pino-logger.ts`. That file
uses `createRequire(path.join(process.cwd(), "index.js"))` to require `pino-pretty` at
runtime. Webpack's `NodeStuffPlugin` tries to statically evaluate the argument to
`createRequire` during bundling and fails because `process.cwd()` is not a compile-time
constant. This emits the `module.createRequire failed parsing argument` warning with a
full import trace on every route compilation in dev mode.

The code is correct and works at runtime — webpack is emitting a false-positive warning.

### Issue 2 — MinIO unhandledRejection

`container.ts` calls `void objectStorage.initialise()` during container construction.
`initialise()` calls `this.client.bucketExists()` which makes a network request to MinIO.
If MinIO is unreachable the promise rejects, but `void` discards the promise reference,
so the rejection is never caught. Node.js (and Next.js in dev mode) treats this as an
`unhandledRejection` and logs it to the console as `⨯ unhandledRejection`.

## Reproduction Steps

1. Start the dev server with `pnpm dev` while MinIO is unavailable.
2. Navigate to any page — the pino warning and ECONNREFUSED messages appear in the
   web dev output on each route compilation.

## Fix Plan

### Fix 1 — Suppress the webpack warning in `next.config.ts`

Add an entry to `config.ignoreWarnings` inside the existing webpack callback that
matches the `pino-logger` module path and the `createRequire` message. This is the
correct mechanism for suppressing false-positive webpack warnings without altering
runtime behaviour.

### Fix 2 — Catch the MinIO initialise rejection in `container.ts`

Replace `void objectStorage.initialise()` with
`objectStorage.initialise().catch(...)` that logs a `warn`-level message. This
converts the silent unhandled rejection into an observable but non-fatal log entry.

## Version Bump

PATCH: `1.6.0` → `1.6.1`

## Implementation Summary

**Fix 1 (webpack warning):** Added `ignoreWarnings` entry to the webpack callback in
`apps/web/next.config.ts` targeting the `pino-logger` module with a `/createRequire/`
message pattern. No runtime behaviour changed.

**Fix 2 (unhandledRejection):** Replaced `void objectStorage.initialise()` with
`objectStorage.initialise().catch(...)` in `apps/web/src/lib/container.ts`. The catch
handler calls `logger.warn` so the failure is observable without crashing the process.

**Regression test added:** `packages/adapters/src/storage/minio-storage.test.ts` —
new case `"propagates the error when the MinIO server is unreachable"` verifies that
`initialise()` throws an `AggregateError` with `code: "ECONNREFUSED"` when
`bucketExists` rejects, confirming the failure path is correctly surfaced to the caller.
