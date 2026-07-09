# Phase: globalThis Container Singleton

**Version bump:** 1.9.3 → 1.9.4 (PATCH)

## Problem

In Next.js development mode, Hot Module Replacement (HMR) re-evaluates module
files on every save. The module-level `let cached` variable in
`apps/web/src/lib/container.ts` is reset to `null` on each reload, causing
`build()` to run again and create a new Postgres connection pool (max: 10
connections) without closing the previous one.

Over a typical dev session this exhausts Postgres's connection limit, producing:

```
PostgresError: sorry, too many clients already (code 53300)
```

## Solution

Store the container on `globalThis` instead of a module-level variable.
`globalThis` is not re-evaluated by HMR, so the same pool instance is reused
across all hot reloads. In production there is no HMR, so the behaviour is
identical to before.

## Scope

- **File changed:** `apps/web/src/lib/container.ts` — replace module-level
  `let cached` with a typed `globalThis` property.
- **No DB schema changes.**
- **No domain entity or use case changes.**
- **No API or UI changes.**

## Implementation

Replace:

```typescript
let cached: ReturnType<typeof build> | null = null;

export const getContainer = () => {
  if (cached) return cached;
  cached = build();
  return cached;
};
```

With:

```typescript
const globalForContainer = globalThis as typeof globalThis & {
  _wayfinder_container: ReturnType<typeof build> | undefined;
};

export const getContainer = () => {
  if (globalForContainer._wayfinder_container) {
    return globalForContainer._wayfinder_container;
  }
  globalForContainer._wayfinder_container = build();
  return globalForContainer._wayfinder_container;
};
```

## Tests

Because this is purely a singleton-management change and the container
construction itself is already covered by the integration environment, the
test for this phase verifies the invariant directly:

- Calling `getContainer()` twice returns the same object reference.

The test lives in `apps/web/src/lib/__tests__/container.test.ts`.

## Acceptance Criteria

- `getContainer()` returns the same reference on repeated calls.
- No `too many clients` errors appear in dev after multiple HMR reloads.
- `./validate.sh` passes.
