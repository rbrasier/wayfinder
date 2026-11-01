# Phase — Flow Test Runs (Preview & Seeded Step Test)

- **Status**: Reviewed — `/doc-review` passed 2026-08-16. Ready to build.
- **Target version**: **0.29.0** — **MINOR** (new feature + additive
  `app_sessions.mode` column + one new `app_` table).
- **Base branch**: **`main`**, per `CLAUDE.md`'s routing of new features to the
  next release line. The implemented doc lands in
  `docs/development/implemented/alpha-3/v0.29.0/`. 0.29.0 rather than 0.28.0
  because `main` already carries 0.28.4 after the alpha-2 forward-merge, and
  versions never go backwards.

  This was built on `release/alpha-2` first, at the requester's direction, and
  moved to `main` before review. The move was a clean rebase: alpha-2 is fully
  merged into `main`, so no release-line commits travelled with it.
- **PRD**: `docs/development/prd/flow-test-runs.prd.md`
- **ADR**: `docs/development/adr/048-flow-test-sessions-and-seeded-context.adr.md`
- **Depends on**: ADR-006 (flow/session schema), ADR-007 (session-scoped
  LangGraph), `015-flow-versioning-snapshots` (the published/draft split),
  `026-operator-confirmed-step-completion`, ADR-018 (approver resolution —
  overridden under test), `ai_usage_events` (per-call cost and tokens, already
  recorded — but **no duration column**, see step 9)

## 1. Problem

`StartSession` refuses anything unpublished
(`packages/application/src/use-cases/session/start-session.ts:31`), so the only
way to exercise a flow is to publish it to real operators. Testing one step is
not merely awkward but impossible: a step's prompt is built from
`gatheredContext`, which `GetSessionForTurn` aggregates across the session's
prior assistant turns (`get-session-for-turn.ts:77`), so a mid-flow step has no
behaviour until every step before it has been played through by hand.

See the PRD for full detail.

## 2. Goals

- Run an **unpublished draft** end to end from the canvas, in a modal, without
  publishing and without leaving the screen.
- Run **one step** with prior-step data simulated, seeing the reply, the
  readiness-gate outcome and any generated document.
- Seed from a **cloned real session**, a **saved hand-edited fixture**, or an
  **AI-generated** proposal.
- Report per-step cost, tokens, latency, turns to advance, confidence trajectory
  and gate outcome.
- Test sessions are invisible to every production listing, dashboard and
  approver queue.

## 3. Non-goals

Assertions / pass-fail automation, CI or scheduled runs, concurrent test sessions
on one flow, run diffing, mocked-model determinism, extraction-flow testing.
(PRD §4.)

## 4. Approach

Per ADR-048. A test run is an **ordinary session** carrying `mode = "test"`; the
seed is **materialised as ordinary rows** (synthetic assistant messages carrying
`GatheredContextItem[]`, plus `app_session_step_outputs` rows) before the first
turn. `run-turn`, `evaluate-step-readiness`, `buildSystemPrompt` and the stream
route are therefore **unchanged** — they read a session that looks like one that
genuinely reached node N.

A whole-flow run is the same mechanism started at the root with an empty seed.

Build strictly bottom-up (domain → application → adapters → web), writing the
test file before each implementation file (`CLAUDE.md`).

## 5. Key entities / files

| Layer | File | Change |
|-------|------|--------|
| domain | `packages/domain/src/entities/session.ts` | add `SessionMode = "live" \| "test"`; `mode` on `Session` and `NewSession` (optional; absent reads `"live"`) |
| domain | `packages/domain/src/entities/flow-test-fixture.ts` | new — `FlowTestFixture` (carrying `createdByUserId`), `NewFlowTestFixture`, `TestSeedSource`, `SeedStepOutput` |
| domain | `packages/domain/src/entities/flow-test-report.ts` | new — `FlowTestStepReport`, `FlowTestRunReport` |
| domain | `packages/domain/src/entities/flow-test-seed.ts` | new — `validateSeedAgainstNodes(seed, nodes)`: pure, returns accepted items + rejects with reasons |
| domain | `packages/domain/src/ports/seed-proposer.ts` | new — `ISeedProposer.propose(...) -> Result<SeedProposal>` |
| domain | `packages/domain/src/ports/flow-test-fixture-repository.ts` | new — `listByFlow`, `findById`, `create`, `update`, `delete`; every read takes the requesting user id, since a fixture is visible only to its creator |
| domain | `packages/domain/src/ports/session-repository.ts` | add `mode` filter to `SessionListPageOptions`; document the default as `"live"` |
| application | `packages/application/src/use-cases/session/start-session.ts` | accept `mode`, `startNodeId?`; when `mode === "test"` skip the published guard, resolve from **live rows**, set `flowVersionId: null` |
| application | `packages/application/src/use-cases/flow-test/start-test-run.ts` | new — authorise (owner/admin), start the session, materialise the seed, return the session |
| application | `packages/application/src/use-cases/flow-test/build-seed-from-session.ts` | new — clone gathered context + step outputs from a real session up to a node |
| application | `packages/application/src/use-cases/flow-test/generate-seed.ts` | new — `ISeedProposer` + `validateSeedAgainstNodes`; reports rejects, never substitutes silently |
| application | `packages/application/src/use-cases/flow-test/get-test-run-report.ts` | new — assemble `FlowTestRunReport` from sessions, messages, step outputs, `ai_usage_events` |
| application | `packages/application/src/use-cases/flow-test/delete-test-session.ts` | new — author-scoped delete; refuses a `live` session outright |
| application | `packages/application/src/use-cases/flow-test/sweep-test-sessions.ts` | new — retention sweep (30 days), driven by the existing scheduler (ADR-019); honours by-session legal holds and per-batch caps |
| application | `packages/application/src/use-cases/approvals/suggest-approver.ts` | under `mode === "test"`, resolve the approver to the initiating author — a real row, so the approval path is genuinely exercised |
| adapters | `packages/adapters/src/db/schema/wayfinder.ts` | `app_sessions`: `mode text not null default 'live'`; rebuild `app_sessions_user_id_created_at_idx` as `(user_id, mode, created_at)` and `app_sessions_flow_id_idx` as `(flow_id, mode)`; new `app_flow_test_fixtures` |
| adapters | `packages/adapters/drizzle/0044_*.sql` | migration, `-- data-impact: preserved` |
| adapters | `packages/adapters/src/repositories/drizzle-session-repository.ts` | map `mode`; apply the `mode` predicate on `listByUser`, `listAll`, `listByUserPage`, `listAllPage` |
| adapters | `packages/adapters/src/repositories/drizzle-analytics-repository.ts` | predicate on `listSessions` and `listSessionsByFlow`; predicate on `listMessagesByFlow` (already joins `app_sessions`); **add a join** to `listAssistantMessages`, which today reads `app_session_messages` alone |
| adapters | `packages/adapters/src/repositories/drizzle-session-step-output-repository.ts` | **add a join** to `listByFlow` — filters on `flow_id` only today, and feeds `GetFlowDeepDive`'s field report with seeded rows |
| adapters | `packages/adapters/src/repositories/drizzle-approval-repository.ts` | exclude test sessions from approver queues |
| adapters | `packages/adapters/src/repositories/drizzle-schedule-run-repository.ts` | exclude test sessions from `listRecent`, the admin-facing run history. **Not** `drizzle-schedule-repository.claimDue` — filtering due-schedule selection would break testing a scheduled node |
| adapters | `packages/adapters/src/repositories/drizzle-flow-test-fixture-repository.ts` | new — reads scoped to `created_by_user_id`, so a fixture is visible only to its creator |
| adapters | `packages/adapters/src/ai/ai-seed-proposer.ts` | new — `generateObject`, temp 0, `purpose: "test-seed"`, output sanitised to the declared fields |
| web | `apps/web/src/server/routers/flow-test.ts` | new — `start`, `report`, `delete`, `listSeedableSessions`, `generateSeed`, `fixture.{list,create,update,delete}` |
| web | `apps/web/src/components/canvas/flow-test-modal.tsx` | new — near-full-screen modal, two panes |
| web | `apps/web/src/components/canvas/flow-test-seed-editor.tsx` | new — seed source picker + editable values |
| web | `apps/web/src/components/canvas/flow-test-step-report.tsx` | new — per-step metrics pane |
| web | `apps/web/src/components/canvas/*` (toolbar, node menu) | **Test** actions; node menu opens the modal pre-scoped to that step |
| web | `apps/web/src/lib/container.ts` | wire `ISeedProposer`, the fixture repository and the new use-cases |
| e2e | one new Playwright spec | the streamed transcript reaching the DOM (policy group 2) and the document downloading from a seeded step (group 3); everything else about the modal is a component test |
| root | `validate.sh` | new check: fail if the diff against the base branch touches `run-turn`, `evaluate-step-readiness`, `buildSystemPrompt` or the stream route |

## 6. Implementation steps (test-first per CLAUDE.md)

1. **Domain — types and the pure seed validator.** Add `SessionMode` and `mode`;
   add the fixture, report and seed entities. Write
   `flow-test-seed.test.ts` **first**: (a) a seed whose values match each prior
   node's `TemplateField` types validates; (b) a value violating a field type is
   returned as a reject with a reason, not dropped; (c) a seed referencing a node
   absent from the draft is rejected; (d) an empty seed is valid (whole-flow
   run). Then implement. Domain stays dependency-free.

2. **Application — start a test run.** Write `start-session.test.ts` cases
   first: (a) `mode: "test"` on a `draft` flow succeeds; (b) `mode: "live"` on a
   draft still fails `VALIDATION_FAILED` (unchanged); (c) a test run resolves
   nodes/edges from the **live rows** and sets `flowVersionId: null`, even when a
   published version exists; (d) `startNodeId` sets `currentNodeId` to that node;
   (e) a caller without edit rights on the flow gets `FORBIDDEN`. Then implement.

3. **Application — materialise the seed.** Write `start-test-run.test.ts`
   first: (a) the seed writes assistant messages whose gathered-context items
   round-trip through `aggregateGatheredContext` **with no change to that query**;
   (b) step-output rows are created for each seeded prior node in the existing
   `StepOutputField[]` shape; (c) rejects from `validateSeedAgainstNodes` are
   returned and their values are not written; (d) an empty seed writes nothing.
   Then implement.

4. **Application — clone and generate.** `build-seed-from-session.test.ts`:
   copies gathered context and step outputs up to the chosen node, and copies
   **nothing else** (no documents, approvals or messages beyond the synthesised
   context). `generate-seed.test.ts`: proposer output is validated before it is
   offered, invalid values are reported, a proposer error degrades to an empty
   seed via Result rather than a throw.

5. **Adapters — schema, migration, mapping.** Add `mode` and
   `app_flow_test_fixtures`; rebuild the two `app_sessions` indexes as
   `(user_id, mode, created_at)` and `(flow_id, mode)`. No standalone `(mode)`
   index — the column reads `'live'` for almost every row, so the planner would
   ignore it. Generate the migration with `-- data-impact: preserved` (the
   column is defaulted and the index rebuilds carry no rows). Repository test
   asserts `mode` round-trips and that pre-existing rows read back as `"live"`.

6. **Adapters — the isolation predicate.** This is the phase's principal risk;
   cover it exhaustively. Apply `mode = 'live'` across **five** repositories,
   with a test per read path:
   - `drizzle-session-repository`: `listByUser`, `listAll`, `listByUserPage`,
     `listAllPage`
   - `drizzle-analytics-repository`: `listSessions`, `listSessionsByFlow`,
     `listMessagesByFlow` — all three already reference `app_sessions`
   - `drizzle-analytics-repository.listAssistantMessages`: **needs an
     `app_sessions` join added first.** It reads `app_session_messages` alone,
     and the seed materialises synthetic *assistant messages* — so without the
     join every dashboard fed by it counts test data. A predicate on its own
     does nothing here.
   - `drizzle-session-step-output-repository.listByFlow`: **also needs a join
     added.** It filters on `flow_id` only and feeds `GetFlowDeepDive`'s field
     report, which the PRD names explicitly as a surface that must exclude test
     sessions. `GetFlowDeepDive` is its only production caller, so adding the
     predicate in the repository costs nothing elsewhere.
   - `drizzle-approval-repository`: approver queue reads
   - `drizzle-schedule-run-repository.listRecent`: the admin-facing run history.
     Leave `drizzle-schedule-repository.claimDue` alone — it selects due rows
     from `app_session_schedules`, and filtering it would make a scheduled node
     untestable.

   Each test seeds one `live` and one `test` session and asserts only the live
   one is returned. `findById` deliberately keeps returning test sessions — the
   modal needs it — so authorisation, not the predicate, guards that path.

   The two joins above are the lesson of this step: the seed's whole mechanism
   is that it writes *ordinary* message and step-output rows, so any aggregate
   over those tables sees test data whether or not it knows `app_sessions`
   exists. A read path added later must be checked against that, not just
   against the session table.

7. **Adapters — seed proposer.** `ai-seed-proposer.test.ts`: output is
   constrained to the declared field keys, invented keys are dropped, temp 0 and
   the Langfuse purpose are set, a provider failure returns
   `AI_PROVIDER_FAILED` as a Result.

8. **Application — approvals under test.** Test first: an approval node reached
   in a `mode = "test"` session resolves the approver to the initiating author,
   and no approval row appears in any real supervisor's queue. The row is real,
   not simulated — the point is that row creation, notification suppression,
   decision handling and signature all run. Then implement.

9. **Application — report, delete, sweep.** `get-test-run-report.test.ts`
   asserts per-step cost/tokens/turns/confidence/gate outcome assembled from
   `ai_usage_events` and session rows.

   **Latency has no column.** `ai_usage_events` records tokens and `cost_usd`
   but no duration, and none is added here. Derive per-turn latency from message
   timestamps: an assistant message's `created_at` minus that of the user
   message that provoked it. That covers the whole server-side turn — model
   call, tool loop, document generation — which is the number an author tuning a
   step wants. Test it against fixed timestamps so the assertion is exact.

   `delete-test-session.test.ts` asserts a `live` session can never be deleted
   through this path. Wire the sweep to the existing scheduler; it stays its own
   use-case rather than a `RETENTION_TARGETS` entry, because that registry is
   keyed by table with a whole-table timestamp policy and cannot express "rows
   where `mode = 'test'`" — but it must still honour by-session legal holds and
   per-batch caps, as `ApplyRetentionPolicies` does.

10. **Web — tRPC.** Add `flowTest.*`, all author-gated. Reuse the existing
    `canEditFlow` helper (`apps/web/src/server/routers/flow.ts`) rather than
    re-deriving owner/admin — flow permissions already carry group and
    organisation visibility, and a hand-rolled check will drift from them.
    Router tests cover the authorisation boundary on every procedure, including
    that a fixture is unreadable by anyone but its creator.

11. **Web — UI.** The modal at approximately `max-w-[92vw] h-[88vh]` (against
    `max-w-3xl` for `NodeConfigModal`, `node-config-modal.tsx:464`): left pane
    run setup (scope, seed source, editable values), right pane the live
    transcript under a persistent **TEST** banner plus the step report. The
    banner also states that an approval under test was resolved to the author.
    The fixture save dialog warns that cloned values may carry real session
    data. Canvas toolbar and node-menu actions. Closing returns to the canvas
    with position intact.

12. **E2E.** One Playwright spec, covering only what a browser can see per
    `docs/guides/e2e-test-policy.md`: the streamed transcript reaching the DOM
    (group 2) and the generated document downloading from a seeded step
    (group 3). No `test.skip()` on a condition the test itself probes, no
    `isVisible()` for control flow. Everything else about the modal is a
    component test.

13. **Guard the untouched runner.** Add a `validate.sh` check that fails if the
    diff against `main` touches `run-turn`, `evaluate-step-readiness`,
    `buildSystemPrompt` or the stream route. This is what makes "the runner is
    unchanged" a fact rather than an intention.

14. **Version + validate.** Set `VERSION` and root `package.json#version` to
    `0.29.0`. Run `./validate.sh`; fix all failures. Move this doc to
    `docs/development/implemented/alpha-3/v0.29.0/` with an implementation
    summary.

## 7. Acceptance criteria

Mirror PRD §10. In particular:

- [ ] A draft flow can be test-run by its owner or an admin; nobody can start a
      *live* session on it.
- [ ] A test run resolves from the live rows, not `latestPublished`.
- [ ] The seed round-trips through `aggregateGatheredContext` with that query
      unchanged, and renders in `<gathered_context>`.
- [ ] `run-turn`, `evaluate-step-readiness`, `buildSystemPrompt` and the stream
      route are unchanged — enforced by the `validate.sh` guard from step 13.
- [ ] Seeds can be cloned, hand-edited and saved as a fixture, and re-run to
      produce a second run against identical inputs.
- [ ] A fixture is readable only by its creator, asserted at the repository; the
      save dialog warns that cloned values may carry real data.
- [ ] A generated seed's invalid values are reported, never silently substituted.
- [ ] A document step under test produces a downloadable file from seeded values.
- [ ] Per-step cost, tokens, turns, confidence and gate outcome are reported from
      `ai_usage_events` and session rows; latency is derived from message
      timestamps, with no duration column added.
- [ ] Test sessions are excluded from all five repositories' read paths, with a
      test per path — including the two that need an `app_sessions` join added
      before any predicate can apply.
- [ ] An approval under test creates a real row resolved to the author; the modal
      says so.
- [ ] Test sessions delete on demand and sweep after 30 days, honouring
      by-session legal holds; test spend counts against budgets and stays visible
      in usage reporting.
- [ ] The modal never navigates away from the canvas.
- [x] One Playwright spec covers the streamed transcript; nothing else about the
      modal is an e2e test. The seeded document download is **not** covered in a
      browser — no spec in this suite can reach a real generation — and stays
      covered at the adapter and application layers instead.
- [ ] `domain` dependency-free; ports in domain; Result at every boundary;
      `VERSION` = `package.json#version` = `0.29.0`; `./validate.sh` passes.

## 8. Risks / open questions

Carried from PRD §12:

- **Isolation is the principal risk.** A missed read path leaks an author's
  experiments into a customer's reporting. Step 6 enumerates five repositories;
  the review found two the first draft missed, both because they aggregate the
  seed's materialised rows without referencing `app_sessions` at all. Any new
  session read path — or any new aggregate over `app_session_messages` or
  `app_session_step_outputs` — must be added there too.
- **Approval divergence** is deliberate and is the one behaviour a test does not
  reproduce faithfully. Settled: a real row resolved to the author, so the
  mechanism runs; simulating a decision with no row was rejected because it
  would leave the approval path untested.
- **Cloned seeds carry real data** into a persisted fixture. Settled: fixtures
  are author-scoped and the save dialog warns. Redaction was rejected — it makes
  the seed unrealistic, which defeats cloning. Residual risk accepted.
- **Generated seeds can mislead** when a value violates a constraint; mitigated
  by validating before materialising.
- **Cost**: test runs spend real tokens. Settled: counted against budgets and
  visible in usage reporting. A dedicated test budget scope (ADR-031) is
  deferred as a governance change.
- **Retention** settled at 30 days — the product's first retention default of
  any kind, so a judgement call rather than a policy application.
- **Index rebuild**: the migration rebuilds two indexes on `app_sessions` rather
  than only adding one. Carries no rows, but it is the one part of the migration
  that is not purely additive.
- **Modal vs. route**: a modal keeps the author on the canvas as required, but a
  run cannot be deep-linked or shared. Accepted for this version.

## 9. Approved change summary

Recorded per the `/new-feature` lifecycle; approved 2026-08-11. Revised
2026-08-16 at `/doc-review`: version and line allocated (0.29.0 on
`main`), the isolation enumeration corrected from four repositories to
five, latency re-sourced to message timestamps, and the six open questions in §8
settled.

**Headline.** An author can run a draft flow — or a single step of it — from a
near-full-screen modal on the canvas, without publishing and without leaving the
screen. Prior-step data is simulated three ways: cloned from a real session,
hand-edited as a saved fixture, or AI-generated from the prior nodes' declared
fields. The seed materialises as ordinary rows, so the runner needs no changes at
all — a test session simply looks like a real one. It carries `mode = "test"`, is
excluded from every production listing and dashboard, and reports per-step cost,
latency, turns-to-advance and gate outcomes back into the modal.

- **Goal** — authors prove a flow works before publishing; today the only route
  is publish-and-run, and a mid-flow step cannot be exercised at all.
- **Business rules** — test runs pin to live rows, not the published snapshot;
  the published-only guard is bypassed for `mode = "test"` and edit rights only;
  test sessions never appear in production surfaces; approvals resolve to the
  author; sessions are disposable and swept.
- **UI** — near-full-screen modal over the canvas; left pane run setup, right
  pane live transcript plus step report.
- **Data** — `SessionMode`, `FlowTestFixture`, `TestSeedSource`,
  `FlowTestStepReport`, `ISeedProposer`.
- **Database** — additive `app_sessions.mode`, two index rebuilds folding `mode`
  into existing composites, and one new `app_` table; no change to messages or
  step outputs.
- **Risks** — the `mode = 'live'` predicate must reach every read path,
  including two aggregates that read the seed's rows without joining
  `app_sessions` at all;
  approval divergence; cloned seeds carrying real data; generated seeds
  misleading; real token spend.
- **Out of scope** — assertions, CI runs, concurrency, run diffing, replaying a
  live session against a modified draft.

## 10. Approved build summary

Approved at `/build` on 2026-08-16, after `/doc-review` settled the open
questions in §8. Recorded here so the plan the build followed is on the record.

Flow authors get a **Test** action on the canvas that runs an unpublished draft —
whole flow or a single mid-flow step — inside a near-full-screen modal, without
publishing and without leaving the canvas. Prior-step data is simulated by
writing ordinary assistant messages and step-output rows into a disposable
session marked `mode = "test"`, so the production runner executes unmodified and
simply sees a session that appears to have reached node N.

### Confirmed against the codebase before building

- `buildAggregateGatheredContextStatement`
  (`drizzle-session-message-repository.ts:66`) selects
  `ai_payload->'contextGathered'` from assistant messages with a non-null
  `step_node_id`, ordered by `seq`. A seeded row therefore needs
  `role = 'assistant'`, `step_node_id` set, and `ai_payload.contextGathered` as a
  JSON array — and the query itself needs no change, as ADR-048 claims.
- The retention worker runs in **`apps/api`**, not `apps/web`:
  `ApplyRetentionPolicies` is wired at `apps/api/src/container.ts:222`. The sweep
  wires in beside it, not in the web container that §5 names.

### Branch and PR target

Built on `claude/flow-test-runs-phase-review-vxgun0`, which is based on
`main`, with the PR raised against `main` — the line `CLAUDE.md` routes new
features to. The branch name is the session's own rather than `feature/<slug>`,
which is the one remaining departure from the `/build` skill. Version
**0.29.0**, MINOR.

### Build order

Nineteen sub-components, strictly bottom-up, `./validate.sh` green before each
next step: domain types and the pure seed validator (1–3); the application
use-cases for starting, seeding, cloning and generating (4–7); schema, migration
and the five-repository isolation predicate (8–11); the seed proposer (12);
approvals under test (13); report, delete and sweep (14); the tRPC router and
container wiring (15); the modal and its two panes (16–17); the `validate.sh`
guard and the Playwright spec (18); version, doc move and PR (19).
