# Enhancement — remove Synthesise "Publish"; full runs version themselves

- **Requested**: 2026-09-23
- **Base branch**: `release/alpha-2`
- **Version**: 0.28.23 → **0.28.24** (PATCH — no schema change, no migration)
- **Source issue**: #303 (kept open — sharing is deferred, not answered here)
- **Relates to**: ADR-033 (extraction flows: versioning/publishing reused from
  guided flows, §3 snapshot union, §6 sample vs full runs), ADR-015 (flow
  versioning)

## What is being asked for

Issue #303 asks what **Publish** on the "Edit synthesis" screen should do —
share, lock, or feed the knowledge base — and, until that is settled, whether
the button should be hidden rather than shown permanently disabled.

Maintainer decision (2026-09-23): **remove the button; sharing is not ready for
this feature.** Full runs must keep working without it.

## What is true today

- The button (`editor-cards.tsx`) is hard-coded `disabled`. Nothing calls
  `extraction.publish`, the tRPC procedure that would promote the draft.
- `StartBatchRun.execute` (a full run — "Start run" on the Runs page) loads
  `flowVersions.latestPublished` and rejects with *"Publish the extraction flow
  before running a full batch."* when there is none. With no way to publish,
  **every full run of a never-published synthesis fails.** The Runs page even
  says "Requires a published synthesis."
- Samples (`startSample`) run against the open draft version and are unaffected.
- `createPublished` promotes the open draft row **in place** (status →
  `published`, next `version_number`). Afterwards there is no open draft until
  the next Save; `GetExtractionSchema` already falls back to the latest
  published version, and "Run sample" always saves first, so both cope.
- The `/synthesise` list renders a `flow.status` badge. `extraction.publish`
  never touched `flow.status`, so every synthesis reads "DRAFT" forever.

## Decision

### 1. A full run resolves its own version

`StartBatchRun.execute` replaces `loadPublishedSchema` with a two-step
resolution:

1. **Before intake** — confirm a runnable schema exists: an open draft with an
   extraction snapshot, else the latest published extraction version. Neither →
   `VALIDATION_FAILED` *"Save the synthesis before running a full batch."*
2. **After intake passes** (files gathered, non-empty, within `maxFiles`) —
   if the schema came from the open draft, promote it with
   `flowVersions.createPublished({ flowId, snapshot: draft.snapshot,
   publishedByUserId: userId, changeSummary: null })` and write the audit entry
   `flow.version.published` with `metadata.trigger = "batch_run"` (same action
   and `versionId`/`versionNumber` metadata `PublishFlowVersion` writes). The
   run pins the promoted version's id.
   If it came from the latest published version, pin that id — **no new
   version**.

Promoting only after intake means a rejected upload never mints a version.
A version is minted only when the author has saved since the last full run, so
history grows with edits, not with runs.

`StartBatchRun` gains a required `IAuditLogger` constructor argument (before the
optional `options`). `IAuditLogger` is a domain port, so the application-layer
boundary holds. It does not depend on `PublishFlowVersion`: that use case needs
node/edge repositories the extraction module does not have, and its extraction
arm is exactly "promote the open draft snapshot" — reimplementing that one call
is smaller than widening the module's dependencies.

### 2. The Publish button and its procedure go

- Remove the button and its comment from `editor-cards.tsx`.
- Remove `extraction.publish` from `apps/web/src/server/routers/extraction.ts`
  — its only consumer was the button (no-dead-code rule). Guided-flow
  publishing (`flow.update` with `status: "published"`) is untouched.

### 3. Copy and badge

- Runs page: drop "Requires a published synthesis."; keep "Preview turns on by
  default above 5 files."
- `/synthesise` list (`extraction-list.tsx`): remove the status badge. Without
  publishing or sharing the status carries no user meaning. `status` is dropped
  from `ExtractionFlowRow` and from wherever that row is built, if nothing else
  reads it.

## Out of scope

- Sharing / visibility for synthesis, running someone else's synthesis (the
  ADR-033 "ops user" case) — #303 stays open for it.
- A synthesis version-history UI.
- `flow.status` for extraction flows (left as `draft`).

## Tests (written before implementation)

`packages/application/src/use-cases/extraction/start-batch-run.test.ts`
(`StartBatchRun.execute`):

- open draft present → `createPublished` called with the draft snapshot and the
  initiating user; audit `flow.version.published` logged with
  `trigger: "batch_run"`; run pinned to the promoted version id.
- no draft, published present → no `createPublished`, no audit; run pinned to
  the published id.
- neither → `VALIDATION_FAILED` "Save the synthesis"; no run created.
- draft present but files exceed `maxFiles` (or none supplied) → rejected and
  `createPublished` **not** called.

`batch-engine.test.ts`: the fake version repository gains `openDraft` (null),
the constructor call sites gain the audit logger, and the "refuses without a
published version" case asserts the new message.

**No e2e** — the behaviour is owned by `packages/application` and none of the
six `e2e-test-policy.md` groups apply; the button removal is a static render
change.

## Files

- `packages/application/src/use-cases/extraction/start-batch-run.ts` (+ tests)
- `packages/application/src/use-cases/extraction/batch-engine.test.ts`
- `apps/web/src/lib/container-extraction.ts`
- `apps/web/src/server/routers/extraction.ts`
- `apps/web/src/components/extraction/editor-cards.tsx`
- `apps/web/src/components/extraction/extraction-list.tsx` (+ its row builder)
- `apps/web/src/app/(user)/synthesise/[id]/runs/_content.tsx`
- `VERSION`, `package.json`

## Risks

- A Save made while a full run is being *started* races the promotion; the
  adapter does the promotion in a transaction on the single open draft, so the
  run pins whichever snapshot was promoted. Saves after promotion open a new
  draft and never touch the pinned version.
- An in-flight **sample** run pinned to the draft row keeps that row id after
  promotion; the row's snapshot is rewritten with the identical draft snapshot,
  so the sample's schema is unchanged.
