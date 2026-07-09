# Phase — Scheduled-Step Plain-Language UX & Canvas Polish

- **Status**: Implemented
- **Target version**: 1.31.0 (bump: **MINOR** — new structured recurrence model,
  `app_session_schedules.kind` enum widened, new authoring UX)
- **Depends on**: Scheduling (1.26.0), Scheduler worker (1.28.0), Field-value
  selector / n8n workflow context mapping (1.30.0, `FieldValueSelector`)
- **Build order**: repo is at 1.30.0; this phase is purely additive on top.

## 1. Problem

The scheduled-step configuration exposes engineering concepts that the
business users who author flows cannot parse:

- **Schedule kind** offers `relative` / `cron` / `at` — "cron" is meaningless
  to a non-engineer, and a raw cron string is unauthorable by hand.
- The **Anchor** dropdown (`node_reached` / `step_metadata`) has no plain
  meaning out of context.
- The **`at`** kind asks for a raw ISO-8601 string in a text box.
- On the canvas, every step type looks alike (same colour family), with no
  at-a-glance way to tell a conversational step from an automated (n8n) or
  scheduled one.

We want a plain-English authoring experience and clearer canvas affordances,
without losing any existing scheduling capability.

## 2. Goals

- **"When should this run?"** replaces "Schedule kind", with three
  plain-language choices:
  - *Run after a delay* (`relative`) — a duration plus a "counting from"
    selector (when this step is reached / a date carried from an earlier step),
    which subsumes the standalone **Anchor** control.
  - *At a specific date & time* (`at`) — keeps the existing
    AI-decides / from-an-earlier-step / specific-value options
    (`FieldValueSelector`); when *specific* is chosen, a **calendar date
    picker + iOS-style scrolling-wheel time picker** replaces the raw ISO box.
  - *Repeat on a schedule* (`recurrence`) — plain-English **Every Day / Every
    Week / Every Month / Custom**; Custom exposes frequency, an "Every N"
    interval, weekday / month-day selection, and a time. `recurring` is
    derived (always true for this kind).
- **Structured recurrence** model that replaces hand-authored cron for new
  steps while the engine keeps firing existing `cron` rows.
- Picked dates/times are interpreted in the **user's local timezone**; the
  recurrence rule stores its IANA zone so day boundaries and times stay correct
  across DST (computed with built-in `Intl`, no new dependency).
- **Step-type colours**: conversational = blue, automated (n8n) = purple,
  scheduled = green — applied to the modal's type selector, section accents,
  and the canvas node borders.
- **Canvas type icon**: a small type icon in each node's **top-right** corner
  (chat = conversational, bolt = automated, timer = scheduled).
- Confirm the n8n request-field value sources (item: "AI Decides or a step
  output metadata item from a previous step") are wired — these shipped in
  1.30.0 via `FieldValueSelector`; no new work expected, only verification.

## 3. Non-goals

- No removal of the `cron` kind from the domain/engine — legacy `cron` rows
  must keep firing. The modal simply stops offering cron as an authoring
  option; opening a legacy `cron` node defaults its UI to *Repeat*.
- No per-occurrence exceptions / RRULE EXDATE, no "nth weekday of month",
  no second-level precision (ADR-019 keeps sub-minute out of scope).
- No timezone *picker* — the author's browser timezone is used.

## 4. Approach

Bottom-up (domain → application → adapters → web), test file before
implementation file (CLAUDE.md). Storage rides existing columns: the
structured recurrence rule is JSON-serialised into the existing
`app_session_schedules.spec` text column under a new `kind = "recurrence"`.

### Recurrence model

`RecurrenceRule`:

```ts
interface RecurrenceRule {
  frequency: "daily" | "weekly" | "monthly";
  interval: number;        // every N (>= 1)
  weekdays?: number[];     // 0=Sun..6=Sat, weekly only
  monthDay?: number;       // 1..31, monthly only
  hour: number;            // 0..23, wall-clock in `timezone`
  minute: number;          // 0..59
  timezone: string;        // IANA, e.g. "Europe/London"
}
```

`computeNextRecurrence(rule, start, from)` returns the earliest occurrence
strictly after `from`, where occurrences are wall-clock `hour:minute` in
`rule.timezone` on days matching `frequency`/`interval` counted from the
`start` anchor. A bounded forward day-by-day scan (mirrors `nextCronTime`)
resolves each candidate's UTC instant via an `Intl.DateTimeFormat`
offset lookup, so DST transitions are handled. `start` is the original
node-reached anchor, preserved in the schedule's `payload.anchorAt` so the
interval count stays stable across recurrences.

### Fire/recompute wiring

`computeNextFireAt` gains an optional `start` (defaults to `anchor`); for
`recurrence` it parses the JSON spec and calls `computeNextRecurrence`.
`FireDueSchedules.canRecur` includes `"recurrence"`; on recompute it passes
`payload.anchorAt` as `start` and `now` as `from`.

## 5. Key entities / files

| Layer | File | Change |
|-------|------|--------|
| domain | `entities/recurrence-rule.ts` | **New** `RecurrenceRule` + `parseRecurrenceRule`/`serializeRecurrenceRule` + `describeRecurrenceRule` (human summary). |
| domain | `entities/session-schedule.ts` | Add `"recurrence"` to `ScheduleKind`. |
| domain | `entities/flow-node.ts` | `ScheduledNodeConfig` allows `kind: "recurrence"`. |
| application | `use-cases/scheduling/compute-next-fire.ts` | `computeNextRecurrence`; `computeNextFireAt` handles `recurrence` + optional `start`. |
| application | `use-cases/scheduling/fire-due-schedules.ts` | `canRecur` includes `recurrence`; pass `payload.anchorAt` as `start`. |
| application | `use-cases/scheduling/schedule-node-event.ts` | Compute first fire for `recurrence`; persist `anchorAt` in payload. |
| adapters | `db/schema/wayfinder.ts` | Widen `kind` enum to include `"recurrence"` (text column — no SQL migration). |
| web | `components/modals/node-config-modal.tsx` | "When should this run?" controls, relative "counting from", recurrence builder, type colours. |
| web | `components/ui/wheel-picker.tsx` | **New** reusable snap-scroll wheel column. |
| web | `components/ui/time-wheel.tsx` | **New** hour/minute/AM-PM wheels → 24h. |
| web | `components/ui/calendar-picker.tsx` | **New** month-grid date picker. |
| web | `components/canvas/*-node.tsx` | Top-right type icon + per-type border colour (scheduled teal→green). |
| web | `app/(user)/flows/[id]/config/_content.tsx`, `app/(admin)/admin/flows/[id]/_content.tsx` | Map `recurrence` kind/spec/`anchorAt`; derive `recurring`. |

## 6. Tests

- **Unit (first)**: `compute-next-fire` recurrence cases (daily/weekly/monthly,
  interval > 1, DST boundary in a non-UTC zone, max-occurrences completion);
  `recurrence-rule` parse/serialize/describe round-trips; wheel/calendar pure
  date math.
- **e2e**: `apps/web/e2e/enhance-scheduled-step-plain-language.spec.ts` —
  author a *Repeat on a schedule* scheduled step through the new plain-English
  UI and confirm it persists and renders its human summary on the canvas.

## 7. Versioning

`1.31.0` — **MINOR**: new structured-recurrence feature and authoring UX;
`app_session_schedules.kind` enum widened (additive, no data migration).
`VERSION` and root `package.json` updated together.
