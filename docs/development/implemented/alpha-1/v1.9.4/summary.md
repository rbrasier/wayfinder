# v1.9.4 Implementation Summary

## What was built

Fixed DB connection pool exhaustion (`53300: too many clients already`) caused
by Next.js HMR resetting the module-level `let cached` variable in
`apps/web/src/lib/container.ts` on every hot reload, creating a new
10-connection Postgres pool without closing the previous one.

## Files modified

- `apps/web/src/lib/container.ts` — replaced `let cached` with a
  `globalThis`-backed property (`_wayfinder_container`). `globalThis` survives
  HMR reloads; production behaviour is unchanged.

## Files created

- `apps/web/src/lib/__tests__/container.test.ts` — 2 tests verifying that
  `getContainer()` returns the cached `globalThis` value on every call without
  rebuilding.

## Migrations

None.

## Known limitations

The `globalThis` approach does not apply to Next.js Edge Runtime or serverless
functions with isolated VM contexts, but `container.ts` is only used in the
Node.js server runtime where `globalThis` is shared.

## Version bump

PATCH: 1.9.3 → 1.9.4
