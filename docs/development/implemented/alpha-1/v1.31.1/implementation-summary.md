# v1.31.1 — Fix: new scheduled step opened as recurrence; e2e suite corrections

PATCH release. No schema change.

## Root cause

`apps/web/src/components/canvas/scheduled-node-config.ts` →
`scheduledValuesFromConfig`. A brand-new node has an empty persisted config, so
`config.kind` is `undefined`. The fallback that maps legacy `cron` rows to the
recurrence builder (`… ? storedKind : "recurrence"`) also caught the `undefined`
case, so every new scheduled step opened on **"Repeat on a schedule"** instead
of the intended default **"Run after a delay"** (`DEFAULT_VALUES.scheduleKind`
is `"relative"`).

## Fix applied

Default an absent stored kind to `relative`; only map to `recurrence` when there
is an existing non-plain-language kind (legacy `cron`, or an already-stored
`recurrence`):

```ts
const kind: ScheduleKind =
  storedKind === "relative" || storedKind === "at"
    ? storedKind
    : storedKind
      ? "recurrence"
      : "relative";
```

## Regression test added

`apps/web/src/components/canvas/scheduled-node-config.test.ts` (vitest):

- empty config → `relative` (the failing case, now green)
- `relative` / `at` preserved; stored `recurrence` and legacy `cron` → `recurrence`
- relative spec reads back from stored config
- `scheduledConfigFromValues` → `scheduledValuesFromConfig` round-trips relative

## E2E coverage

The existing `tests/e2e/phase-scheduling.spec.ts` tests now pass:

- *a scheduled step can be configured once the flag is on* — fills the relative
  `Run after` field (`#schedule-spec`) and the node appears as
  `Wait 30 days` / `relative: 30d`.
- *Save is disabled while a scheduled step has no spec* — relative requires a
  duration, so Save stays disabled.

## Test-suite corrections shipped alongside (stale/racy, not app bugs)

Surfaced by a full live e2e reproduction; the app behaviour was already correct.

- `tests/e2e/admin-flow-editing.spec.ts` — "Publish" is no longer a toolbar
  button; it lives in **⋯ Flow actions → Update published state → Publish
  globally**. Added a `publishGlobally()` helper and used it in both tests. Also
  raised the first canvas navigation `waitForURL` from 10s → 30s to absorb
  dev-mode on-demand route compilation.
- `tests/e2e/admin-dashboards.spec.ts` — the flow-insights dashboard is
  client-fetched (`Loading…` → empty state or heading). Added
  `waitForFlowInsightsSettled()` so the empty-state skip guard is evaluated only
  after the query resolves, removing the race that made the tests fail instead
  of skip.
- `tests/e2e/phase-scheduling.spec.ts` — the canvas node shows its name and a
  schedule subtitle, not the literal word "Scheduled"; the final assertion now
  checks for `Wait 30 days` and `relative: 30d`.

## Verification

- `./validate.sh` — all 16 checks pass (typecheck, lint, unit tests + coverage,
  version match `1.31.1`).
- Live e2e run (Postgres + dev server + Chromium): the 6 previously-failing
  tests across the three specs all pass.
