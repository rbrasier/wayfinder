# Bug Fix: Pack Filename Version Mismatch in Local Test Mode

## Root Cause

`packages/create/src/index.ts` reads `frameworkVersion` from
`packages/adapters/package.json` only (line 251), then uses that single version
to construct tarball filenames for **all** four framework packages when
`PACKS_DIR` is set:

```typescript
`file:${packsDir}/${scopeSlug}-${pkg}-${frameworkVersion}.tgz`
```

`pnpm pack` names each tarball from the individual package's own `version` field.
When packages have different versions (e.g. `adapters@1.0.1`, `application@1.0.0`),
the constructed filename `rbrasier-application-1.0.1.tgz` does not exist — only
`rbrasier-application-1.0.0.tgz` does — causing `pnpm install` to fail with ENOENT.

## Reproduction Steps

1. Ensure package versions are not all identical (e.g. `adapters@1.0.1`,
   `application@1.0.0`).
2. Run `./init-project-test.sh`.
3. Observe `ENOENT: no such file or directory` for one of the
   `rbrasier-<pkg>-<adapters-version>.tgz` files.

## Fix Plan

1. Extract a `buildPackFilename` pure helper to `helpers.ts` that takes
   `(packsDir, scopeSlug, pkg, pkgVersion)` and returns the `file:` path.
2. Write a test that asserts per-package versions are reflected in the filename.
3. In `scaffold()`, move `packsDir` detection before `rmSync` of `packages/`.
4. Before removing `packages/`, read each package's own version from its
   `package.json` into a `packageVersions` map.
5. Pass `packageVersions[pkg]` (not `frameworkVersion`) to `buildPackFilename`
   when building `file:` references.

## Implementation Summary

- Added `buildPackFilename(packsDir, scopeSlug, pkg, pkgVersion)` to
  `packages/create/src/helpers.ts` — a pure function easily testable in isolation.
- Added three regression tests in `helpers.test.ts` covering correct filename
  construction and version isolation between packages.
- In `scaffold()`, moved `PACKS_DIR` detection before `rmSync` of `packages/`.
  Before removal, each package's version is read into a `Map<string, string>`.
- The loop that builds dependency version ranges now calls `buildPackFilename`
  with `packageVersions.get(pkg)` instead of the shared `frameworkVersion`.
- The `^${frameworkVersion}` path (npm mode) is unchanged.

## Version Bump

PATCH: `1.0.3` → `1.0.4`
