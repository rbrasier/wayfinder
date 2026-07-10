# Bug Fix: Database Creation Prompts for Password / Runs in Wrong Phase

## Root Cause

`restart.sh` creates the database using `createdb` / `psql` CLI tools without
passing the credentials from `DATABASE_URL`. These tools fall back to OS-level
authentication and may interactively prompt for a password, blocking unattended
runs.

Additionally, database creation is better placed in the scaffold phase
(`packages/create/src/index.ts`) where:
- All connection info is already in hand.
- `pnpm install` has just completed so the `postgres` npm package is available
  in `apps/api/node_modules`.
- No shell tool / OS auth is required — the npm package uses the URL credentials
  directly.

## Reproduction Steps

1. Run `./init-project-test.sh`, complete the prompts.
2. Run `./restart.sh` from the scaffolded project.
3. Observe a password prompt from `createdb` (or auth failure if running
   non-interactively).

## Fix Plan

1. In `index.ts`, after `pnpm install`, write a temporary `.mjs` script that
   imports `postgres` from the just-installed `apps/api/node_modules`, connects
   to the `postgres` admin database (replacing the db name in the URL), and runs
   `CREATE DATABASE`. Error code `42P04` (duplicate database) is silently ignored.
   The temp file is deleted whether or not the step succeeds.
2. In `restart.sh`, replace the `createdb` / `psql` block with an equivalent
   that passes `PGPASSWORD` extracted from `DATABASE_URL`, eliminating prompts
   for subsequent restarts where the DB may have been dropped.
3. Update validate.sh check #21 to assert `PGPASSWORD` appears in `restart.sh`.

## Implementation Summary

**`packages/create/src/index.ts`** — primary DB creation during scaffold:
- After `pnpm install`, writes a temp `__create_db__.mjs` file containing a
  self-contained postgres.js script. `JSON.stringify(databaseUrl)` safely embeds
  the connection string without any shell-escaping concerns.
- Executed via `node __create_db__.mjs` from `apps/api` so the postgres package
  installed there is on the resolution path.
- Connects to the `postgres` admin database (same host/user/pass, db name
  replaced) and runs `CREATE DATABASE`. Error `42P04` (duplicate) is silently
  swallowed. Any other error prints a yellow warning and continues — non-fatal.
- Temp file is cleaned up in a `finally` block regardless of outcome.

**`restart.sh`** — safety-net for subsequent runs / manually dropped databases:
- Added `DB_USER` and `DB_PASS` extraction from `DATABASE_URL` using the same
  node one-liner pattern already present for `DB_HOST`/`DB_PORT`.
- `PGPASSWORD="$DB_PASS"` is prefixed to both `createdb` and `psql` calls,
  providing the password non-interactively so no prompt appears.
- `|| true` still absorbs "database already exists" exit codes.

**`validate.sh`** — check #21 updated: now asserts `PGPASSWORD` appears in
`restart.sh` rather than `createdb`.

## Version Bump

PATCH: `1.0.6` → `1.0.7`
