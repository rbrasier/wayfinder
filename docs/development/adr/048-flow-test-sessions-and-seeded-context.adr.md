# ADR-048 — Flow Test Runs Are Real Sessions With a Materialised Seed

- **Status**: Proposed (scoped by `flow-test-runs.prd.md`)
- **Date**: 2026-08-11
- **Builds on**: ADR-006 (flow/session schema), ADR-007 (session-scoped
  LangGraph), `015-flow-versioning-snapshots` — the published/draft split this
  depends on, `026-operator-confirmed-step-completion`, ADR-018 (approval step
  and approver resolution — the one runtime behaviour a test must not reproduce
  faithfully)

  Two of these numbers are used twice in `docs/development/adr/`, so 015 and 026
  are cited by filename rather than by number alone.

## Context

A flow author has no way to exercise a flow before operators do. `StartSession`
refuses anything unpublished:

```typescript
if (flowResult.data.status !== "published") {
  return err(domainError("VALIDATION_FAILED", "Flow is not published."));
}
```

— `packages/application/src/use-cases/session/start-session.ts:31`

So the only way to see whether a step's `aiInstruction`, `doneWhen`, template
fields, skills and MCP tools behave is to publish the flow to real operators and
run a real session. For the persona the product is built around — a business
analyst who writes no code — that is the difference between authoring and
guessing.

Testing a *single* step is harder still, and the reason is structural rather
than a missing button. A conversational step's prompt is assembled from
`gatheredContext`:

```typescript
const gatheredBlock = gatheredContext.trim()
  ? `\n  <gathered_context>\n    ${gatheredContext.trim()}\n  ...`
```

— `packages/adapters/src/agents/flow-session-graph.ts:41`

and that string is not stored anywhere. It is aggregated in SQL across every
prior assistant turn of the session:

```typescript
this.sessionMessages.aggregateGatheredContext(sessionId)
```

— `packages/application/src/use-cases/session/get-session-for-turn.ts:77`

A step in the middle of a flow therefore has no meaningful behaviour in
isolation. Step 7 is defined partly by what steps 1–6 gathered. "Test one step"
and "simulate the steps before it" are not two features; the second is the
precondition that makes the first exist.

The same is true of document generation, which is where authoring actually
hurts. `EvaluateStepReadiness` extracts a template's field values and grades
them before generation is allowed. Its input is not a conversation but a set of
values — so the useful test of a document step is "here are field values, show
me the rendered `.docx`", which a whole-flow replay is a very slow way to reach.

Three ways to build this present themselves, and the choice determines whether
the harness tests the product or tests a copy of it.

## Decision

### 1. A test run is an ordinary session carrying `mode = "test"`

`Session` gains `mode: SessionMode` where `SessionMode = "live" | "test"`, backed
by `app_sessions.mode text not null default 'live'`. Absent reads as `"live"`, so
every existing row and fixture is unchanged.

There is no parallel session table, no shadow runner, and no second execution
path. A test session is created by the same repository, advanced by the same
`run-turn`, gated by the same `evaluate-step-readiness`, and rendered by the same
chat components as a live one.

This is the whole point. A harness that runs a *reimplementation* of the runner
tells the author nothing about the flow they are about to publish — it tells them
about the harness. The only test worth having is the production path, run against
disposable data.

### 2. The seed materialises as ordinary rows; the runner is untouched

To test node N with prior context, the seed is **written into the test session**
before the first turn:

- synthetic assistant messages carrying `GatheredContextItem[]` for the prior
  nodes, so `aggregateGatheredContext` returns them with no change to its query
- `app_session_step_outputs` rows for the prior nodes, in the existing
  `StepOutputField[]` shape
- `currentNodeId` set to the node under test

No `seedOverride` is threaded through `GetSessionForTurn`, `BuildSystemPromptInput`
or the stream route. Those read a session that is, as far as they can tell,
a session that genuinely reached node N.

Two consequences fall out for free. Cloning a seed from a real session becomes a
row copy up to node N rather than a translation layer. And a whole-flow run is
not a separate mode at all — it is a test session started at the root node with
an empty seed. One mechanism, two entry points.

### 3. A test run resolves its definition from the live rows

`StartSession` pins a live chat to `latestPublished` so later edits never move an
in-progress session (ADR-015). A test run inverts this deliberately: it resolves
nodes and edges from the **live rows**, which are the working draft the author is
editing, and sets `flowVersionId` to null.

Testing the published snapshot would test the thing the author already shipped.
The unpublished edit is the thing under test.

The published-only guard is bypassed for `mode = "test"` only, and only for a
caller with edit rights on that flow (owner or admin). A test run of a draft is
not a way for an operator to reach an unpublished flow.

### 4. Isolation is enforced at the repository, not at the router

Every production read of sessions — `/chats`, `/admin/sessions`, the dashboards,
`GetFlowDeepDive`, approval queues — must exclude `mode = 'test'`. That predicate
belongs in the repository query, not in each caller.

Usage attribution is the deliberate exception, and Decision 6 explains why: test
spend is real spend and stays visible everywhere spend is reported.

Two of these reads do not currently touch `app_sessions` at all, and a predicate
alone will not fix them — the seed materialises ordinary message and step-output
rows, so the join has to be added first:

- `DrizzleAnalyticsRepository.listAssistantMessages` selects from
  `app_session_messages` with no session join (its sibling `listMessagesByFlow`
  has one).
- `DrizzleSessionStepOutputRepository.listByFlow` filters on `flow_id` only, and
  feeds `GetFlowDeepDive`'s field report.

Indexing follows the predicate rather than the column: a standalone index on a
column that reads `'live'` for almost every row earns nothing, so `mode` is
folded into the two existing composite indexes that back the filtered queries.

Filtering in routers would be correct on the day it shipped and wrong the first
time someone adds a read path — and the failure mode is a customer's dashboard
quietly reporting an author's experiments as production activity. Test-only
surfaces opt *in* explicitly rather than production surfaces opting out.

### 5. Approval nodes under test resolve to the testing author

`ApproverSourceMode` resolves a real supervisor from the directory (ADR-018). A
test run must never place an approval in a real person's queue, so under
`mode = "test"` the resolver short-circuits to the author running the test.

This is the one place the harness knowingly diverges from production behaviour,
and the divergence is visible in the modal rather than silent. The alternative —
faithfully paging a supervisor because someone pressed Test — is not a trade-off
worth having.

### 6. Test sessions are disposable, and their spend is real

Test sessions can be deleted on demand and are swept after a retention window
(default 30 days). They consume real tokens against real budgets: the run's cost
is read back from `ai_usage_events` and shown per step in the modal. Making test
spend invisible would make it unbounded — so it is neither exempt from budget
enforcement nor filtered out of usage reporting. This is the exception noted in
Decision 4.

`ai_usage_events` carries tokens and `cost_usd` but **no duration**, so per-step
latency is derived from message timestamps — an assistant message's `created_at`
minus that of the user message that provoked it. That measures the whole
server-side turn (model call, tool loop, document generation), which is the
number an author tuning a step actually wants. No column is added for it.

The sweep is its own use-case rather than a `RETENTION_TARGETS` entry, because
that registry is keyed by table with a whole-table timestamp policy and cannot
express "rows where `mode = 'test'`". It still honours the two guards that
registry provides: by-session legal holds and per-batch caps.

## Alternatives considered

**A separate sandbox runner (in-memory, no persistence).** Rejected: it is a
second implementation of the turn loop that will drift from the real one, and
every drift is a test that passes while production fails. It also cannot exercise
document generation, step outputs or approvals without reimplementing those too.

**Threading a `seedOverride` through the read paths.** Rejected: it changes
`GetSessionForTurn`, `BuildSystemPromptInput` and the stream route, so the code
under test is no longer the code that runs in production — the branch only taken
during tests is precisely the branch tests cannot cover. Decision 2 gets the same
result with no production-path change at all.

**A parallel `app_test_sessions` table.** Rejected: messages, step outputs,
documents and approvals all carry `session_id` foreign keys, so a parallel
session table needs a parallel everything, or nullable dual FKs on five tables.
A discriminator column on one table achieves the same isolation.

**Filtering test sessions at the tRPC layer.** Rejected — see Decision 4.

**Requiring publication to a "staging" flow instead.** Rejected: it makes every
test a publish, doubles the flows an admin sees, and still cannot start a session
at node N.

## Consequences

**Good**

- The harness tests the production path, because it *is* the production path.
- Step-level testing, whole-flow preview and "clone this real session as a
  fixture" are one mechanism rather than three features.
- Zero change to `run-turn`, `evaluate-step-readiness`, `buildSystemPrompt` or
  the stream route — the risk of this feature breaking live sessions is close to
  the risk of adding a column.
- Per-step cost and latency come from `ai_usage_events`, which already exists, so
  the author-facing flow analytics gap starts closing here.

**Bad / accepted**

- Every session read path acquires a `mode` predicate, and a missed one leaks
  test data into production reporting. Mitigated by placing the predicate in the
  repository and requiring a test per read path; it remains the feature's
  principal risk.
- Test sessions occupy the same tables as live ones, so a heavy tester adds rows
  to `app_session_messages` and `app_session_step_outputs`. Bounded by the
  retention sweep.
- Approval behaviour under test is deliberately not production behaviour.
- A seed cloned from a real session copies real, possibly personal data into a
  saved fixture — a privacy surface that did not previously exist. Bounded rather
  than removed: a fixture is visible only to the user who created it, and the
  save dialog warns that cloned values may carry real data. Redaction was
  rejected for this version because a redacted value no longer exercises the step
  realistically, which is the entire reason to clone one.
