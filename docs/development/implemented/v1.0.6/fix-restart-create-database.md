# Bug Fix: restart.sh Does Not Create Database Before Running Migrations

## Root Cause

`restart.sh` runs migrations immediately after sourcing `.env`, but never creates
the PostgreSQL database. If the database does not yet exist (first run, or any
run against a fresh PostgreSQL install), Drizzle throws:

```
PostgresError: database "<name>" does not exist
    ... (wrapped as DrizzleQueryError on the first migration statement)
```

The database name defaults to the project name set during scaffold (e.g. "project"
when the test target dir is `/tmp/.../project`).

## Reproduction Steps

1. Have a running PostgreSQL instance with no pre-existing database for the project.
2. Run `./init-project-test.sh` and complete the scaffold prompts.
3. Run `./restart.sh` from the scaffolded project.
4. Observe `DrizzleQueryError: database "<name>" does not exist`.

## Fix Plan

1. Add a validate.sh check (#21) that asserts `createdb` appears in `restart.sh`.
2. After sourcing `.env` and before the migration fork, parse `DATABASE_URL` with
   node to extract `DB_NAME`, `DB_HOST`, and `DB_PORT`.
3. Attempt `createdb -h … -p … "$DB_NAME"` (suppressing "already exists" stderr).
   Fall back to `psql … -c "CREATE DATABASE …"` if `createdb` is not on PATH.
   Both failures are silenced — if the db already exists this is a no-op.

## Implementation Summary

- Added validate.sh check #21: asserts `createdb` appears in `restart.sh`.
- After `source .env`, three node one-liners parse `DB_NAME`, `DB_HOST`, and
  `DB_PORT` from `DATABASE_URL` using the same regex pattern already used
  elsewhere in the script.
- `createdb -h … -p … "$DB_NAME"` is attempted first (standard pg CLI tool,
  widely available). On failure, `psql … CREATE DATABASE` is tried as a fallback.
  Both commands suppress all output (stderr via `2>/dev/null`, stdout via
  `>/dev/null 2>&1`). A final `|| true` ensures an "already exists" error from
  either tool does not abort the script.
- Runs unconditionally before the template/scaffolded migration fork, so both
  modes benefit.

## Version Bump

PATCH: `1.0.5` → `1.0.6`
