# Bug fix — new scheduled step opens as "Repeat on a schedule" instead of "Run after a delay"

## Symptom

Selecting the **Scheduled** step type for a *brand-new* node opens the
config modal with **"When should this run?" → "Repeat on a schedule"**
(recurrence) preselected, rather than the simpler **"Run after a delay"**
(relative). This is wrong UX and breaks two e2e tests in
`tests/e2e/phase-scheduling.spec.ts`:

- `a scheduled step can be configured once the flag is on` — fills
  `#schedule-spec`, which only renders for the *relative* kind, so the fill
  times out (15s).
- `Save is disabled while a scheduled step has no spec` — recurrence is
  always valid, so Save stays enabled and the assertion fails.

## Reproduction

1. Enable the `scheduled_node` feature flag on `/admin/flags`.
2. Open a flow's canvas, click **+ Add step**.
3. Choose the **Scheduled** step type.
4. Observe "When should this run?" defaults to **Repeat on a schedule**.
   Expected: **Run after a delay**, with an empty `Run after` (`#schedule-spec`)
   field and Save disabled until a duration is entered.

## Root cause (verified by live reproduction)

`apps/web/src/components/canvas/scheduled-node-config.ts`,
`scheduledValuesFromConfig`:

```ts
const storedKind = config.kind as string | undefined;
// Legacy `cron` rows have no plain-language equivalent — open them as a
// recurrence so the author re-expresses the schedule in the new builder.
const kind: ScheduleKind =
  storedKind === "relative" || storedKind === "at" ? storedKind : "recurrence";
```

For a new node the persisted config is empty, so `config.kind` is
`undefined`. The fallback was written to map legacy `cron` rows to
`recurrence`, but `undefined` is neither `relative` nor `at`, so it also
falls through to `recurrence`. Every new scheduled node therefore opens as a
recurrence.

`DEFAULT_VALUES.scheduleKind` in `node-config-modal.tsx` is `"relative"`, so
the intended default for a fresh node is relative — `scheduledValuesFromConfig`
overrides it.

## Fix plan

Only fall back to `recurrence` when there is an actual stored kind that has no
plain-language form (legacy `cron`, or an already-stored `recurrence`). When
`storedKind` is absent (new node, no schedule configured yet), default to
`relative`:

```ts
const kind: ScheduleKind =
  storedKind === "relative" || storedKind === "at"
    ? storedKind
    : storedKind
      ? "recurrence" // legacy cron / stored recurrence — no relative form
      : "relative";  // brand-new node, no schedule configured yet
```

## Tests

- Unit: `scheduled-node-config.test.ts` — empty config → `relative`; `cron`
  config → `recurrence`; `recurrence`/`relative`/`at` round-trip unchanged.
- E2e (existing, currently failing): the two `phase-scheduling.spec.ts` tests
  above pass once the default is `relative`.

## Related test-suite corrections (same change set)

The same e2e run surfaced stale/racy tests unrelated to the app bug; fixed
alongside so the suite reflects the current UI:

- `admin-flow-editing.spec.ts` — "Publish" is no longer a top-level button; it
  moved into the **⋯ Flow actions → Update published state → Publish globally**
  menu. The tests now publish via that menu, and tolerate the heavier
  first-compile navigation to the canvas route in dev mode.
- `admin-dashboards.spec.ts` — the flow-insights dashboard is client-fetched and
  shows `Loading…` first. The empty-state skip guard was checked before the
  query resolved; the tests now wait for the page to settle into either its
  empty state or its heading before deciding.
