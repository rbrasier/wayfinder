# Implementation Summary — Flow Memory (v0.35.0)

- **Version**: 0.35.0 — **MINOR** (new feature + schema change), from 0.34.0
- **Branch**: `claude/flow-memory-phase-review-e3f0ts`, PR against `main`
- **Phase doc**: [`flow-memory.phase.md`](flow-memory.phase.md)
- **PRD**: `docs/development/prd/flow-memory.prd.md`
- **ADRs**: 057 (observation → lesson → owner acceptance), 058 (lessons resolve
  live), and an `Amended by` note added to 015

## What was built

A published flow now accumulates typed observations from finished sessions, a
daily job distils clustered observations into step-scoped lessons, and the flow
owner accepts or rejects each one. An accepted `guidance` or `efficiency` lesson
renders into that step's system prompt as a `<learned_guidance>` block and takes
effect on the next turn of every session on the flow — including sessions pinned
to an older flow version. `knowledge_gap` lessons never reach a prompt; they
raise an item in the knowledge-curation queue instead. Accept, reject and retire
are audited.

Two riders shipped with it, both consequences of the design rather than
additions to it: `AiTurnPayload` gained the two fields `knowledge_gap` needs, and
retention gained a seventh target plus an admin settings card.

## Files created

**Domain** — `flow-observation.ts`, `flow-lesson.ts`, `flow-observation-rules.ts`
(+ 2 test files), `ports/flow-observation-repository.ts`,
`ports/flow-lesson-repository.ts`, `ports/lesson-distiller.ts`.

**Application** — `use-cases/memory/`: `capture-session-observations.ts`,
`distil-flow-lessons.ts`, `accept-lesson.ts`, `reject-lesson.ts`,
`get-flow-memory-panel.ts`, `get-lesson-detail.ts`, `sweep-flow-memory.ts`,
`index.ts` (+ 4 test files); `use-cases/settings/retention-settings.ts` (+ test);
`use-cases/session/get-session-for-turn-lessons.test.ts`.

**Adapters** — `repositories/drizzle-flow-observation-repository.ts`,
`repositories/drizzle-flow-lesson-repository.ts` (+ test),
`ai/ai-lesson-distiller.ts` (+ test), `memory/flow-memory-worker.ts` (+ test,
+ `index.ts`).

**Web** — `components/canvas/flow-memory-panel.tsx`, `flow-memory-drawer.tsx`,
`flow-memory-toggle.tsx`, `flow-memory-panel-model.ts` (+ test);
`components/settings/retention-card.tsx`, `retention-card-model.ts` (+ test);
`server/routers/flow-memory.ts`; `lib/container-flow-memory.ts`;
`app/(user)/flows/[id]/config/_canvas-region.tsx`, `_use-flow-memory-panel.ts`.

## Files modified

**Domain** — `analytics.ts` (+ `FlowUsageStats`, `computeFlowUsageStats`),
`session-message.ts` (`AiTurnPayload` gains `missingInformation` and
`retrievedChunkCount`), `answer-feedback.ts` (`source`, nullable `sessionId`),
`retention-policy.ts` (seventh target), `ports/session-agent.ts`
(`acceptedLessons`), `ports/session-repository.ts` (`listTerminalSince`), both
`index.ts` barrels.

**Application** — `get-session-for-turn.ts` (lesson repository joins the parallel
fan-out), `use-cases/index.ts`.

**Adapters** — `db/schema/ai.ts` (three tables), `db/schema/kb.ts`
(`kb_answer_feedback` alterations), `agents/flow-session-graph.ts`
(`buildLearnedGuidanceBlock`), `repositories/drizzle-session-repository.ts`,
`drizzle-answer-feedback-repository.ts`, `drizzle-retention-repository.ts`,
barrels.

**Apps** — `apps/web`: `lib/container.ts`, `server/router.ts`,
`server/routers/settings.ts`, `app/api/chat/[sessionId]/stream/route.ts`,
`components/canvas/flow-canvas-viewport.tsx`,
`app/(user)/flows/[id]/config/_content.tsx`,
`app/(admin)/admin/settings/page.tsx`. `apps/api`: `container.ts`, `env.ts`,
`workers.ts` (+ its test).

**Root** — `VERSION`, `package.json`, `validate.sh` (see deviations).

## Migration

One generated migration, `packages/adapters/drizzle/0050_pretty_thaddeus_ross.sql`:

- `CREATE TABLE ai_flow_observations`, `ai_flow_lessons`,
  `ai_flow_lesson_evidence`, with their indexes.
- `ALTER TABLE kb_answer_feedback ALTER COLUMN session_id DROP NOT NULL`
- `ALTER TABLE kb_answer_feedback ADD COLUMN source text NOT NULL DEFAULT 'frontline'`

**No `-- data-impact:` line, and none required.** Nothing drops or rewrites rows;
a defaulted `ADD COLUMN` and a `DROP NOT NULL` cannot fail against existing data.
`migration-safety.test.ts` agrees.

Originally generated as `0049`; renumbered to `0050` when `main` landed its own
`0049_welcome_tour` while this branch was open. The migration was regenerated
with `pnpm db:generate` against main's new baseline rather than renamed by hand,
and its content is unchanged — the two migrations touch disjoint tables.

## Tests

All 373 test files pass (count grew after merging main); `./validate.sh` exits 0 on 25 checks.

- **Domain** — every capture rule and every lesson rule, each asserted to fire on
  its signal and on nothing else; `computeFlowUsageStats`; the seventh retention
  target.
- **Adapters** — `proposedLessonValues` ignores a status smuggled onto a
  candidate; `lessonStatusPatch` stamps a decider only on acceptance; the
  distiller's verbatim-value reject; the worker's window advancing only on
  success; the rendered prompt string.
- **Application** — the test-mode exclusion (asserting nothing is even loaded),
  the `canUserEditFlow` guard on all four decision paths, the
  `knowledge_gap` → `kb_answer_feedback` branch, the audit events, distiller
  validation rejects, retire-for-missing-nodes, and a session pinned to flow
  version 4 receiving a lesson accepted afterwards.
- **Web** — panel state persistence through a `PanelStateStore` interface
  (including a store that throws), the three-state transitions, lesson list
  filtering, the five stat tiles, and the retention card's window labels.

**No Playwright spec added.** No part of this falls into the six groups in
`docs/guides/e2e-test-policy.md`. Panel state persistence is asserted at the
storage interface, which is the contract this feature owns; whether a browser
preserves `localStorage` across a document load is the browser's behaviour, not
this feature's.

## Deviations from the approved summary

1. **`validate.sh` check 24 (the ADR-048 session-runner guard) was retired.** It
   forbade any change to `run-turn`, `evaluate-step-readiness`,
   `flow-session-graph` and the chat route. ADR-057 and ADR-058 require changing
   the last two — a lesson renders in `buildSystemPrompt` and resolves on the
   turn path — so the guard could not coexist with this phase. Its own failure
   message says to move the base ref or retire it; base-ref-bumping only defers
   the same failure to the next prompt change, so it is retired with the reason
   recorded in `validate.sh`. **This is the deviation most worth a reviewer's
   attention.**
2. **No second mount on the admin flow page.** The phase doc lists
   `app/(admin)/admin/flows/[id]/page.tsx`. That route is now only a redirect to
   the canonical `/flows/[id]/config` editor, which self-adapts to the viewer's
   permissions, so mounting once covers the admin case.
3. **The distiller sets no temperature.** The phase doc specifies "temp 0";
   `GenerateObjectInput` has no such field. Verified in the port rather than
   assumed. The call does carry `flowId`, so distillation spend is attributed in
   `ai_usage_events` as the PRD requires.
4. **UI is tested through pure model modules, not component tests.** The repo has
   no jsdom or React testing setup and no `.test.tsx` files; every tested UI
   concern lives in a `*-model.ts` beside its component. Followed that.
5. **`redundant_question` is derived from re-recorded context keys.** The doc
   specifies matching a question's "extracted subject" against gathered context,
   but nothing extracts a subject. Implemented mechanically instead: a question
   is redundant when a turn recorded a context key an earlier turn already
   recorded.
6. **Two files were decomposed to stay under the 800-line guard.**
   `_content.tsx` (798 on main) and `container.ts` (794 on main) were both within
   a handful of lines of the limit; `_canvas-region.tsx`,
   `_use-flow-memory-panel.ts` and `container-flow-memory.ts` were extracted.

## Known limitations

- **`low_confidence_completion` compares against the default advance threshold**,
  not each node's own `advanceConfidenceThreshold`. Node config is not loaded on
  the capture path. A step with a custom threshold will therefore be judged
  against 90.
- **The panel's reopen badge always shows 0.** `FlowMemoryToggle` accepts a
  `proposedCount` but the hidden state does not fetch the panel query, so no
  count is available without a second request. The button is correct; the badge
  is inert.
- **`supersedesLessonId` is stored but never set.** The distiller is shown
  existing statements and may propose a replacement, but the candidate's
  supersession is not resolved back to a lesson id.
- **Distillation runs per flow with no per-flow budget check** beyond the
  existing `ai_usage_events` metering and the batch cap.
- **The `stale` window and evidence threshold are read from defaults**, not yet
  from their `admin_system_settings` keys, on the panel and worker paths.

## Release note required

**All seven retention windows now default to keep forever (`0`).** Three
previously pruned by default: usage events (400 days), error log (90), and
notification log (180). A deployment that relied on those built-in defaults will
stop pruning those tables after upgrading. A window set in the environment is
still honoured, and any window can now be set from **Admin → Settings → Data
retention** without a redeploy. Operators who want the old behaviour should set
the three windows explicitly.
