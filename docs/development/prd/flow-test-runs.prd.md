# PRD — Flow Test Runs (Preview & Seeded Step Test)

- **Status**: Reviewed — `/doc-review` passed 2026-08-16
- **Date**: 2026-08-11
- **Author**: Solo / Claude Code
- **Target version**: **0.29.0** — **MINOR** (new feature + additive schema).
  Allocated at `/doc-review`; see §9 for the line it was allocated against.

## 1. Problem

A flow author has no way to run a flow before operators do. `StartSession`
requires `status === "published"`, so the only way to find out whether a step's
AI instruction, done-when criteria, template fields, skills and MCP tools behave
is to publish the flow to real people and watch a real session.

Testing a single step is worse than inconvenient — it is currently impossible. A
step's prompt is built from `gatheredContext`, which is aggregated across the
prior assistant turns of the same session, so a step in the middle of a flow has
no behaviour at all until every step before it has been played through by hand.
An author tuning step 7 replays six steps of conversation for each attempt.

For the persona this product is built around — a business analyst who writes no
code — this is the gap between authoring and guessing.

## 2. Users / Personas

- **Business Analyst / Policy Owner (Flow Owner)** — the primary user. Needs to
  iterate on one step's wording, fields and template quickly, and to prove the
  whole flow hangs together before publishing it to their organisation.
- **Admin** — needs the same on any flow, plus assurance that an author's
  experiments never reach operators, reporting, or an approver's queue.
- **Procurement Officer (operator)** — an indirect beneficiary. They should never
  see a test session, and should receive flows that have been exercised before
  they meet them.

## 3. Goals

- An author can run an **unpublished draft** flow end to end from the canvas,
  without publishing it and without leaving the screen.
- An author can run **a single step** with the prior steps' data simulated, and
  see the step's reply, its readiness gate outcome, and any generated document.
- Prior-step data can be **cloned from a real session**, **hand-edited and saved
  as a fixture**, or **AI-generated** from the prior nodes' declared fields.
- A saved fixture makes a step test **repeatable**, so it works as a regression
  check after a prompt or template change.
- Every test run reports **per-step cost, tokens, latency, turns to advance,
  confidence trajectory and gate outcome** back to the author.
- A test session is **invisible** to `/chats`, `/admin/sessions`, every dashboard,
  `GetFlowDeepDive`, and every approver's queue.

## 4. Non-goals

- **Assertions or pass/fail automation.** A run shows the author what happened;
  it does not grade it. Expectation-matching is a later feature.
- **Running tests in CI or on a schedule.** Test runs are author-initiated only.
- **Concurrent test sessions on one flow**, or multi-user test collaboration.
- **Diffing two runs** side by side.
- **Replaying a live session** against a modified draft.
- **Mocking the language model.** Test runs use the real provider and real
  tokens; determinism is not offered.
- **Testing extraction flows** (ADR-033). Guided flows only in this version.

## 5. Key entities

| Entity | Lives in | New / existing | Notes |
| ------ | -------- | -------------- | ----- |
| `SessionMode` | `packages/domain/src/entities/session.ts` | new | `"live" \| "test"`. Added to `Session` and `NewSession`; absent reads as `"live"`. |
| `FlowTestFixture` | `packages/domain/src/entities/flow-test-fixture.ts` | new | Saved, re-runnable seed: `{ id, flowId, name, startNodeId, gatheredContext, stepOutputs, createdByUserId }`. Visible only to its creator (§12). |
| `TestSeedSource` | `packages/domain/src/entities/flow-test-fixture.ts` | new | `"clone" \| "fixture" \| "generated"`. |
| `FlowTestStepReport` | `packages/domain/src/entities/flow-test-report.ts` | new | Per-node run metrics, assembled from `ai_usage_events` and session rows. |
| `ISeedProposer` | `packages/domain/src/ports/seed-proposer.ts` | new | AI-generated seed. `propose({ nodes, fields }) -> Result<SeedProposal>`. |
| `IFlowTestFixtureRepository` | `packages/domain/src/ports/flow-test-fixture-repository.ts` | new | `listByFlow`, `findById`, `create`, `update`, `delete`. |
| `GatheredContextItem` | `packages/domain/src/ports/session-message-repository.ts` | existing | The `{ key, value }` pairs a seed materialises onto synthetic assistant messages. |
| `StepOutputField` | `packages/domain/src/entities/session-step-output.ts` | existing | The seed's per-node field values. Reused unchanged — it is already the right shape. |

## 6. User stories

1. As a **flow owner**, I click **Test** on the canvas and run my unpublished
   draft from the first step, so I can see the flow work before anyone else does.
2. As a **flow owner**, I select one step, choose a seed, and run just that step,
   so I can tune its wording without replaying the six steps before it.
3. As a **flow owner**, I pick a real completed session and clone its data up to
   my step, so my test runs against realistic values rather than invented ones.
4. As a **flow owner**, I edit the seeded values by hand and save them as a named
   fixture, so I can re-run the same test after I change the prompt and see what
   my change did.
5. As a **flow owner** starting a brand-new flow with no sessions to clone, I ask
   for a generated seed, so I have plausible values to test against immediately.
6. As a **flow owner** testing a document step, I see the generated `.docx` and
   download it, so I can check the template filled correctly.
7. As a **flow owner**, I see what each step cost and how many turns it took, so
   I know which step to simplify.
8. As an **admin**, I open the dashboards and see no trace of anyone's test runs.

## 7. Pages / surfaces affected

- `/admin/flows/[id]` and `/flows/[id]/config` — a **Test** action on the canvas
  toolbar and on each node's context menu (the latter opens the modal
  pre-scoped to that step).
- **Flow Test modal** (new) — near-full-screen, opened over the canvas. The
  author never navigates away. Two panes: run setup on the left, live transcript
  and step report on the right.
- `/chats`, `/admin/sessions` — unchanged in appearance; both gain a
  `mode = 'live'` predicate so test sessions never list.
- `/admin/dashboards/*` — unchanged in appearance; all analytics reads gain the
  same predicate.
- tRPC: `flowTest.start`, `flowTest.report`, `flowTest.delete`,
  `flowTest.listSeedableSessions`, `flowTest.generateSeed`,
  `flowTest.fixture.{list,create,update,delete}` — all new, all author-gated.
- The existing chat stream route is **unchanged**; the modal drives it exactly as
  the operator UI does.

## 8. Database changes

| Table | Change | Prefix valid? |
| ----- | ------ | ------------- |
| `app_sessions` | add column `mode text not null default 'live'` | n/a |
| `app_sessions` | rebuild `app_sessions_user_id_created_at_idx` as `(user_id, mode, created_at)` | n/a |
| `app_sessions` | rebuild `app_sessions_flow_id_idx` as `(flow_id, mode)` | n/a |
| `app_flow_test_fixtures` | NEW — `id`, `flow_id`, `name`, `start_node_id`, `gathered_context jsonb`, `step_outputs jsonb`, `created_by_user_id`, `created_at`, `updated_at` | yes (`app_`) |

No standalone index on `(mode)`: the column reads `'live'` for almost every row,
so the planner would ignore it. The predicate is folded into the two existing
composite indexes that back the queries actually gaining it.

The `mode` column is additive with a default, so existing rows backfill to
`live`; the migration declares `-- data-impact: preserved`. Generated migration
only — never `drizzle-kit push`.

No change to `app_session_messages` or `app_session_step_outputs`: the seed
writes ordinary rows into them, which is the mechanism, not a workaround.

## 9. Architectural decisions

- **Introduces ADR-048** — flow test runs are real sessions with a materialised
  seed. Records the five decisions this PRD depends on: the `mode` discriminator
  rather than a parallel subsystem; seeding by materialising rows rather than
  overriding the runner; resolving the definition from live rows rather than the
  pinned published snapshot; repository-level isolation; and approval resolution
  short-circuiting to the author.
- **Assumes** `015-flow-versioning-snapshots` for the published/draft split,
  **ADR-007** (session-scoped LangGraph) and
  `026-operator-confirmed-step-completion` for the runner this feature
  deliberately does not touch, and **ADR-018** for the approver resolution it
  deliberately overrides under test. Where an ADR number is used twice in
  `docs/development/adr/`, it is cited here by filename.
- **Branch and version**: this builds on **`main`**, at version **0.29.0**, with
  the implemented doc landing in
  `docs/development/implemented/alpha-3/v0.29.0/` — the routing `CLAUDE.md`
  specifies for a new feature.

  It was built on `release/alpha-2` first, at the requester's direction, and
  moved to `main` before review. The version is unaffected: `main` already
  carries 0.28.4 after the alpha-2 forward-merge, so a MINOR bump lands on
  0.29.0 either way.

## 10. Acceptance criteria

- [ ] An author can start a test run of a flow whose `status` is `draft`; a
      non-author cannot, and neither can anyone start a *live* session on it.
- [ ] A test run resolves nodes and edges from the **live rows**, not
      `latestPublished`; an unpublished edit is visible in the run.
- [ ] A whole-flow run starts at the root node with an empty seed and behaves
      identically to a live session from the operator's point of view.
- [ ] A step test starts at the selected node with `currentNodeId` set to it and
      the seed materialised as assistant messages plus step-output rows.
- [ ] `aggregateGatheredContext` returns the seeded items with **no change to its
      query**, and `buildSystemPrompt` renders them in `<gathered_context>`.
- [ ] `run-turn`, `evaluate-step-readiness`, `buildSystemPrompt` and the stream
      route are unchanged — enforced by a `validate.sh` check that fails if the
      diff against the base branch touches any of those four paths, not by
      reviewer intent.
- [ ] A seed can be cloned from a real session up to a chosen node; the clone
      copies gathered context and step outputs and nothing else.
- [ ] A seed can be edited and saved as a named `FlowTestFixture`, re-loaded, and
      re-run, producing a second run against identical inputs.
- [ ] A fixture is readable only by the user who created it — asserted against
      the repository, not the router — and the save dialog warns that cloned
      values may carry real session data.
- [ ] A generated seed returns values that satisfy each prior node's declared
      field types; values that do not are reported, not silently substituted.
- [ ] A document step under test generates a downloadable file from the seeded
      field values.
- [ ] The step report shows cost, prompt/completion tokens, turns to advance,
      confidence trajectory, gate pass/fail and `missingInformation`, sourced
      from `ai_usage_events` and session rows.
- [ ] The step report shows per-turn latency, derived from message timestamps —
      an assistant message's `created_at` minus that of the user message that
      provoked it. `ai_usage_events` carries no duration column and none is
      added.
- [ ] Test sessions are excluded from `/chats`, `/admin/sessions`, every
      dashboard, `GetFlowDeepDive` and approval queues — **one test per read
      path**, with the predicate applied in the repository. The enumerated paths
      are those in the phase doc's step 6, and they include the two reads that
      need a session join added before a predicate can apply
      (`listAssistantMessages`, `SessionStepOutput.listByFlow`).
- [ ] An approval node under test resolves to the testing author; no approval row
      reaches a real supervisor's queue, and the modal states that it was
      substituted.
- [ ] A test session can be deleted by its author, and is swept after the
      retention window.
- [ ] Test-run token spend is attributed and visible; it is not exempt from
      budgets.
- [ ] The modal renders at approximately `max-w-[92vw] h-[88vh]` and the canvas
      is never navigated away from; closing it returns the author to the canvas
      with their position intact.
- [ ] One Playwright spec covers the two behaviours the e2e policy reserves for a
      browser: the streamed transcript reaching the DOM (group 2) and the
      generated document downloading from a seeded step (group 3). Everything
      else about the modal is a component test.
- [ ] Architecture boundaries intact — `domain` dependency-free, ports in domain,
      Result at every boundary. `VERSION` matches `package.json#version` at
      `0.29.0`; `./validate.sh` passes.

## 11. Out of scope / future work

- Assertions, expected-output matching and a pass/fail verdict per run.
- Test runs in CI, on a schedule, or as a pre-publish gate.
- Comparing two runs side by side.
- Deterministic/mocked model responses for reproducible runs.
- Test coverage for extraction flows (ADR-033).
- Promoting a fixture into a shipped starter flow — depends on flow portability
  (`flow-portability.prd.md`).
- Author-facing flow analytics as a standalone surface; this feature produces the
  per-step data such a surface would aggregate.

## 12. Risks / open questions

- **The isolation predicate is the principal risk, and it remains open-ended.**
  Every session read path must exclude `mode = 'test'`, and a missed path leaks
  an author's experiments into a customer's reporting. The `/doc-review` sweep
  found two paths the first draft missed, both because they read the materialised
  seed rows without touching `app_sessions` at all — a predicate is not enough,
  the join has to be added. Mitigated by enforcing at the repository and
  requiring a test per path; the phase doc enumerates the call sites. Any session
  read path added later must be added there too.
- **Approval divergence.** Settled: a test creates a real approval row resolved
  to the initiating author, so the approval mechanism is genuinely exercised
  (row, notification suppression, decision, signature) with the author standing
  in for the supervisor. The modal states the substitution. Simulating a decision
  with no row was rejected — it would leave the approval path the one thing a
  test never runs.
- **Cloned seeds carry real data.** Settled: fixtures are visible only to their
  creator, and the save dialog warns that cloned values may carry real data.
  Redaction was rejected for this version — a redacted value no longer exercises
  the step realistically, which is the whole reason to clone one. The residual
  risk is a persistent author-scoped store of real values, bounded by nothing
  except the author deleting it.
- **Generated seeds can mislead.** A value that violates a field constraint makes
  a sound step look broken. Mitigated by validating against `TemplateField` types
  before materialising and reporting rejects.
- **Cost visibility.** Settled: test spend counts against budgets and stays
  visible in usage reporting like any other spend. A dedicated test budget scope
  (ADR-031) was considered and deferred — it is a governance change, not a
  testing one.
- **Retention default.** Settled at 30 days: long enough that a fixture-driven
  regression check still has its prior run to compare against, short enough to
  bound row growth. It is the product's first retention default of any kind, so
  it is a judgement call rather than a policy application.
- **Modal vs. route.** A near-full-screen modal keeps the author on the canvas as
  required, but a long run cannot be deep-linked or shared. Accepted for this
  version; a shareable read-only test-run view is a candidate follow-up.
