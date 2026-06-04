# Implementation Summary — v1.31.0

**Scheduled-Step Plain-Language UX & Canvas Polish** (MINOR)

## What was built

The scheduled-step configuration was rewritten around plain language, and the
canvas was given clearer per-type affordances.

- **"When should this run?"** replaces the engineer-facing "Schedule kind":
  - *Run after a delay* (`relative`) — a duration plus a "Counting from"
    selector (when this step is reached / a date carried from an earlier step),
    which subsumes the old standalone **Anchor** dropdown.
  - *At a specific date & time* (`at`) — keeps the AI-decides / earlier-step /
    specific options; the *specific* case now uses a **calendar date picker +
    iOS-style scrolling-wheel time picker** instead of a raw ISO text box.
  - *Repeat on a schedule* (`recurrence`) — a structured builder ("Every N
    days/weeks/months", weekday toggles, day-of-month, a time wheel, optional
    "stop after") with a live plain-English summary.
- **Structured recurrence** (`RecurrenceRule`) is JSON-serialised into the
  existing `app_session_schedules.spec` column under a new `kind = "recurrence"`.
  Occurrences are computed forward, DST-correct, in the rule's IANA timezone
  (`Intl`, no new dependency); the interval is anchored to the original
  node-reached instant preserved in `payload.anchorAt`.
- Picked dates/times are interpreted in the **author's local timezone**.
- **Step-type colours** are now consistent everywhere — conversational = blue,
  automated (n8n) = purple, scheduled = green (was teal) — on the modal's type
  selector and the canvas node borders, with a small **type icon in each
  node's top-right corner**.
- Legacy `cron` schedules keep firing (the engine still supports `cron`); the
  modal simply no longer offers cron authoring and opens legacy `cron` nodes in
  the recurrence builder.
- Verified item 6 ("AI Decides / earlier-step metadata for fields") — already
  shipped in v1.30.0 via `FieldValueSelector`; reused unchanged for n8n request
  fields and the scheduled `at` timestamp.

## Files created

- `packages/domain/src/entities/recurrence-rule.ts` (+ test) — `RecurrenceRule`,
  `parse`/`serialize`/`describe`.
- `apps/web/src/components/ui/wheel-picker.tsx` — reusable snap-scroll column.
- `apps/web/src/components/ui/time-wheel.tsx` (+ test) — hour/minute/AM-PM wheels.
- `apps/web/src/components/ui/calendar-picker.tsx` (+ test) — month-grid date picker.
- `apps/web/src/components/canvas/node-styles.tsx` — per-type accent + corner badge.
- `apps/web/src/components/canvas/scheduled-config.ts` (+ test) — local/ISO and
  recurrence helpers.
- `apps/web/src/components/canvas/scheduled-node-config.ts` — modal ⇄ config mapping.
- `tests/e2e/enhance-scheduled-step-plain-language.spec.ts` — e2e.

## Files modified

- `packages/domain/src/entities/session-schedule.ts` — `ScheduleKind` gains `"recurrence"`.
- `packages/domain/src/entities/{index.ts,flow-node.ts}` — export rule; allow kind.
- `packages/application/src/use-cases/scheduling/compute-next-fire.ts` (+ test) —
  `computeNextRecurrence`; `computeNextFireAt` handles `recurrence` + optional `start`.
- `packages/application/src/use-cases/scheduling/fire-due-schedules.ts` (+ test) —
  recurs `recurrence` using `payload.anchorAt`.
- `packages/application/src/use-cases/scheduling/schedule-node-event.ts` — forces
  `recurring` for the recurrence kind.
- `packages/adapters/src/db/schema/wayfinder.ts` — widen `kind` text-enum.
- `apps/web/src/components/canvas/node-config-modal.tsx` — plain-language scheduling UI.
- `apps/web/src/components/canvas/field-value-selector.tsx` — optional `renderLiteral`.
- `apps/web/src/components/canvas/{conversational,auto,scheduled}-node.tsx` — colours + badge.
- `apps/web/src/app/(user)/flows/[id]/config/_content.tsx`,
  `apps/web/src/app/(admin)/admin/flows/[id]/_content.tsx` — use shared mapping.

## Migrations run

None. `app_session_schedules.kind` is a Drizzle-level text enum (no DB
constraint), so widening it to include `"recurrence"` requires no SQL migration
and no data backfill. Existing `relative`/`at`/`cron` rows are unaffected.

## Known limitations

- Monthly recurrence on day 29–31 simply skips months that lack that day (no
  "last day of month" clamping).
- No timezone *picker* — the author's browser timezone is used.
- Legacy `cron` nodes open in the recurrence builder rather than reconstructing
  the original cron expression (the engine still fires existing cron rows).

## Tests / e2e

- Unit (Vitest): recurrence math (daily/weekly/monthly, interval > 1, DST
  spring-forward, anchored recompute, max-occurrences), rule parse/serialize/
  describe, and the wheel/calendar/local-ISO date helpers.
- e2e: `tests/e2e/enhance-scheduled-step-plain-language.spec.ts` authors a
  *Repeat on a schedule* step (Every 2 weeks) through the new UI and asserts the
  plain-English summary appears in the modal and on the canvas (skips cleanly if
  the `scheduled_node` feature flag is off). Runs in the e2e CI job, which
  provides the full app stack (the suite has no `webServer` and is not run by
  `validate.sh`).

## Validation

`./validate.sh` passes except the pre-existing `pnpm audit` advisory (a high
finding in Better Auth, present before this change — no dependency manifests
were modified here).
