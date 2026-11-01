# Bug fix — clear the launch-editor and vitest advisories in the Lambda deploy target

Source: maintainer request from the Dependabot alerts page (#71, #72, #73). No issue.
Severity: major — one high advisory, and `deploy/lambda`'s `npm run audit` CI step fails.

## Symptom

Dependabot flags `launch-editor` via vite in `deploy/lambda/package-lock.json`:
GHSA-587h-7wmj-h5pm (high), plus the `%`-escaping and editor-CLI-flag moderates. `npm audit`
there also reports three Vite advisories and two `@vitest/mocker` moderates.

`deploy/lambda` sits outside the pnpm workspace (ADR-056 §2) and exists only on `main`, so
the alpha-2 fixes (#344, #350) never reach it.

## Reproduction

```sh
cd deploy/lambda && npm ci --legacy-peer-deps && npm run audit   # exit 1 — vite 8.2.0 - 8.2.2 (high)
```

## Root cause

The lockfile held `vite@8.2.2` (pulled by `vitest`) and `vitest`/`@vitest/mocker@4.1.11`.
The advisories are patched in vite 8.2.4 and vitest/@vitest/mocker 4.1.12, both inside the
existing ranges, but nothing had refreshed the lockfile.

## Fix

- `deploy/lambda/package.json`: `vitest` `^4.1.0` → `^4.1.12`, so 4.1.11 (and its mocker)
  can no longer resolve.
- `npm update vite --legacy-peer-deps` (the flag CI's `npm ci` uses) moves vite to 8.3.5.

Lockfile movement is limited to vite/vitest and their own dependencies: vite 8.2.2 → 8.3.5,
rolldown 1.2.7 → 1.2.15 (+ platform bindings), `@oxc-project/types`, `@vitest/*` 4.1.11 →
4.1.12, chai, tinyrainbow, postcss 8.5.31, nanoid 3.3.20. All are dev dependencies — none
ship in the Lambda bundles.

## Regression guard

No application logic changed, so no unit test was added. The guard is the lambda job's
`npm run audit` step in CI (`npm audit --audit-level=high`): exit 1 before, `found 0
vulnerabilities` after. `npm run typecheck`, `npm run lint` and `npm test` (19 tests) pass on
the new versions.

**E2E:** none — dependency resolution falls in no group of `e2e-test-policy.md`.

## Added during the run

**Ported from alpha-2 (#344) so this PR's gates pass:** root override `vite` `^6` → `^6.4.4`
(resolves 6.4.5) and the e2e `follow-redirects` `^1.16.1` override. The lines are identical
to alpha-2's, so the next forward-merge applies them as no-ops.

**zod GHSA-mrhx-c7xc-m3w5 (high, published to OSV mid-run):** patched only in zod 4.6.6.

- `zod@4` override `>=4.6.6 <5` — the better-auth copy moves 4.4.3 → 4.6.7.
- zod 3.25.76 is the last 3.x and stays. Allowlisted in `scripts/audit-allowlist.sh` with the
  reason, by maintainer decision after a zod 4 migration was investigated and ruled out for
  now: `ai@4`, the `@ai-sdk/*` 1.x providers, `@langchain/core@0.3` and
  `@langchain/langgraph@0.2` hard-depend on zod 3, so migrating our code leaves it in the
  lockfile; and AI SDK 4's `zod-to-json-schema` turns a zod 4 schema into an empty JSON
  schema (verified), which would strip every `generateObject` call of its output schema.
  The way out is the AI SDK 5+ / LangChain 1.x / zod 4 migration.

**Deviation from the approved summary:** the vite, follow-redirects and zod changes above
were not in the original lambda-only scope; each was added because the gate failed without it.
