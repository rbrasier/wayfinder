# Phase — Value & Flow Health dashboards, with operator-captured time saved

- **Status**: Implemented in v0.28.8
- **Target version**: 0.28.8 (bump: PATCH — see §11 for why a schema-bearing
  change takes a PATCH on this line)
- **Base branch**: `release/alpha-2` — PR opens against `release/alpha-2`
- **ADRs**: no new ADR, and none governs dashboard reporting. Two are cited by
  filename because their numbers are shared by two documents each:
  - `006-wayfinder-flow-and-session-schema.adr.md` — the session schema the new
    column extends
  - `026-usage-governance-enforcement.adr.md` — the `ai_usage_events`
    flow/session attribution the cost panel reads (**not**
    `026-operator-confirmed-step-completion.adr.md`)
- **Depends on**: existing analytics repository and dashboards, `IUsageRepository`
  (`summarize` / `summarizeBy("flow")`) for cost, `app_session_approvals`
  decision timestamps for approver wait

## 1. Problem

Two of the three admin dashboards do not earn their place.

**Overview** reports session counts, a completion rate and an averaged AI
confidence curve. None of it supports a decision. It shows no cost, nothing
actionable, and its completion rate is computed by dividing two different
cohorts (completions whose `updatedAt` falls in the window over starts whose
`createdAt` falls in it), so clearing a backlog can push it above 100%.

**Flow Usage** renders two bar charts that restate two columns of the table
directly beneath them, flattens a graph into an insertion-ordered list, and
reports a `dropOff` that counts only `abandoned` sessions while its
`completionRate` penalises *every* non-complete session resting on the node —
so the two columns on screen contradict each other. Its `averageDurationSeconds`
is wall-clock (`max − min` message time, so it includes the operator going to
lunch) and excludes single-message sessions from both numerator and denominator,
making it a mean over a biased subset.

Underneath both sits a bigger gap: Wayfinder cannot say how much time it saves.
That is the question a sponsor asks first, and there is no data to answer it —
the counterfactual (how long the work would have taken manually) is not
observable from anything currently recorded.

## 2. Goals

- Capture a manual-time baseline from the person who ran the work, at the moment
  they finish it, with near-zero friction and no author configuration.
- **Value** dashboard: report *effort avoided* in **hours**, overall and per
  flow, with AI cost shown alongside in `$` for context.
- **Flow Health** dashboard: show where sessions leave a flow, separating
  **abandoned** (gave up) from **stalled** (open, parked), with median step time.
- Fix the three aggregation defects above (cohort completion, drop-off/completion
  contradiction, biased mean step duration).
- Remove AI confidence **from dashboard reporting** — it never supported an
  operator decision, and averaging it across flows of different lengths is
  meaningless.

> **Scope boundary — the confidence gate is untouched.** This phase removes only
> the *reporting* of confidence on dashboards. The confidence mechanism that
> drives step advancement — `stepCompleteConfidence`, the advance threshold and
> `require_confirmation` behaviour (ADR-014, ADR-015, ADR-038) — is not modified.
> `app_session_messages.confidence` keeps being written and keeps gating
> advancement exactly as today; only the two dashboards stop charting it.

## 3. Non-goals

- Converting hours into money. Effort avoided is reported **only** in hours; AI
  cost is reported **only** in `$`. The two are never multiplied, netted, or
  placed in a shared total. No hourly-rate setting is introduced.
- Version-over-version flow comparison (the data exists — `flow_version_id` →
  `app_flow_versions` — but it is deliberately out of this phase).
- Per-step manual baselines. The estimate is captured per session and reduced to
  a per-flow median; steps do not carry their own baseline.
- Changing dashboard route paths. Labels change, URLs do not, so no link breaks.

## 4. Approach

Two independent halves that meet only on the Value page.

**Capture.** One nullable integer column on `app_sessions` holds the operator's
estimate in minutes. When a guided session reaches a terminal state, the chat
view offers a single prompt; answering writes the column, skipping writes
nothing. Because the column is nullable and unconstrained, the migration is
additive and carries every existing row untouched.

**Aggregation.** A flow's baseline is the **median** of its sessions' estimates —
median, not mean, so one operator answering "three weeks" cannot distort the
figure. Effort avoided for a session is `max(baseline − handsOn, 0)`, summed
across terminal sessions. Hands-on time is derived by sessionising the message
stream (summing inter-message gaps, each capped at an idle threshold) rather
than taking wall-clock, which is also the fix for the biased step-duration mean.

Abandoned and cancelled sessions count toward effort avoided: reaching the point
where a case was dropped still avoided the manual work up to that point. This is
a deliberate product decision, not an oversight, and is asserted by test.

Build strictly bottom-up (domain → application → adapters → web), writing the
test file before each implementation file (CLAUDE.md rule).

## 5. Key entities / files

| Layer | File | Change |
|-------|------|--------|
| domain | `entities/session.ts` | add `manualEstimateMinutes?: number \| null` to `Session` |
| domain | `entities/analytics.ts` | add `manualEstimateMinutes` to `AnalyticsSessionRow`; add `sessioniseHandsOn`, `computeFlowBaselineMinutes`, `computeEffortAvoided`, `computeStepFunnel` + their DTOs; **remove** `computeConfidenceLifecycle`, `ConfidenceLifecyclePoint`, and `averageConfidenceAtCompletion` from `NodeBreakdownRow` |
| domain | `ports/analytics-repository.ts` | `listAllMessages(range)` (all roles, for sessionisation) alongside the existing assistant-only read |
| application | `use-cases/session/record-manual-estimate.ts` | **new** — validates and stores the estimate on a terminal session |
| application | `use-cases/analytics/get-value-dashboard.ts` | **new** — headline, per-week trend, cycle time, per-flow rows; optional `flowId` scopes every figure |
| application | `use-cases/analytics/get-flow-deep-dive.ts` | replace the confidence/drop-off `nodeBreakdown` with the step funnel (continued / abandoned / stalled / median); `computeNodeBreakdown` is then unused and is removed |
| application | `use-cases/analytics/get-overview-dashboard.ts` | **delete** — superseded by the value dashboard |
| adapters | `db/schema/wayfinder.ts` | `app_sessions`: add `manual_estimate_minutes integer` (nullable) |
| adapters | `drizzle/<next>.sql` | generated migration — `ALTER TABLE app_sessions ADD COLUMN manual_estimate_minutes integer` |
| adapters | `repositories/drizzle-analytics-repository.ts` | select the estimate on both session reads; add `listAllMessages` |
| adapters | `repositories/drizzle-session-repository.ts` | map `manualEstimateMinutes` ↔ `manual_estimate_minutes` both ways |
| web | `components/chat/manual-estimate-modal.tsx` | **new** — presets, a days + hours stepper, and an exact-minutes field |
| web | `app/(admin)/admin/dashboards/overview/_content.tsx` | rebuild as **Value** (route unchanged) |
| web | `app/(admin)/admin/dashboards/flows/_content.tsx` | rebuild as **Flow Health** (route unchanged) |
| web | `server/routers/session.ts` | add `recordManualEstimate` mutation |
| web | `server/routers/analytics.ts` | replace `overview` with `value`; keep `flowDeepDive` |
| web | `components/sidebar.tsx` | relabel to Value / Flow Reports / Flow Health |
| web | `lib/container.ts` | wire the two new use cases |

## 6. Business rules

- A session's estimate may be recorded **only** when its status is terminal
  (`complete`, `abandoned`, `cancelled`); a request against an `active` session
  is rejected with `VALIDATION_FAILED`.
- An estimate must be a positive integer of minutes, at most 100 000 (≈ 69 days);
  outside that range is rejected rather than silently clamped.
- Recording is idempotent-by-overwrite: re-submitting replaces the prior value,
  so an operator correcting a mistyped figure is not blocked.
- Only the session's own user may record its estimate; the modal is never shown
  to a viewer or collaborator, and the mutation re-checks ownership server-side.
- A flow's baseline is the median of its non-null estimates. A flow with **zero**
  estimates has no baseline and contributes **no** effort avoided — it is
  reported as "collecting estimates", never as `0 h` and never interpolated.
- Effort avoided per session is `max(baseline − handsOn, 0)`; it can never be
  negative, so a session that took longer than the manual estimate contributes
  nothing rather than subtracting from the total.
- Terminal sessions of every kind contribute — `complete`, `abandoned` **and**
  `cancelled`. Active sessions never do.
- A step counts a resting session as **stalled** when it is `active` and
  untouched for more than 7 days, and as **abandoned** when its status is
  `abandoned` or `cancelled`. The two are disjoint, so the funnel's segments and
  its continued count always reconcile to the entry count.
- Coverage is the share of contributing sessions carrying an estimate, and is
  displayed on the face of the headline whenever it is below 100%.

## 7. UI / visible behaviour

- **Completion modal** — appears once when the operator's own session reaches a
  terminal state and no estimate is stored. Presets (Under 30 min, ~1 hour, Half
  a day, A full day, 2+ days), a **days + hours** stepper, and an exact-minutes
  field. `Skip` dismisses without writing; the modal does not reappear for that
  session in the same view.
- **Value** — headline "Effort avoided ≈ N hours" with an `estimate` badge and
  the coverage line; a `$` AI-cost panel beside it captioned as context only; an
  effort-avoided-per-week trend; a median cycle-time stat with approver wait
  broken out; and a flow table ranked by hours saved. A flow filter at the top
  scopes every figure on the page; flows without a baseline show "collecting
  estimates" in place of a number.
- **Flow Health** — a path funnel in graph order whose bars split into continued
  / abandoned / stalled; three summary cards (worst step, stalled now,
  abandoned); and a step table with entry count, continued, abandoned, stalled,
  median time and average turns. No confidence column anywhere.

> **Correction made during build — no per-step spend column.** The mockup showed
> a per-step `Spend` column and an earlier draft of this doc promised one. It is
> not implementable as scoped: `ai_usage_events` carries `flow_id` and
> `session_id` but **no `step_node_id` and no `message_id`**, so a cost cannot be
> attributed to the step that incurred it. Adding that attribution means a new
> column plus changes at every call site that records usage — out of scope here.
> Spend is therefore reported **per flow** (on Value, where `flow_id` is
> sufficient) and not per step. Cutting the column is the honest option; deriving
> it by splitting a session's cost evenly across its steps would be a fabricated
> number wearing a currency symbol.
- **Empty states** — with no estimates recorded at all, Value shows an explainer
  and how the figure gets populated, never a zero.

## 8. Data & migration impact

- One table touched: `app_sessions` (group prefix `app_`), one column added,
  `manual_estimate_minutes integer` — nullable, no default, no constraint.
- Additive and non-destructive: existing rows are carried across unchanged with
  `NULL`. It is not a `DROP`, `TRUNCATE`, `DELETE`, type change, `SET NOT NULL`,
  `ADD COLUMN … NOT NULL` without default, `ADD CONSTRAINT … UNIQUE`, or
  `CREATE UNIQUE INDEX`, so **no `-- data-impact:` line is required** by
  `migration-safety.test.ts`.
- Generated via the repo's migration tooling — never `drizzle-kit push`.
- No backfill. Sessions completed before this ships simply have no estimate and
  are excluded from coverage, which is the honest treatment.

## 9. Tests

Written before each implementation file:

- `packages/domain/src/entities/analytics.test.ts` — `sessioniseHandsOn` (idle
  cap applied, single-message session, out-of-order rows); `computeFlowBaseline`
  (median of even/odd counts, all-null → null); `computeEffortAvoided` (abandoned
  counted, negative clamped to zero, no-baseline flow excluded, coverage);
  `computeStepFunnel` (stalled vs abandoned disjoint, segments reconcile).
- `packages/application/src/use-cases/session/record-manual-estimate.test.ts` —
  terminal-status gate, range validation, ownership, overwrite.
- `packages/application/src/use-cases/analytics/analytics.test.ts` — value
  dashboard all-flows and `flowId`-scoped; flow deep dive funnel output.
- `packages/adapters` — repository mapping of the new column both directions.
- `apps/web` — modal component: days+hours ⇄ minutes conversion, preset
  selection, exact entry, and that Skip writes nothing.

**No Playwright e2e.** The changed behaviour falls into none of the six groups in
`docs/guides/e2e-test-policy.md` — it is not auth-session lifecycle, streaming
into the DOM, file upload/download, navigation state across a page load,
accessibility, or smoke. Coverage belongs at the layers above, where it is
written. Existing specs that assert the old dashboard headings are updated to the
new labels.

## 10. Risks

- **Deleting confidence reporting** removes working domain code. Consumers were
  enumerated before this doc was approved: `computeConfidenceLifecycle`,
  `ConfidenceLifecyclePoint`, `confidenceLifecycle` and
  `averageConfidenceAtCompletion` are referenced only in `entities/analytics.ts`
  and its test, `get-overview-dashboard.ts` (deleted by this phase), the two
  dashboard `_content.tsx` files (rebuilt by this phase) and
  `analytics.test.ts`. Nothing outside that set reads them, so the removal is
  contained. The advancement confidence gate is a different mechanism and is out
  of scope (see §2).
- **Session entity gains a field**, touching the mapper every session read uses.
  Low risk individually, wide blast radius — covered by the repository tests.
- **Median baseline on small samples** is volatile: a flow with three estimates
  can swing hard on a fourth. Coverage and sample size are shown so the figure is
  never read as more precise than it is.
- **Self-reported estimates are subjective** and may be optimistic or generous.
  This is inherent to the approach and is why the number is labelled an estimate
  everywhere it appears, never presented as measured.
- **Idle-cap choice (10 min) is a judgement call.** It is a named constant with a
  comment, changeable without touching call sites.

## 11. Version & branch

- Branch `enhance/value-flow-health-time-saved`, cut from `release/alpha-2`; PR
  opens against `release/alpha-2`.
- **Version 0.28.8 — a PATCH carrying a schema change, which deviates from the
  CLAUDE.md rule that a DB schema change takes a MINOR.** The deviation is
  deliberate and was chosen explicitly: the next MINOR on this line (`0.29.0`)
  and the two after it are already consumed by `main`/alpha-3, which is at
  `0.31.0`. Taking a MINOR here would collide with a released version number.
  There is precedent on this line — `0.28.6` shipped the approver-directory
  feature as a PATCH.
