# Bug fix — Patch Next.js RCE and instrumentation-pg advisories on alpha-2

**Severity:** blocker (two critical unauthenticated RCEs in the shipped Next.js)
**Base branch:** `release/alpha-2`
**Source issue:** none (Dependabot security PRs #322 and #323, opened against `main`)

## Change summary (approved)

Moves `release/alpha-2` off two vulnerable dependencies in one change. Next.js goes
from 15.5.27 to 15.5.28, the 15.x backport of the fixes Dependabot only offered as a
jump to Next 16 (#323). `@opentelemetry/instrumentation-pg` goes from 0.70.0 to 0.73.0
to close GHSA-qqmp-wf37-98f9 (#322). The lockfile is rebuilt with
`pnpm install --lockfile-only`, so only these two packages and their own dependencies
move.

### Goal

- alpha-2 stops shipping a Next.js with unauthenticated remote code execution
  (`use cache` returning typed arrays; Image Optimization with SVGs) and a Server
  Actions denial of service.
- Postgres trace spans stop exposing the database user name.

### UI / visible behaviour

- No app change. Postgres spans now carry only OpenTelemetry's stable database and
  network attribute names (0.73.0 breaking change).

### Out of scope

- Next 16 (work for `main`); closing #322/#323, which Dependabot does itself once the
  forward-merge reaches `main`.

## Root cause

- **Next.js.** `release/alpha-2` resolved `next@15.5.27`. Next published 16.4.1 for
  GHSA-673q-mjm6-r5xr and GHSA-2464-fhr4-w9xw (critical RCE) and GHSA-p3m5-59mp-jv5r
  (high DoS), and 15.5.28 the same day with the same backported commits ("Improve
  Server Component transport protocol", the `sharp` bump). Dependabot proposed only
  the major. The version was held by the root `pnpm.overrides` entry
  `"next": ">=15.5.27 <16"` (added in v0.28.31), which takes precedence over
  `apps/web`'s own range, so the override floor has to move as well as the app range.
- **instrumentation-pg.** `packages/adapters` depended on `^0.70.0`;
  GHSA-qqmp-wf37-98f9 (moderate) affects `<0.73.0`.

## Reproduction

`pnpm audit --json` on `release/alpha-2` lists GHSA-qqmp-wf37-98f9 against
`@opentelemetry/instrumentation-pg`. `pnpm-lock.yaml` pins `next@15.5.27`, which
predates the 15.5.28 security backport.

## Fix plan

1. Raise the `next` floor to 15.5.28 in the root override and in `apps/web`.
2. Raise `@opentelemetry/instrumentation-pg` to `^0.73.0` in `packages/adapters`.
3. Rebuild the lockfile with `pnpm install --lockfile-only` and check that nothing
   else moved.
4. PATCH bump.
