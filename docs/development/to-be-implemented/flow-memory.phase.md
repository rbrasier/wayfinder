# Phase — Flow Memory (Self-Improving Flows)

- **Status**: Reviewed — `/doc-review` passed 2026-09-06; ready to build
- **Target version**: **MINOR** — **0.35.0**, against `main`'s 0.34.0.
  Allocated at `/doc-review` (2026-09-06). Three new `ai_` tables plus two safe
  alterations to `kb_answer_feedback`; no `-- data-impact:` declaration required.
- **PRD**: `docs/development/prd/flow-memory.prd.md`
- **ADRs**: `docs/development/adr/057-observation-to-lesson-with-owner-acceptance.adr.md`,
  `docs/development/adr/058-lessons-resolve-live-not-from-the-version-snapshot.adr.md`
- **Base branch**: `main` (new features never target a `release/*` branch)
- **Implemented doc lands in**: `docs/development/implemented/alpha-3/v0.35.0/`
- **Depends on**: `ILanguageModel` (ADR-002) and the `AiColumnMappingDetector` /
  `ISeedProposer` proposer precedents; `DocumentEditSummary`;
  `outstandingChangeRequests`; `sessionMode` (ADR-048); `buildSystemPrompt` and
  its skills block (ADR-031, ADR-016); `IAuditLogger` / `LogAuditEvent`;
  `job_registry` and the `RetentionWorker` / `TickWorker` precedent;
  `IAnswerFeedbackRepository` (ADR-028); `ISystemSettingsRepository` and the
  DB-first-with-env-fallback pattern (ADR-041 §2)
- **Also amends**: `015-flow-versioning-snapshots.adr.md` gains an
  `Amended by: ADR-058` line; `kb_answer_feedback` gains a `source` column and a
  nullable `session_id`; retention gains a seventh target and a settings card

## 1. Goal

Give a published flow a memory: capture typed signals from finished sessions,
distil them into step-scoped lessons with visible evidence, let the flow owner
accept or reject each one, and inject accepted guidance into that step's system
prompt from the next turn onward — including for sessions already in flight.

## 2. Approach

Per ADR-057 and ADR-058. Three new `ai_` tables. Capture is mechanical and
model-free. Distillation is a bounded, propose-only model call run as a scheduled
job. Application is a `<learned_guidance>` block in the stable region of the
system prompt, resolved live rather than from the pinned version snapshot.

Nothing changes behaviour without a `canUserEditFlow` user accepting it, and every
acceptance is audited.

Two riders ship with it, both consequences of the design rather than additions to
it. `AiTurnPayload` gains the two fields a `knowledge_gap` observation needs,
because neither is persisted today. And because observations deliberately outlive
their sessions, retention gains a seventh target — which surfaces the fact that
all seven windows are invisible environment variables, so they move to
`admin_system_settings` behind a settings card, defaulting to keep-forever.

## 3. What is built

### Domain (`packages/domain`) — pure, test-first

| File | Change |
|------|--------|
| `src/entities/flow-observation.ts` (new) | `FlowObservation`, `NewFlowObservation`, `ObservationKind`, `ObservationDetail` (a discriminated union on `kind`). |
| `src/entities/flow-lesson.ts` (new) | `FlowLesson`, `LessonKind`, `LessonStatus`, `LessonCandidate`, `ResolvedLesson`. Plus the pure rules: `isInjectable(lesson)` (accepted **and** kind is `guidance`/`efficiency`), `selectInjectableLessons(lessons, cap)` (most recently accepted first, capped), and `lessonsToRetire(lessons, liveNodeIds)`. |
| `src/entities/flow-observation-rules.ts` (new) | The pure capture rules, one predicate per kind, each taking already-loaded session data and returning `NewFlowObservation[]`: `observeFieldCorrections`, `observeLowConfidenceCompletions`, `observeExcessTurns`, `observeRedundantQuestions`, `observeChangeRequests`, `observeKnowledgeGaps`, `observeAbandonment`. No I/O — this is where the tests live. |
| `src/entities/analytics.ts` | Add `FlowUsageStats` and `computeFlowUsageStats(sessions, now, staleAfterDays)`. `stale` = `status === "active"` and `updatedAt` older than the window; `cancelled` counts under `abandoned` (consistent with `DISCARDED_SESSION_STATUSES`). |
| `src/ports/flow-observation-repository.ts` (new) | `IFlowObservationRepository`: `createMany(observations)` (idempotent on `(session_id, node_id, kind)`), `listUndistilledByFlow(flowId, limit)`, `listByLesson(lessonId)`, `markDistilled(observationIds)`. |
| `src/ports/flow-lesson-repository.ts` (new) | `IFlowLessonRepository`: `listByFlow(flowId)`, `listAcceptedByFlow(flowId)`, `findById(lessonId)`, `createProposed(candidate, evidenceObservationIds)` — **no status argument**, `setStatus(lessonId, status, decidedByUserId)`, `retireForMissingNodes(flowId, liveNodeIds)`. |
| `src/ports/lesson-distiller.ts` (new) | `ILessonDistiller.distil({ nodeName, nodeInstruction, kind, observations, existingStatements }) -> Result<{ candidates: LessonCandidate[] }>`. |
| `src/ports/session-agent.ts` | `BuildSystemPromptInput` gains `acceptedLessons?: ResolvedLesson[]`. |
| `src/entities/session-message.ts` | `AiTurnPayload` gains `missingInformation?: string[]` and `retrievedChunkCount?: number`. Both optional — absent reads as "not recorded", so existing rows stay valid and no migration is involved. Without them `knowledge_gap` has no source. |
| `src/entities/retention-policy.ts` | Add `ai_flow_observations` to `RetentionTargetKey`, `RETENTION_TARGET_KEYS`, `RetentionConfig` (`aiFlowObservationsDays`), `LABELS` and `buildRetentionPolicies`. Pure; the existing tests extend by one case. |
| `src/entities/answer-feedback.ts` | `AnswerFeedback` / `NewAnswerFeedback` gain `source: "frontline" \| "flow_lesson"`; `sessionId` becomes `string \| null`. |
| `src/entities/index.ts`, `src/ports/index.ts` | Export new symbols. |

Write `flow-observation-rules.test.ts` and `flow-lesson.test.ts` **first** — they
are the spec. Each kind fires on its signal and on nothing else; `isInjectable`
excludes every non-accepted status and every `knowledge_gap`;
`selectInjectableLessons` respects the cap and the ordering; `lessonsToRetire`
returns exactly the lessons whose node is absent.

### Application (`packages/application`)

| File | Change |
|------|--------|
| `src/use-cases/memory/capture-session-observations.ts` (new) | Runs on a terminal session. Returns early when `sessionMode(session) !== "live"`. Loads the session's messages, step outputs, approvals and document edit history; applies the seven pure rules; writes via `createMany`. |
| `src/use-cases/memory/capture-terminal-sessions.ts` (new) | The sweep that drives capture. There is no generic job queue in this codebase, and `app_sessions` gains no marker column, so the sweep selects sessions that reached a terminal state since the job's own `lastRunAt` (from `job_registry`) and calls `CaptureSessionObservations` for each. `createMany`'s idempotency makes an overlapping window harmless, so the first run after a gap simply catches up. |
| `src/use-cases/settings/get-retention-settings.ts`, `set-retention-settings.ts` (new) | Read and write the seven windows in `admin_system_settings`, DB-first with the env value as fallback (ADR-041 §2). Admin-only. |
| `src/use-cases/memory/distil-flow-lessons.ts` (new) | For one flow: groups undistilled observations by `(nodeId, kind)`, drops groups below the evidence threshold, resolves the node's name/instruction and its existing accepted statements, calls `ILessonDistiller`, **validates** each candidate (node matches, kind known, statement non-empty and within length) reporting rejects rather than writing them, persists survivors via `createProposed`, marks the observations distilled, then calls `retireForMissingNodes`. |
| `src/use-cases/memory/accept-lesson.ts` (new) | Guards on `canUserEditFlow`. For `guidance`/`efficiency`: `setStatus(accepted)`. For `knowledge_gap`: `setStatus(accepted)` **and** create an `AnswerFeedback` row — no prompt text. Emits the audit event. |
| `src/use-cases/memory/reject-lesson.ts` (new) | Guards on `canUserEditFlow`, `setStatus(rejected)`, emits the audit event. |
| `src/use-cases/memory/get-flow-memory-panel.ts` (new) | Returns `{ stats, lessons }` in one call — `computeFlowUsageStats` over the flow's live sessions plus `listByFlow`. Guards on `canUserEditFlow`. |
| `src/use-cases/memory/get-lesson-detail.ts` (new) | One lesson plus its evidence observations and their sessions, for the expanded drawer. Guards on `canUserEditFlow`. |
| `src/use-cases/session/get-session-for-turn.ts` | Add `listAcceptedByFlow(session.flowId)` to the existing `Promise.all` fan-out; return the accepted lessons on `SessionTurnDetail`. It joins the parallel reads rather than serialising behind them. |
| `src/use-cases/session/run-turn.ts` | Pass `selectInjectableLessons(lessonsForCurrentNode, cap)` into `buildSystemPrompt` as `acceptedLessons`. |
| `src/use-cases/memory/index.ts` (new), `src/index.ts` | Export the use cases. |

### Adapters (`packages/adapters`)

| File | Change |
|------|--------|
| `src/db/schema/ai.ts` | Add `ai_flow_observations`, `ai_flow_lessons`, `ai_flow_lesson_evidence` (§7). |
| `src/repositories/drizzle-flow-observation-repository.ts` (new) | Implements the port. `createMany` uses `on conflict do nothing` against the `(session_id, node_id, kind)` unique index — that is what makes capture idempotent. |
| `src/repositories/drizzle-flow-lesson-repository.ts` (new) | Implements the port. `createProposed` writes the lesson and its evidence rows in one unit of work and hard-codes `status = 'proposed'`. |
| `src/ai/ai-lesson-distiller.ts` (new) | Implements `ILessonDistiller` via `languageModel.generateObject` (zod schema, temp 0, `purpose: "flow-lesson-distillation"`). The prompt states the node's instruction, the observations, the existing accepted statements, and instructs the model to write a general rule and **never to restate a specific value seen in a session**. Output is sanitised before it leaves the adapter. |
| `src/agents/flow-session-graph.ts` | Render `buildLearnedGuidanceBlock(input.acceptedLessons ?? [])` between the skills block and `<instructions>`. Empty array renders nothing. |
| `src/memory/flow-memory-worker.ts` (new) | A `TickWorker` on the `RetentionWorker` precedent (`src/retention/`), not a new `src/jobs/` tree — daily, registered in `job_registry`, health-pinged, behind an env toggle. One tick runs the capture sweep then the distillation sweep, both batch-capped. |
| `src/repositories/drizzle-retention-repository.ts` | Add `ai_flow_observations` to the table allowlist. It is session-scoped for legal-hold purposes, so it honours `excludedSessionIds` (ADR-033). |
| `src/repositories/drizzle-answer-feedback-repository.ts` | Carry `source` through create and list; accept a null `sessionId`. |
| `apps/api/src/workers.ts`, both `container.ts` files, `deploy/lambda/handlers/container.ts` | Register the two repositories, the distiller and the worker, and start the worker under its toggle. Wiring lives in the apps, never in `packages/adapters` — the earlier draft of this doc put a `src/container` row in this table, which would breach the boundary in `CLAUDE.md`. |
| Retention policy construction | `buildRetentionPolicies` is currently called once at container start from `env`. It moves behind a read of `admin_system_settings` so a window changed on the card takes effect on the next tick without a redeploy; env remains the fallback for an unset key. |

### Web (`apps/web`)

| File | Change |
|------|--------|
| `src/components/canvas/flow-memory-panel.tsx` (new) | The three-state panel: `hidden` / `narrow` / `expanded`. Header renders the five stat tiles; body renders the lesson list, `proposed` first with evidence-count badges, then `accepted`. |
| `src/components/canvas/flow-memory-drawer.tsx` (new) | The expanded state: ~85% viewport width over a scrim, full statement, step name, evidence sessions, **Accept** / **Reject**. Closes on scrim click and on the minimise control, returning to `narrow`. |
| `src/components/canvas/flow-memory-toggle.tsx` (new) | The reopen affordance: a single icon button pinned to the **top right of the canvas viewport**, rendered only while the panel is `hidden`. |
| `src/components/canvas/flow-canvas-viewport.tsx` | Host the toggle in an overlay layer above the React Flow surface. |
| `src/app/(user)/flows/[id]/config/_content.tsx` | Mount the panel to the right of the canvas when `flowStatus === "published"`; hold panel state (persisted per user in `localStorage`, keyed by flow id) and pass it down. |
| `src/app/(admin)/admin/flows/[id]/page.tsx` | Same panel, same conditions — an admin editing a flow sees its memory. |
| `src/components/settings/retention-card.tsx` (new) | The Data Retention card on `/admin/settings`, following the existing `*-card.tsx` pattern. One row per retention target — seven of them — each a day count, with `0` labelled "keep forever". States that a legal hold overrides any window. |
| tRPC routers (`apps/web/src/server/routers/`) | A new `flow-memory.ts` with `flowMemory.panel`, `.lesson`, `.accept`, `.reject`, each delegating authorisation to the use case rather than duplicating the check; and `settings.ts` gains the retention read/write procedures. **Not `apps/api`** — that is an Express service with no tRPC; every router in this repo lives here. |

## 4. The seven observation kinds and their sources

Each is a pure function over already-loaded session data. This table is the
contract the tests assert.

| Kind | Fires when | Source |
|---|---|---|
| `field_corrected` | A human changed a generated field value after the step produced it | `DocumentEditSummary` over the message's `editHistory` — the diff already exists |
| `low_confidence_completion` | A step advanced with `stepCompleteConfidence` below the node's `advanceConfidenceThreshold` (or the default) | `app_session_messages.confidence` on the advancing turn |
| `excess_turns` | Turns on a node exceed a multiple (default 2×) of that node's median across the flow's completed sessions | Message counts per `stepNodeId` |
| `redundant_question` | An assistant turn asked for something already present in the session's aggregated gathered context | `aggregateGatheredContext` keys vs. the question turn |
| `change_requested` | An approval decision routed work back, with the approver's comment | `outstandingChangeRequests` / the approval row's comment |
| `knowledge_gap` | A turn retrieved no chunks above threshold **and** the reply signalled missing information | `aiPayload.retrievedChunkCount === 0` and a non-empty `aiPayload.missingInformation` — **both fields are new** (§3). Today `missingInformation` is rendered into prose by `buildCrossCheckGapNote` and discarded, and retrieval results are never persisted, so this kind has no source without them. Never parse the note text. |
| `abandoned_at_step` | The session ended `abandoned` or `cancelled` while on this node | `session.status` + `currentNodeId` |

The unique index is `(session_id, node_id, kind)`, so **one session contributes at
most one observation of each kind to each node** — one vote per session, which is
the intent. Where a session fires the same kind several times on one node (four
fields corrected on one step, two redundant questions), `ObservationDetail` holds
them as a list rather than a single occurrence, and capture builds that list
before the write. `on conflict do nothing` must never be the thing that discards
the second through fourth — it exists to make a *re-run* idempotent, not to
silently drop evidence within one run.

`excess_turns` needs the flow's per-node median, so capture loads it once per
session rather than per node. Where a flow has too few completed sessions for a
median to mean anything (fewer than 5), the kind does not fire at all.

## 5. What must not happen (non-negotiable)

- A distiller output must never be persisted as `accepted`. `createProposed`
  takes no status argument; that is the enforcement, not a code review.
- A `mode = "test"` session must never produce an observation. Checked in
  `CaptureSessionObservations` before any load.
- A `knowledge_gap` lesson must never produce prompt text, in any status.
- `proposed`, `rejected` and `retired` lessons must never produce prompt text.
- The `<learned_guidance>` block must never be placed below the per-turn blocks
  (retrieved chunks, attached documents, current date) — that would move the
  cache boundary and cost a miss on every turn (ADR-016).
- Accept and reject must be refused for a user failing `canUserEditFlow`, in the
  use case, not only in the router.
- `buildSystemPrompt` must render nothing at all when `acceptedLessons` is absent
  or empty — a flow with no memory produces a byte-identical prompt to today's.
- A `knowledge_gap` observation must never be derived by parsing message prose.
  If the two `AiTurnPayload` fields are absent on a turn, the kind does not fire.
- Retention windows must default to `0` — keep forever — for all seven targets.
  A deployment that upgrades into this release must not start deleting anything
  it was not already deleting.

## 6. Audit events

Three new audit actions, written through the existing `IAuditLogger`:

- `flow_lesson.accepted` — `{ lessonId, flowId, nodeId, kind, statement }`
- `flow_lesson.rejected` — `{ lessonId, flowId, nodeId, kind }`
- `flow_lesson.retired` — `{ lessonId, flowId, nodeId, reason: "node_removed" }`

The accepted event carries the statement verbatim, so the audit log answers "what
exactly was the model told to do" without a join to a table whose row may later
have been superseded.

## 7. Database changes

```sql
ai_flow_observations
  id uuid pk, flow_id uuid not null, node_id uuid not null,
  session_id uuid null references app_sessions on delete set null,
  kind text not null, detail jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null, distilled_at timestamptz null,
  created_at, updated_at
  unique (session_id, node_id, kind)
  index (flow_id, node_id)
  index (flow_id) where distilled_at is null

ai_flow_lessons
  id uuid pk, flow_id uuid not null, node_id uuid not null,
  kind text not null, statement text not null, status text not null default 'proposed',
  evidence_count integer not null default 0,
  first_seen_at timestamptz not null, last_seen_at timestamptz not null,
  accepted_by_user_id uuid null, accepted_at timestamptz null,
  supersedes_lesson_id uuid null, created_at, updated_at
  index (flow_id, status)
  index (flow_id, node_id, status)

ai_flow_lesson_evidence
  id uuid pk, lesson_id uuid not null references ai_flow_lessons on delete cascade,
  observation_id uuid not null references ai_flow_observations on delete cascade,
  created_at, updated_at
  unique (lesson_id, observation_id)
```

`session_id` is `on delete set null` deliberately: retention may remove a session
while a lesson it supported remains in force. Evidence then reads as "the session
behind this has since been deleted" rather than silently retiring live guidance.

Two alterations to one existing table:

```sql
kb_answer_feedback
  add column source text not null default 'frontline'   -- 'frontline' | 'flow_lesson'
  alter column session_id drop not null
```

A defaulted `ADD COLUMN` and a `DROP NOT NULL` are both safe against existing
rows, so **no `-- data-impact:` declaration is required** for any of this — nothing
drops or rewrites rows, and no constraint can fail. One generated migration
covering all five changes; never `drizzle-kit push`.

An accepted `knowledge_gap` lesson writes a `kb_answer_feedback` row with
`source = 'flow_lesson'`, `session_id` set to the most recent surviving evidence
session or null, `flagged_answer` carrying the lesson statement, and
`corrected_text` empty for the SME to supply during triage. Without the two
alterations the row cannot be written at all: `session_id` is `not null` with
`on delete cascade`, and a lesson has neither a single session nor a correction.

New `admin_system_settings` keys, all read with a default so an unset deployment
behaves correctly:

| Key | Default |
|---|---|
| `flow_memory.stale_after_days` | 14 |
| `flow_memory.evidence_threshold` | 3 |
| `retention.<target>_days` × 7 | `0` — keep forever, env value as fallback |

The injected-lesson cap (5) is a domain constant, not a setting — it is a
prompt-safety bound, not an operator preference.

## 8. Implementation order (tests first)

1. `flow-observation.ts`, `flow-lesson.ts` and `flow-observation-rules.ts` with
   their tests. Nothing else compiles against a guessed shape.
2. `computeFlowUsageStats` + tests in `analytics.ts`.
3. Ports: observation repository, lesson repository, distiller.
4. `AiTurnPayload`'s two new fields, written on the turn path, plus the
   `retention-policy.ts` seventh target and the `answer-feedback.ts` shape change
   — all pure, all with tests. Nothing downstream is capturable until step 4.
5. Schema + generated migration (three creates, two `kb_answer_feedback`
   alterations) + `migration-safety.test.ts` green.
6. Drizzle repositories + adapter tests, including the idempotency of `createMany`
   and the fact that `createProposed` cannot write `accepted`; the retention
   repository's new allowlist entry and its legal-hold exclusion.
7. `CaptureSessionObservations` + tests, including the test-mode exclusion.
8. `AiLessonDistiller` + `DistilFlowLessons` + tests, including the validation
   rejects — node mismatch, unknown kind, and a statement restating a verbatim
   value from its evidence — and the retire-for-missing-nodes pass.
9. `AcceptLesson` / `RejectLesson` + tests, including the authorisation guard, the
   `knowledge_gap` → `kb_answer_feedback` branch with `source = 'flow_lesson'`,
   and the audit events.
10. `buildLearnedGuidanceBlock` + prompt tests: placement above the per-turn
    blocks, exclusion of every non-injectable lesson, byte-identical prompt when
    the list is empty.
11. `GetSessionForTurn` fan-out + `run-turn` wiring + tests that an in-flight
    session picks up a newly accepted lesson on its next turn.
12. `GetFlowMemoryPanel` / `GetLessonDetail` + the `flowMemory` tRPC router in
    `apps/web/src/server/routers/`.
13. Panel, drawer and canvas toggle + component tests.
14. `FlowMemoryWorker` — the capture sweep bounded by `job_registry.lastRunAt`,
    then the distillation sweep — registered in `workers.ts` under its toggle.
15. Retention settings moved to `admin_system_settings` (DB-first, env fallback),
    the retention tRPC procedures, and the Data Retention card + component tests.
    Assert that all seven default to keep-forever and that an env-set window is
    still honoured.
16. `./validate.sh`; `VERSION` and root `package.json` both at `0.35.0`.

## 9. Testing

Unit tests in `domain` for every capture rule and every lesson rule — they are the
spec — plus the seventh retention target. Adapter tests for the two repositories,
the distiller's sanitisation and its verbatim-value reject, the retention
repository's new allowlist entry under a legal hold, and the rendered prompt
string. Application tests for authorisation, the test-mode exclusion, the
`knowledge_gap` branch and the audit events. Component tests for the panel's three
states, the stat tiles, the drawer's accept/reject, and the retention card.

**No Playwright spec is added.** None of this falls into the six groups in
`docs/guides/e2e-test-policy.md`: there is no streamed output and no file download.

The one place that had to be pinned down is panel state persistence. "Persists
across a reload" would be group 4 — *navigation state across a page load* — and a
component test genuinely cannot assert it. So the requirement is stated at the
level that can be tested honestly: the panel **writes its state key on every
transition and reads it on mount**, asserted against the storage interface. That
is the whole contract; whether a browser preserves `localStorage` across a reload
is the browser's job, not this feature's. The earlier wording claimed a browser
behaviour and then declined to test it in a browser, which was the contradiction.

## 10. Risks / open questions

- **`redundant_question` is the weakest rule.** Deciding that a question was
  already answered means matching a natural-language question against gathered
  context keys, and a naive match will produce false positives — which become
  evidence, which become a lesson telling the model not to ask something it needs.
  Mitigated by the evidence threshold and by a matching rule that must be stated
  as a testable predicate before it is written — "exact-ish" is not one. The rule
  is: a normalised exact match between the question's extracted subject and an
  existing `contextGathered` key. **Resolved at `/doc-review`: it ships**, with
  that rule and no fuzzy fallback.
- **`excess_turns` needs a population before it means anything.** It is suppressed
  below 5 completed sessions, so a new flow produces no efficiency lessons for its
  first weeks. That is correct but worth stating — the feature is quiet at first.
- **The distiller can restate a specific value.** ADR-057's stated residual risk.
  The prompt instructs against it and the accept gate enforces it. **Resolved at
  `/doc-review`: adopted** — the adapter also rejects a candidate whose statement
  contains a verbatim substring of an observation's `detail` values, turning a
  review obligation into a mechanical one. The accept gate remains the backstop,
  since a paraphrase still passes.
- **Daily sweep cadence.** Cheap and unhurried, but an author who fixes a flow
  waits a day to see whether new lessons appear. **Resolved at `/doc-review`:
  daily stands**; an owner-triggered "check now" is deferred to the PRD's §11.
- **The retention card is a second feature in this release.** Moving seven windows
  from environment variables to `admin_system_settings` touches domain, adapters,
  both containers, the Lambda topology and a new settings surface — comparable in
  size to flow memory itself, and it is being shipped alongside it by decision at
  `/doc-review`. The risk is a large release rather than a wrong one. It is
  separable if 0.35.0 grows unreviewable: the retention target alone is a
  four-line domain change, and the card can follow.
- **All seven windows default to keep-forever.** Three targets currently prune on
  a default window — usage events (400 days), error log (90), notification log
  (180). Flipping them to `0` means an upgraded deployment stops pruning three
  tables it was previously pruning, which is unbounded growth arriving quietly.
  An env-set window is still honoured, so only deployments relying on the built-in
  defaults are affected — but it needs a release note, not just a changelog line.
- **Panel state persistence.** `localStorage` per user per flow. It will not
  follow a user across devices. Acceptable for a display preference; not worth a
  table.
- **Node id stability across imports.** ADR-049 rewrites ids on import, so an
  imported copy of a flow starts with no memory even in the same deployment. This
  is consistent with lessons not being authoring config, but an author who
  duplicates a flow to iterate on it will be surprised that it forgot everything.
  Worth a line in the panel's empty state.

## 11. Acceptance criteria

The PRD's §10 checklist is the acceptance test for this phase; it is not
duplicated here. Every item there must be green, plus:

- [ ] `./validate.sh` passes, including `migration-safety.test.ts`.
- [ ] `VERSION` and root `package.json#version` both read `0.35.0`.
- [ ] `packages/domain` remains dependency-free; the new ports live in `domain`
      and every new boundary returns a `Result`.
- [ ] A flow with no accepted lessons produces a system prompt byte-identical to
      the one it produces today — asserted directly, not by inspection.
- [ ] The generated migration carries no `-- data-impact:` line and
      `migration-safety.test.ts` agrees that none is required.
- [ ] All seven retention windows default to keep-forever, and a window set in
      env is still honoured when the corresponding settings key is unset.

---

## Appendix — Approved change summary

The summary approved before any doc was written, with the approver's UI notes
folded in. Carried here per the `/new-feature` workflow.

> **Superseded in places by `/doc-review` (2026-09-06).** This appendix is kept as
> the historical record of what was approved, not as a current specification.
> Where it disagrees with §§1–11 above, those sections win. The review changed
> five things: the tRPC procedures live in `apps/web/src/server/routers/`, not
> `apps/api`; `AnswerFeedback` is **not** reused unchanged; `AiTurnPayload` gains
> two fields so `knowledge_gap` has a source; observations become a seventh
> retention target and the seven windows move to a settings card; and panel state
> persistence is specified at the storage interface rather than across a reload.

**Flow memory turns the exhaust of every completed session into step-level
lessons a flow owner can accept.** Signals already sitting unused in the database
— a step that advanced below its confidence threshold, an approver's
change-request comment, a document field the operator overrode after generation, a
step that took nine turns when the flow's median is three, a turn where retrieval
returned nothing — are captured as typed observations against `flow_id` +
`node_id`. A background job periodically distils clustered observations into
lessons: short, human-readable statements with their evidence attached. A lesson
is born `proposed` and does nothing. Once the flow owner accepts it, it renders
into that step's system prompt as a `<learned_guidance>` block, in the
cache-stable region alongside `<skills>`, and the flow improves from the next
session onward. Knowledge-gap lessons never enter a prompt — they route into the
existing KB curation loop instead. Accept, reject and retire are audited, so "why
did the AI start saying that?" always has an answer.

### Goal

- A flow owner watches their flow get better without hand-editing prompts, and
  can see exactly what it learned and from what evidence.
- The operator running the flow benefits invisibly: fewer redundant questions,
  fewer corrections after generation, fewer approval bounce-backs.
- Wayfinder's governance position holds — nothing changes a live flow's behaviour
  without a named human accepting it, recorded in `core_audit_log`.
- The three chosen signal families map to three lesson kinds: `guidance` (step
  instructions), `efficiency` (question redundancy and ordering), `knowledge_gap`
  (routes to KB, never to a prompt).

### Business rules changing

- An observation is written only when a session reaches a terminal state, and only
  for `mode = "live"` sessions — test runs would poison the evidence, so they are
  excluded from capture (but lessons still *apply* in test runs, so an author can
  try one before accepting it).
- A lesson is proposed only once its evidence count reaches a threshold (default
  3 observations of the same kind on the same node); below that it stays latent,
  so one bad session never becomes doctrine.
- Only `accepted` lessons of kind `guidance` or `efficiency` are injected into the
  prompt; `proposed`, `rejected` and `retired` are inert, and `knowledge_gap` is
  never injected at all.
- Accepted lessons resolve **live** against the flow's current node ids, not from
  the pinned `app_flow_versions` snapshot — otherwise an in-flight session could
  never benefit from what was just accepted (ADR-058).
- A lesson whose node no longer exists in the published flow auto-retires on the
  next distillation pass rather than lingering as orphaned guidance.

### UI / visible behaviour

- The flow config screen gains a right-hand panel, shown only once the flow is
  **published** — a draft has no live sessions to learn from, so the panel is
  absent rather than empty.
- Panel header: usage stats for the flow — total chats, completed, in progress,
  stale, abandoned. `stale` is derived, not stored: an `active` session with no
  message for N days (default 14, an `admin_system_settings` key).
- Panel body: the lesson list — `proposed` first with an evidence-count badge,
  then `accepted`, each showing its step name and a one-line statement.
- Clicking a lesson widens the drawer to ~85% of the viewport, overlaying the
  canvas — full statement, the step it attaches to, the linked evidence sessions,
  and Accept / Reject. Dismiss by clicking the canvas scrim or the minimise
  button; the drawer returns to its narrow width, canvas state untouched.
- The panel can be **collapsed away entirely** so the canvas is full width, and
  reopened from a single icon button pinned to the top right of the canvas
  viewport. Three states in total: hidden, narrow, expanded.
- Accepting shows the lesson's text inline where a `<learned_guidance>` block
  would render, so the owner sees what the model will be told before committing.

### Data & types

- `FlowObservation`, `ObservationKind` (seven kinds), `ObservationDetail`.
- `FlowLesson`, `LessonKind` (`guidance` / `efficiency` / `knowledge_gap`),
  `LessonStatus` (`proposed` / `accepted` / `rejected` / `retired`).
- `ResolvedLesson { statement }` — the prompt-facing projection, mirroring
  `ResolvedSkill`.
- `FlowUsageStats { total, completed, inProgress, stale, abandoned }` in
  `analytics.ts`.
- Ports: `IFlowObservationRepository`, `IFlowLessonRepository`,
  `ILessonDistiller` (propose-only, validating, mirroring `ISeedProposer`).
- `BuildSystemPromptInput` gains `acceptedLessons?: ResolvedLesson[]`, rendered
  after `<skills>` so prompt-cache hits above it are preserved.

### Files & packages touched

- Docs: this phase doc, `prd/flow-memory.prd.md`, `adr/057-…`, `adr/058-…`.
- `packages/domain` — new entities and ports; zero external deps, all pure.
- `packages/application` — `CaptureSessionObservations`, `DistilFlowLessons`,
  `AcceptLesson` / `RejectLesson`, `GetFlowMemoryPanel`, `GetLessonDetail`.
- `packages/adapters` — three Drizzle repositories, the `ILessonDistiller`
  implementation on `ILanguageModel`, a `job_registry` sweep, and the
  `<learned_guidance>` block in `flow-session-graph.ts`.
- `apps/web` — the memory panel, expanding drawer and canvas toggle under
  `app/(user)/flows/[id]/config/`; `apps/api` — the four tRPC procedures.

### Database & migration impact

- Three new `ai_`-prefixed tables: `ai_flow_observations`, `ai_flow_lessons`,
  `ai_flow_lesson_evidence`.
- Each carries `id` (uuid), `created_at`, `updated_at`; columns snake_case;
  indexes on `(flow_id, node_id)` and `(flow_id, status)`.
- One generated migration, additive `CREATE TABLE` / `CREATE INDEX` only — no
  `-- data-impact:` declaration required, since nothing drops rows and no
  constraint can fail against existing data.
- No changes to `app_sessions`, `app_flows` or `app_flow_versions`.

### Version, branch & PR target

- **MINOR** bump: `0.34.0` → `0.35.0` on `main`. Planned here, applied by
  `/build`, never by `/new-feature`.
- Branch and PR target `main`, per the release-branching table.
- On implementation the phase doc moves to `implemented/alpha-3/v0.35.0/`.

### Risks

- **Prompt bloat and drift** — accumulated lessons could crowd out the author's
  own `<instructions>`. Mitigated by a per-node cap and by `retired` superseding
  rather than appending.
- **Cache invalidation** — the block sits in the stable region, so accepting a
  lesson mid-session invalidates that session's prompt cache once. Bounded and
  acceptable.
- **Evidence privacy** — observations quote real session content, including
  corrected field values. They inherit the flow's visibility scope and retention.
- **Distillation cost** — a periodic model call per flow with new observations,
  batch-capped, attributed through `ai_usage_events`.
- **Bad lessons look authoritative** — a plausible but wrong lesson is worse than
  none. The evidence threshold, the visible receipts and the accept gate are the
  three defences; nothing auto-applies.

### Out of scope

- Cross-flow lesson library and sharing between organisations.
- Automatic rewriting of the author's `aiInstruction`.
- Routing/branch-rule learning from branch overrides, and extraction-flow memory.
- Per-operator or per-group personalisation of lessons.
- Any A/B or shadow measurement of whether an accepted lesson actually helped.
