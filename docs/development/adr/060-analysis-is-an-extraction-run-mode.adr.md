# ADR-060 — Analysis Is an Extraction Run Mode, Not a New Aggregate

- **Status**: Proposed (scoped by `auto-analyse-synthesis.prd.md`)
- **Date**: 2026-09-15
- **Builds on**: `033-extraction-flows.adr.md` (run aggregate, batch engine, cost ceiling —
  cited by filename because a second, unrelated ADR-033 exists),
  ADR-059 (Auto Analyse writes into the draft field set)

## Context

Auto Analyse needs to survive the user navigating away. A person uploads documents, the analysis
starts, and they may close the tab before it settles; when they come back the fields should be
there. That makes it background work with a persisted status, not a request/response.

Wayfinder already has exactly one piece of machinery for user-initiated background work over
uploaded documents, and it is not the job registry. `job_registry` tracks the health of *scheduled*
jobs, not a user's own in-flight task. The thing that does is the extraction run aggregate:

```typescript
export type RunMode = "sample" | "full";

export type RunStatus =
  | "running"
  | "paused_preview"
  | "paused_cap"
  | "complete"
  | "partial"
  | "cancelled";
```

— `packages/domain/src/entities/extraction-run.ts`

It already carries everything an analysis needs: a per-flow row, a status a poller can read,
live counts, an accrued `costUsd` the worker checks against the ceiling before each claim, and a
cancellation path. `AdvanceBatchRuns` already claims work with `SKIP LOCKED` and contains failures
so one stuck run never stalls the engine.

There is one obstacle, and it is real:

```typescript
flow_version_id: uuid("flow_version_id")
  .notNull()
  .references(() => app_flow_versions.id, { onDelete: "restrict" }),
```

— `packages/adapters/src/db/schema/wayfinder.ts`

A run is pinned to the flow version whose schema it ran against, so results can always be read back
against the shape that produced them. An analysis has no such version. `SaveExtractionSchema` is
what creates the open draft, and `parseExtractionSchema` refuses a field set with no fields — so at
the exact moment Auto Analyse fires, a brand-new synthesis has no draft version to point at. The
analysis is the thing that will *cause* the first one to exist.

## Decision

**1. Analysis is a third `RunMode`, on the existing aggregate.**

`RunMode` gains `"analyse"`. No new table, no new repository port, no second worker. An analysis run
is an `app_extraction_runs` row like any other, and inherits the cost ceiling, the status vocabulary
and the cancellation path unchanged.

**2. `flow_version_id` becomes nullable, and null means "this run predates the schema".**

This is the honest encoding. An analysis run genuinely is not pinned to a version, because its
output is what the first version will be built from. Inventing an empty placeholder version to
satisfy the constraint would be worse: it would put a fieldless snapshot into the version history
that every snapshot reader would have to learn to skip.

Non-analysis runs keep the invariant. `"sample"` and `"full"` still require a version, enforced in
the use case rather than by the column, and the phase doc asserts that in tests.

**3. Analysis does not use the document and record tables.**

An analysis produces a field set, not records. It writes no `app_extraction_documents` and no
`app_extraction_records` rows. The documents it reads are the existing
`app_extraction_draft_documents`, read in place. `totalCount` and `doneCount` track documents
analysed so the UI can show progress; `failedCount` and `unreadableCount` carry their usual meaning.

**4. The unit of work is the run, not the document.**

Every other run mode is map-shaped: N independent documents, each its own claimable row, each
retried on its own. An analysis is map-reduce — read up to `MAX_ANALYSE_DOCUMENTS` documents, then
make **one** proposal call over all of them — and the reduce step is the whole point. Split across
per-document claims it would have nowhere to live.

So `AdvanceBatchRuns` gains an analyse branch that claims the **run** as a single unit of work and
performs the read and the proposal inside it. This is what makes an analysis durable: the claim is
what a worker picks up after a restart, and it is where `033-extraction-flows.adr.md` §9's ceiling
check goes. Without it
an analysis would have no claimable work at all, the ceiling would never be consulted, and nothing
outside the originating request would ever advance the run — which is the whole reason the run
aggregate was reused.

A run-level claim is a real trade, and this ADR takes it knowingly:

- **No per-document retry.** One unreadable document does not cost the analysis its other reads,
  but a failure partway through discards the reads already done and the whole claim is retried.
  Acceptable because the read phase is cheap relative to the proposal call, and bounded at ten.
- **The ceiling is checked once, before the claim, not between documents.** A run that starts under
  the ceiling can finish over it. The exposure is one analysis, bounded by `MAX_ANALYSE_DOCUMENTS`;
  the alternative (re-checking mid-claim) buys a tighter bound at the cost of abandoning a
  half-finished analysis, which is worse for a pass whose expensive step comes last.

**5. The terminal statuses keep their existing meanings.**

`complete` means fields were drafted. `partial` means some documents could not be read but a field
set was still produced from the rest. `cancelled` means the user turned Auto Analyse off or removed
the documents mid-flight. The preview-boundary pause is not used — an analysis run has nothing to
preview, so `previewBoundary` stays 0.

## Consequences

- The migration is one line — `ALTER COLUMN flow_version_id DROP NOT NULL` — and is non-destructive:
  every existing row keeps its value. `mode` is plain `text` with no check constraint (verified in
  `0038_careful_quentin_quire.sql`), so adding `"analyse"` needs no SQL at all.
- Every existing reader of `ExtractionRun.flowVersionId` must handle null. This is the main cost of
  the decision and the phase doc audits each call site explicitly rather than trusting the compiler
  to find them all.
- `AdvanceBatchRuns` gains a branch, not an exclusion (§4). It must not send an analyse run down the
  document-claim path — one has no document rows, and a claim loop that assumes otherwise would
  settle it instantly as complete with zero work done — but it must still claim and advance it.
- Durability is a property of the deployment, not of this ADR. The batch worker runs in `apps/api`
  behind `EXTRACTION_WORKER_ENABLED`; `apps/web` has none and advances runs through the
  client-polled `tick` procedure. Where no worker runs, an analysis advances only while a tab is
  open, exactly as a sample run does today. The PRD states this as a constraint rather than
  pretending otherwise.
- Analysis spend is visible in the same place as every other run's spend, and subject to the same
  ceiling, which is the main thing this reuse buys.
- Runs listed in the flow's run history will include analyses unless filtered. The phase doc
  excludes `"analyse"` from `listRuns`, since a user looking at run history means extraction runs.
