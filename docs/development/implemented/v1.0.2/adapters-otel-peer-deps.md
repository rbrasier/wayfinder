# Bug: API crashes on startup in scaffolded projects — missing @opentelemetry/* packages

## Root Cause

`packages/adapters/tsup.config.ts` marks all `@opentelemetry/*` packages as
`external`, so they are not bundled into `dist/`. They must therefore be present
in `node_modules` at runtime.

`packages/adapters/package.json` declares these same packages as
`peerDependencies` (most marked `optional: true` in `peerDependenciesMeta`).
Under peer-dep semantics the consuming package — `apps/api` — is responsible for
installing them. `apps/api/package.json` declares none of them.

In the template **workspace** this is hidden: pnpm hoists the packages from
`packages/adapters/devDependencies`, making them available to every workspace
project. In a **scaffolded project** consuming the published `@rbrasier/adapters`
npm package, `devDependencies` are not installed, the packages are absent, and the
API crashes immediately with `ERR_MODULE_NOT_FOUND`.

The `@opentelemetry/*` packages are internal implementation details of adapters
(telemetry initialisation, instrumentation, exporters). The consuming app never
imports them directly. They should be `dependencies` of adapters, not
`peerDependencies`, so pnpm installs them automatically when `@rbrasier/adapters`
is added to a project.

## Reproduction

```bash
./init-project-test.sh --keep
cd /tmp/create-ai-app-template-XXXXXX/project
./restart.sh
# API process exits:
# Error [ERR_MODULE_NOT_FOUND]: Cannot find package '@opentelemetry/exporter-trace-otlp-http'
```

## Fix Plan

In `packages/adapters/package.json`:
1. Remove all `@opentelemetry/*` entries from `peerDependencies` and
   `peerDependenciesMeta`.
2. Add all `@opentelemetry/*` entries to `dependencies` using the version ranges
   from `devDependencies`.
3. Remove the duplicated `@opentelemetry/*` entries from `devDependencies`
   (they will now be installed via `dependencies`).

`tsup.config.ts` and `apps/api/package.json` require no changes.

## Version Bump

PATCH: `1.0.1 → 1.0.2`

## Implementation Summary

**Root cause**: `@opentelemetry/*` packages were `external` in tsup (not bundled)
and declared as `peerDependencies` in adapters. The consuming `apps/api` never
listed them, so they went uninstalled in scaffolded projects. In the workspace
they were silently provided by `devDependencies` hoisting.

**Fix applied** (`packages/adapters/package.json`): moved all nine `@opentelemetry/*`
packages from `peerDependencies`/`peerDependenciesMeta` into `dependencies` using
the same version ranges that were in `devDependencies`. Removed the duplicate
`@opentelemetry/*` entries from `devDependencies`.

**Regression test added** (`validate.sh` section 17): asserts no `@opentelemetry/*`
package appears in `peerDependencies` of adapters.
