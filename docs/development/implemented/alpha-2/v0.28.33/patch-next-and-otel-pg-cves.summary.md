# Implementation Summary — patch Next.js and instrumentation-pg advisories

- **Version**: 0.28.33 (bump: **PATCH**: dependency versions only; no schema change,
  no migration)
- **Base branch**: `release/alpha-2`
- **Type**: `/bugfix` (severity: blocker)
- **Bug-fix doc**: [`patch-next-and-otel-pg-cves.bugfix.md`](./patch-next-and-otel-pg-cves.bugfix.md)
- **Source issue**: none (Dependabot #322 and #323 on `main`)

## Root cause

alpha-2 resolved `next@15.5.27`, which predates Next's 15.5.28 backport of the
critical RCE fixes (GHSA-673q-mjm6-r5xr, GHSA-2464-fhr4-w9xw) and the high DoS fix
(GHSA-p3m5-59mp-jv5r), and `@opentelemetry/instrumentation-pg@0.70.0`, affected by
GHSA-qqmp-wf37-98f9. The root `pnpm.overrides` entry `"next": ">=15.5.27 <16"` held
Next at 15.5.27 regardless of the app's range.

## Fix applied

- `package.json`: override `next` → `>=15.5.28 <16`.
- `apps/web/package.json`: `next` → `^15.5.28`.
- `packages/adapters/package.json`: `@opentelemetry/instrumentation-pg` → `^0.73.0`.
- `pnpm-lock.yaml`: rebuilt with `pnpm install --lockfile-only`. Only `next`, its
  `@next/*` binaries, and `instrumentation-pg` with its own dependencies
  (`instrumentation`, `api-logs`, `sql-common`) moved.

## Regression test

None added: a dependency version is not logic a unit test can own. The guards are
CI's existing lockfile gates (`pnpm audit`, OSV-Scanner) and the Trivy image scan.
`pnpm audit` no longer reports GHSA-qqmp-wf37-98f9, and `scripts/audit-check.sh`
passes. Locally: typecheck, lint, the full unit suite and `next build` pass.

## E2E test

None added. A dependency patch falls under none of the six policy groups. The
existing suite runs on the PR against Next 15.5.28.

## Known limitations

- The Next advisory IDs could not be checked against 15.5.28 directly from the build
  sandbox (the advisory APIs are blocked there). The match rests on 15.5.28 carrying
  the same backported commits as 16.4.1.
- Postgres spans now carry only stable semantic-convention attribute names.
  Nothing in the code reads them, but Langfuse filters on the old names need
  updating.
