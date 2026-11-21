# CI: Playwright e2e jobs fail on the Ubuntu 26.04 runner image

## Approved change summary

The e2e jobs fail on every PR because GitHub's `ubuntu-latest` runner moved to
Ubuntu 26.04, and the e2e suite is locked to Playwright 1.60.0, which can't install
Chromium there. The fix upgrades the e2e suite's Playwright to 1.64.1 on
`release/alpha-3`. A new `validate.sh` check fails if the e2e lockfile ever drops
below the first release that supports 26.04 (1.62). The next forward merge carries
the fix to `main` and PR #387.

### Goal
- Playwright e2e jobs (shards 1–3 and PKI) install Chromium and run on the Ubuntu 26.04 runner again.

### Business rules changing
- The e2e suite must resolve a Playwright version that supports the CI runner's OS.
  Today it resolves 1.60.0, which refuses Ubuntu 26.04. After the fix it resolves
  ≥ 1.62 (1.64.1).

### UI / visible behaviour
- None in the app. In CI, "Install Playwright browsers" goes green and the e2e
  results comment on PRs works again.

### Risks
- Four minor versions of Playwright change at once. Newer Chromium may expose
  timing differences in specs.
- Release goes 0.41.1 → 0.41.2 while `main` already used 0.41.2 for a forward merge.
- PR #387 stays red until this reaches `main`.

### Out of scope
- The one-off `next/font` Google Fonts failure in "Build container image".
- Pinning runners to `ubuntu-24.04`.

### Build details
- **Architecture:** complies with hexagonal architecture (ADR-001). Only CI and test tooling change.
- **Unit tests:** one failing regression test first: the e2e lockfile resolves `playwright-core` ≥ 1.62. It's wired into `validate.sh`.
- **E2E:** none. The regression test is the guard.
- **Version:** PATCH, 0.41.1 → 0.41.2, branch `claude/serene-albattani-y7qopw`, PR against `release/alpha-3`.

## Root cause (verified)

From the PR #387 run (`E2E Tests (Playwright)`, run 42389215215), every e2e job
failed at "Install Playwright browsers":

```
BEWARE: your OS is not officially supported by Playwright; installing dependencies for ubuntu26.04-x64 as a fallback.
Cannot install dependencies for ubuntu26.04-x64 with Playwright 1.60.0!
Error: ERROR: Playwright does not support chromium on ubuntu26.04-x64
```

- `apps/web/e2e/package-lock.json` resolves `@playwright/test`, `playwright` and
  `playwright-core` to 1.60.0.
- In 1.60.0's `playwright-core` there is no `ubuntu26.04` platform entry. 1.62.0
  and every later release checked (1.63, 1.64, 1.65) have `ubuntu26.04-x64` and
  `ubuntu26.04-arm64` browser builds and dependency lists.
- `release/alpha-3` resolves the same 1.60.0, so the fault is on the release line
  as well as `main`.

## Reproduction

1. Open any PR so that `.github/workflows/e2e.yml` runs on `ubuntu-latest` (now 26.04).
2. `npm install && npx playwright install --with-deps chromium` in `apps/web/e2e`
   exits 1 with the error above. Every later step is skipped.

## Fix plan

1. Regression test `scripts/e2e-playwright-platform.test.mjs`: read
   `apps/web/e2e/package-lock.json` and assert every `playwright-core` it
   resolves is ≥ 1.62.0. Fails today (1.60.0). Wire it into `validate.sh`.
2. Upgrade `@playwright/test` to 1.64.1 in `apps/web/e2e`. That's the newest
   release over two weeks old; 1.65.0 is three days old. Raise the
   `package.json` floor to `^1.64.1` and dedupe the lockfile.
3. Update the stale "Playwright (1.60)" note in `.claude/commands/e2e-cc-web.md`.

## Implementation summary

- **Root cause:** `ubuntu-latest` became Ubuntu 26.04; the e2e lockfile resolved
  Playwright 1.60.0, which has no ubuntu26.04-x64 browser build, so
  `playwright install --with-deps chromium` exited 1 in every e2e job.
- **Fix applied:** `@playwright/test` (and `playwright` / `playwright-core`) in
  `apps/web/e2e` upgraded to 1.64.1. The `package.json` floor is now `^1.64.1`,
  and the lockfile is deduped so one `playwright-core` resolves.
  `.claude/commands/e2e-cc-web.md` no longer says 1.60.
- **Regression test:** `scripts/e2e-playwright-platform.test.mjs` asserts every
  `playwright-core` in the e2e lockfile is ≥ 1.62.0. It failed on 1.60.0 and
  passes on 1.64.1. It runs in `validate.sh` as check 11f.
- **E2E test:** none. CI tooling sits outside the six e2e-policy groups, and the
  suite itself cannot start without this fix.
- **Version:** 0.41.1 → 0.41.2 (PATCH). `VERSION` and `package.json` match.
- **Deviations:** none from the approved summary.
