# Implementation Summary — Flow Test Runs (v0.29.0)

- **Phase**: `flow-test-runs.phase.md` (this folder)
- **PRD**: `docs/development/prd/flow-test-runs.prd.md`
- **ADR**: `docs/development/adr/048-flow-test-sessions-and-seeded-context.adr.md`
- **Version**: 0.29.0 — MINOR (new feature + additive schema)
- **Base branch**: `main` (release line `alpha-3`)

## What was built

An author can run an unpublished draft — the whole flow, or one mid-flow step —
from a near-full-screen modal on the canvas, without publishing and without
leaving the screen. Prior-step data is simulated by writing ordinary assistant
messages and step-output rows into a session marked `mode = "test"`, so the
production runner executes unmodified and simply sees a session that appears to
have reached node N. Seeds come from a cloned real session, a saved fixture, or
an AI proposal validated against each node's declared field types. Test sessions
are excluded from every production listing, dashboard and approver queue, and
the modal reports per-step cost, tokens, latency, turns and gate outcome.

## Files created

**domain** — `entities/flow-test-fixture.ts`, `entities/flow-test-seed.ts`
(`validateSeedAgainstNodes`, `nodesPrecedingNode`), `entities/flow-test-report.ts`,
`ports/flow-test-fixture-repository.ts`, `ports/seed-proposer.ts`.

**application** — `use-cases/flow-test/`: `start-test-run.ts`,
`build-seed-from-session.ts`, `generate-seed.ts`, `get-test-run-report.ts`,
`delete-test-session.ts`, `sweep-test-sessions.ts`, plus `__fixtures__/`.

**adapters** — `repositories/drizzle-flow-test-fixture-repository.ts`,
`ai/ai-seed-proposer.ts`, `drizzle/0044_bizarre_gateway.sql`.

**web** — `server/routers/flow-test.ts`, `components/canvas/flow-test-modal.tsx`,
`flow-test-seed-editor.tsx`, `flow-test-step-report.tsx`,
`e2e/phase-flow-test-runs.spec.ts`.

## Files modified

`entities/session.ts` (`SessionMode`), `entities/flow.ts` (`canUserEditFlow`),
`ports/session-repository.ts`, `ports/usage-repository.ts`,
`use-cases/session/start-session.ts`, `use-cases/approvals/suggest-approver.ts`,
`db/schema/wayfinder.ts`, five repositories for the isolation predicate,
`drizzle-usage-repository.ts`, `apps/web` container/router/canvas wiring,
`apps/api/src/container.ts`, `validate.sh`.

## Migration

`0044_bizarre_gateway.sql`, `-- data-impact: preserved`. Adds
`app_sessions.mode text not null default 'live'` (existing rows backfill),
creates `app_flow_test_fixtures`, and rebuilds two `app_sessions` indexes as
`(user_id, mode, created_at)` and `(flow_id, mode)`. Not yet run against a
database in this environment — no Postgres was available — so it is generated
and reviewed but unapplied.

## Deviations from the approved plan

Four, each recorded at the point it was made:

1. **The isolation predicate reaches five repositories, not four.** `/doc-review`
   found two reads that aggregate the seed's materialised rows without
   referencing `app_sessions` at all — `AnalyticsRepository.listAssistantMessages`
   and `SessionStepOutputRepository.listByFlow`, the latter feeding
   `GetFlowDeepDive`'s field report. Both needed a join added before any
   predicate could apply.

2. **No temperature on the seed proposer.** The phase specified temperature 0.
   This codebase strips temperature in provider middleware because the Claude 5
   family rejects the parameter outright (`providers.ts`), so setting it would
   fail the call rather than make it deterministic. Determinism is a stated
   non-goal for test runs.

3. **`missingInformation` dropped from the step report.** `EvaluateStepReadiness`
   returns it to the turn that asked and nothing persists it, so it cannot be
   recovered after a run. Reporting it would mean writing gate outcomes down —
   a change to the runner this feature exists specifically not to make. Replaced
   with `advanced`, derived from the transcript.

4. **`IUsageRepository.listBySession` added.** `ai_usage_events` carries a
   session id but no node id, so per-step cost is not directly available. Each
   event is attributed to the step whose assistant turn first lands at or after
   it. Latency comes from message timestamps, as settled at `/doc-review`.

## Tests

Written before each implementation file. Domain 655, application 969, adapters
686, web 826 — all passing, with typecheck clean in every package.

The isolation guard is verified by mutation: removing the predicate from
`listAssistantMessages` fails `session-isolation.test.ts`, and restoring it
passes. Those tests capture the WHERE clause each repository method actually
builds and render it, so the assertion is that the predicate reaches the query
rather than that a helper exists.

`validate.sh` gains check 24, which fails if the diff against the base branch
touches `run-turn`, `evaluate-step-readiness`, `flow-session-graph` or the chat
stream route — making "the runner is unchanged" enforced rather than asserted.

## E2E

`apps/web/e2e/phase-flow-test-runs.spec.ts` covers policy **group 2** — the
streamed turn reaching the DOM inside the modal — and that closing the modal
returns the author to the canvas.

**Group 3 (file download) is not covered.** The first version of this spec
asserted a document download from a step with no template, so it could never
have passed; CI caught it. Reaching a real generation needs an uploaded
template, a server-side AI script returning field values complete enough to
pass the readiness gate, and the id of a session the modal creates and never
exposes to the DOM. No spec in this suite drives generation end to end for that
reason — the spreadsheet-templates spec mocks the upload at the network
boundary and asserts UI hints only. The coverage stays where it already is:
`DocxGenerator` adapter tests for generation, and `GetTestRunReport`'s
`documentFilename` test for a seeded run surfacing the file. The PRD criterion
"a document step under test produces a downloadable file from seeded values" is
therefore met below the browser but not asserted through one.

## Known limitations

- The migration has not been applied — no Postgres in the build environment.
  It is generated and reviewed, unapplied. (`./validate.sh` itself passes: its
  external-service checks are WARN-only by design.)
- Approval behaviour under test is deliberately not production behaviour: the
  approver resolves to the testing author.
- A run cannot be deep-linked or shared — accepted for this version.
- Fixtures persist real cloned data indefinitely, bounded only by author-scoped
  visibility and manual deletion.
- Both retention sweeps share one worker tick; a test-session sweep failure is
  reported only if the policy sweep succeeded.
- No e2e assertion that a document generated from seeded values downloads — see
  the E2E section above for why, and where that behaviour is covered instead.
