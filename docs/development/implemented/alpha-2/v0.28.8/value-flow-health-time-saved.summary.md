# Summary — Value & Flow Health dashboards, with operator-captured time saved

- **Version**: 0.28.8
- **Branch**: `enhance/value-flow-health-time-saved` → `release/alpha-2`
- **Phase doc**: `value-flow-health-time-saved.phase.md` (same folder)

## What shipped

Wayfinder can now say, in hours, roughly how much manual effort it has avoided —
and the number comes from the people who actually run the work rather than from
an author's guess or a hard-coded multiplier.

When a guided session reaches a terminal state, its owner is asked once, and
skippably, how long the case would have taken the old way. The answer is stored
per session; a flow's baseline is the **median** of its answers. **Value**
(at the existing `/admin/dashboards/overview` route) reports effort avoided in
hours with coverage stated on its face, and shows AI cost in `$` beside it —
never converted into the hours, never netted against them. **Flow Health**
(at `/admin/dashboards/flows`) replaces the old usage page and reads on where
sessions leave a flow, separating *abandoned* from *stalled*.

## Aggregation defects fixed

Three numbers that were previously wrong:

1. **Drop-off vs completion contradiction.** `dropOff` counted only `abandoned`
   sessions while `completionRate` penalised every non-complete session on the
   node, so both were on screen disagreeing. They are now one funnel whose
   segments reconcile to the entry count by construction — asserted by test.
2. **Step duration was a mean over a biased subset.** It measured
   `max − min` message time (wall-clock, including lunch) and excluded
   single-message sessions from *both* numerator and denominator. It is now a
   median over sessionised time, with single-message steps included.
3. **Cohort-mixing completion rate.** The old Overview divided completions in a
   window by starts in the same window — different cohorts. That dashboard is
   replaced; per-flow completion is now computed within one set of sessions.

## Deviations from the approved summary

Three, all deliberate:

- **No per-step spend column.** The mockup and the first draft of the phase doc
  promised one. It is not implementable: `ai_usage_events` carries `flow_id` and
  `session_id` but no `step_node_id` or `message_id`, so cost cannot be
  attributed to the step that incurred it. Spend is reported per flow instead.
  Splitting a session's cost evenly across its steps would have been a fabricated
  number, so the column was cut rather than faked. Recorded in the phase doc §7.
- **`computeNodeBreakdown` and `NodeBreakdownRow` removed.** The step funnel
  supersedes them and nothing else consumed them, so leaving them would have been
  dead code.
- **PATCH carrying a schema change**, against the CLAUDE.md MINOR rule. `0.29.0`
  through `0.31.0` are already consumed on `main`/alpha-3, so a MINOR on this line
  would collide with a released version. Chosen explicitly; precedent exists at
  `0.28.6`, which shipped a feature as a PATCH. See phase doc §11.

## Tests

Written before each implementation file, per the CLAUDE.md rule.

| Layer | File | Covers |
|---|---|---|
| domain | `entities/effort.test.ts` (26) | idle-capped sessionisation, median baseline, abandoned counted, clamp at zero, no-baseline exclusion, coverage, funnel reconciliation, median vs mean |
| application | `use-cases/session/record-manual-estimate.test.ts` (13) | terminal-status gate, ownership, range validation, overwrite |
| application | `use-cases/analytics/analytics.test.ts` | value dashboard all-flows and flow-scoped, hours/`$` kept separate, no-baseline flow |
| web | `components/chat/manual-estimate-state.test.ts` (27) | prompt conditions, preset scale, days+hours ⇄ minutes round-trip, submit gating |

**No Playwright e2e**, and none was added. The behaviour falls into none of the
six groups in `docs/guides/e2e-test-policy.md` — it is not auth lifecycle,
DOM streaming, upload/download, navigation across a page load, accessibility, or
smoke. Coverage sits at the layers that own the logic. No existing spec asserted
the renamed labels, so none needed updating.

`./validate.sh`: **24 passed, 0 failed.**

## Migration

`0044_hesitant_monster_badoon.sql` —
`ALTER TABLE "app_sessions" ADD COLUMN "manual_estimate_minutes" integer;`

Nullable, no default, no constraint. Additive and non-destructive: existing rows
carry across with `NULL`. Not in the flagged set in
`docs/guides/database-conventions.md`, so it needs no `-- data-impact:`
declaration — confirmed by `migration-safety.test.ts`. No backfill: sessions that
finished before this shipped have no estimate and are excluded from coverage,
which is the honest treatment rather than inventing history.

## Known limitations

- **Estimates are self-reported** and inherently subjective. This is why the
  figure is labelled an estimate everywhere it appears and is never presented as
  measured.
- **Small samples move the median.** A flow with three estimates can swing on a
  fourth; sample size and coverage are shown so the number is not read as more
  precise than it is.
- **The idle cap (10 min) and first-touch charge (2 min) are judgement calls.**
  Named constants with comments, changeable without touching call sites, but not
  yet operator-configurable.
- **Nothing is visually verified in a running browser.** The React pages were
  built to the approved mockups and are covered by logic tests and typecheck;
  the e2e suite runs in CI on this PR, not locally.
