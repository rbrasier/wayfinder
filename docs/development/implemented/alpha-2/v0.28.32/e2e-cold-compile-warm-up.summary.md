# Implementation Summary — warm `next dev` routes before the e2e suite

- **Version**: 0.28.32 (bump: **PATCH** — CI and e2e support files only; no schema
  change, no migration)
- **Base branch**: `release/alpha-2`
- **Type**: `/bugfix` (severity: minor)
- **Bug-fix doc**: [`e2e-cold-compile-warm-up.bugfix.md`](./e2e-cold-compile-warm-up.bugfix.md)
- **Source issue**: none (found while driving PR #320)

## Root cause

CI serves the app with `next dev`, which compiles each route on its first request. The
spec that reaches a route first pays that compile inside a wait sized for a warm
server. `/flows/[id]/config` took 61.4s and failed `enhance-template-annotation` on
both attempts on `release/alpha-2`. `/api/branding/logo` took 4.6s against
`branding.spec.ts`'s 5s toast wait.

## Fix applied

- `apps/web/e2e/warm-routes.txt` lists the routes seen paying a compile, each with the
  evidence behind it.
- `apps/web/e2e/warm-routes.sh` mints an admin test session and requests each route
  once. It fails on a redirect, which means nothing compiled.
- `.github/workflows/e2e.yml`: the main job's "Wait for app to be ready" step runs the
  script after `wait-on`. The PKI job is unchanged.
- `apps/web/e2e/helpers/timeouts.ts`: the header now says which routes CI pre-compiles
  and why `NAV_TIMEOUT` remains.

## Regression test

`apps/web/src/e2e-warm-routes.test.ts` checks that every listed route resolves to a
`page.tsx` or a `route.ts` exporting that method (route groups and dynamic segments
resolved), that the flow canvas is listed, and that the workflow runs the script before
Playwright. Verified failing before the list existed, and failing on a deliberately
stale entry.

## E2E test

None added. This is CI orchestration, not one of the six policy groups. The next PR run
is the proof: no `Compiling` line for a warmed route should appear during the
Playwright step.

## Reported, not fixed

`chat.spec.ts` multi-turn and `code-quality-hot-paths` chats list. In both, the client
stalled with no slow server request involved, so neither is a compile wait. Details are
in the bug-fix doc.
