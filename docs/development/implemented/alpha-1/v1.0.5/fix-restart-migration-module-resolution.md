# Bug Fix: restart.sh Migration Fails with ERR_MODULE_NOT_FOUND in Scaffolded Projects

## Root Cause

In `restart.sh` (scaffolded-project branch, line ~99), the migration is run as:

```bash
node --input-type=module -e "
  import { runMigrations } from '${ADAPTERS_PKG}/db';
  await runMigrations(process.env.DATABASE_URL ?? '');
"
```

`node` is invoked from the project root. In a scaffolded project `@rbrasier/adapters`
is a dependency of `apps/api`, so pnpm installs it under `apps/api/node_modules`.
Node's module resolution walks upward from the CWD; it never finds the package in
`apps/api/node_modules` when started from the root, producing:

```
Error [ERR_MODULE_NOT_FOUND]: Cannot find package '@rbrasier/adapters'
    imported from /tmp/<project>/[eval1]
```

The catch block then prints the misleading "migration failed — check DATABASE_URL
in .env" message, which does not describe the actual problem.

## Reproduction Steps

1. Run `./init-project-test.sh` and complete the scaffold (or scaffold manually).
2. From the scaffolded project root run `./restart.sh`.
3. Observe `ERR_MODULE_NOT_FOUND` for `@rbrasier/adapters` followed by the
   misleading "check DATABASE_URL" message.

## Fix Plan

1. Add a validate.sh check (#20) that asserts `restart.sh` contains a `cd` into
   `apps/api` before the scaffolded-mode `node` migration command.
2. Wrap the `node` invocation in `(cd "$ROOT/apps/api" && node ...)` so module
   resolution starts from the directory that has `@rbrasier/adapters` as a
   direct dependency.
3. Improve the catch-all error message to mention both DATABASE_URL and package
   resolution as possible causes.

## Implementation Summary

- Added validate.sh check #20: asserts `cd.*apps/api` appears in `restart.sh`
  to prevent regressions.
- Wrapped the scaffolded-mode `node --input-type=module` invocation in a subshell
  `(cd "$ROOT/apps/api" && node ...)`. The subshell inherits the exported
  environment (including `DATABASE_URL` from the earlier `set -a; source .env`),
  while starting node in the directory that declares `@rbrasier/adapters` as a
  direct dependency so module resolution succeeds.
- Improved the catch-all error message from "check DATABASE_URL in .env" to
  "check DATABASE_URL in .env and that pnpm install completed" to cover both
  failure modes.
- Verified the API key flow in `index.ts` (lines 330–333): `aiProviderKey` is
  added to `envReplacements` when non-empty and applied via `patchEnvContent`
  which correctly replaces the empty-value placeholder lines in `.env.example`.
  No change needed there.

## Version Bump

PATCH: `1.0.4` → `1.0.5`
