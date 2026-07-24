# Bug Fix: a sample run is created but never processes

## Symptom

Starting a sample from the Synthesise Information editor navigates to the run
screen, but nothing ever happens:

- The progress bar sits at `0 of N documents processed` with status `running`
  indefinitely.
- No error is shown; every request returns 200.
- The run screen polls `extraction.runStatus` every 2s forever, because
  `running` is a live status and the counts never change.

The user's dev log shows exactly this shape — `extraction.startSample` 200,
the run page compiles and renders, then an unbounded sequence of identical
`extraction.runStatus` 200s with no other extraction traffic in between. There
is no `extraction.tick`-style call and no worker activity, because neither
exists on that path.

Severity: **blocker** — sample runs, the primary authoring loop for
Synthesise Information, never produce output.

## Reproduction

1. Boot the stack locally with `pnpm dev` and a default `.env` (i.e. without
   `EXTRACTION_WORKER_ENABLED=true`, which `.env.example` does not mention).
2. Open a Synthesise Information flow, upload one or more input documents, and
   save a schema.
3. Click **Run sample**.
4. The browser lands on `/synthesise/<flowId>/runs/<runId>`.
5. The progress bar stays at `0 of N`, status `running`, forever.

## Root Cause (verified)

Two independent defects stack; either alone is enough to stall the run.

### 1. Nothing advances the run in the web app

`extraction.startSample` (`apps/web/src/server/routers/extraction.ts:461`)
delegates to `StartBatchRun.startSample`
(`packages/application/src/use-cases/extraction/start-batch-run.ts:135`), which
creates the run row (status `running`), stores the documents as `pending`, and
seeds the records — and then returns. Starting a run deliberately does no
extraction work; that is the batch engine's job (ADR-033 §6).

The only thing that ever advances a run is `AdvanceBatchRuns`, driven by
`ExtractionWorker` in `apps/api`. In the web app, `AdvanceBatchRuns` **is**
constructed (`apps/web/src/lib/container-extraction.ts:99`) but no router,
route handler, or component ever calls it — dead wiring. So with the API
process absent, misconfigured, or simply slow to start, the run has no engine
at all.

### 2. The batch worker is off by default and undocumented

`EXTRACTION_WORKER_ENABLED` (`apps/api/src/env.ts:93`) is
`z.string().optional().transform((value) => value === "true")` — an unset
variable yields `false`, so `apps/api/src/index.ts:51` never starts the poller.
`.env.example` does not mention `EXTRACTION_WORKER_ENABLED` or
`EXTRACTION_TICK_MS` at all, so a developer following the documented setup
gets a stack where extraction runs can never progress, with no signal that a
flag is missing.

The opt-in default made sense while the batch engine was dark-launched
(v2.13.0). Now that sampling is the primary authoring loop and runs through the
same durable engine (v2.16.0, "unify sample into a durable run"), off-by-default
means the feature is broken out of the box.

### Secondary: the run screen gives no processing signal

Even once processing works, `run-progress.tsx` renders a static bar with no
spinner, so a run mid-batch is visually indistinguishable from a stalled one.
The block is also tall — a 4-row stack of header, 12px bar, meta row, and
full-size buttons — for what is a status strip.

## Fix Plan

1. **Expose a single-run advance.** Make `AdvanceBatchRuns.advanceRun` public
   as `advanceOne(runId)`. `execute()` keeps looping every claimable run for
   the worker; `advanceOne` lets a caller advance exactly one run without
   touching anyone else's.
2. **Add `extraction.tick`.** A `runProcedure` mutation that asserts the run is
   editable by the caller (same `assertRunEditable` gate as the other run
   controls) and calls `advanceOne`. Document claiming already uses
   `FOR UPDATE SKIP LOCKED`, so a tick racing the background worker is safe —
   whoever claims a document first processes it.
3. **Drive it from the run screen.** While the run is `running`, `RunProgress`
   fires one tick at a time (never overlapping), refreshing the status after
   each. The loop stops on its own when the run leaves `running`
   (`paused_preview`, `paused_cap`, `complete`, `partial`, `cancelled`), and
   stops after a failed tick so a persistent error cannot become a hot loop.
4. **Enforce the cost ceiling on the web path too.** The web app's
   `AdvanceBatchRuns` is built without `resolveCostCeilingUsd`, so a
   browser-driven tick would bypass the admin per-run spend cap that the worker
   honours. Pass the resolver through `buildExtractionModule`.
5. **Turn the worker on by default** so long runs continue with the browser
   closed: `EXTRACTION_WORKER_ENABLED` defaults to `true` and is disabled only
   by an explicit `false`. Document both extraction env vars in `.env.example`.
6. **Compact the progress area and add the chat spinner.** Extract the SVG
   spinner from `chat/milestone-pill.tsx` into a shared
   `components/ui/spinner.tsx` (identical markup, so the run screen shows the
   exact same icon as document generation), use it in the status line while the
   run is live, and tighten the block: single status row, slimmer bar, inline
   meta, small buttons.
7. **Regression tests** (written before the fix):
   - `batch-engine.test.ts` — `advanceOne` advances only the named run and
     leaves another claimable run untouched.
   - `run-tick.test.ts` (web router) — `extraction.tick` advances the run and
     is refused for a caller who cannot edit the flow.
8. **Playwright e2e** — `fix-sample-run-never-processes.spec.ts`: the run
   screen exposes a live processing indicator and drives `extraction.tick`
   while the run is running; `tick` is ownership-gated.
9. PATCH bump `2.16.0 → 2.16.1`.

## Implementation Summary

- **Root cause:** nothing advanced a started run. `StartBatchRun.startSample`
  materialises the run and returns; the only engine is `AdvanceBatchRuns`,
  driven by `ExtractionWorker` in `apps/api`, which `EXTRACTION_WORKER_ENABLED`
  left **off** by default and `.env.example` never mentioned. The web app
  constructed `AdvanceBatchRuns` (`container-extraction.ts:99`) but never called
  it. So the run sat at `running`, `0 of N`, while the run screen polled
  `extraction.runStatus` every 2s forever.
- **Fix applied:**
  - `AdvanceBatchRuns.advanceRun` is now the public `advanceOne(runId)`;
    `execute()` still loops every claimable run for the worker.
  - New `extraction.tick` mutation (`apps/web/src/server/routers/extraction.ts`)
    — a run control gated by the same `assertRunEditable` check as
    cancel/retry/continue — advances exactly one run.
  - `run-progress.tsx` drives the tick while the run is `running`, one at a
    time, stopping on the first failure so a persistent error cannot become a
    hot loop. The decision is the pure `run-tick-state.ts` module, mirroring
    `chat/document-poll-state.ts`. `continue` and `retryFailed` clear the block
    so the operator can resume driving.
  - The web app's `AdvanceBatchRuns` now receives `resolveCostCeilingUsd` from
    the admin `ExtractionConfig`, so a caller-driven tick honours the same
    per-run spend cap as the worker (it previously had no ceiling at all).
  - `EXTRACTION_WORKER_ENABLED` defaults to **true** (`value !== "false"`), and
    both extraction env vars are documented in `.env.example`, so a long batch
    keeps progressing with the browser closed.
  - UI: the shared `components/ui/spinner.tsx` holds the SVG previously inlined
    in `chat/milestone-pill.tsx`, so the run screen shows the exact same
    spinner as chat document generation. The progress block is compacted —
    one status row (spinner + status + `x of y` + cost), a 1.5px bar, an inline
    meta/controls row with `sm` buttons — and its card padding tightened.
- **Regression tests:**
  - `packages/application/.../batch-engine.test.ts` — `advanceOne` advances only
    the named run (a second claimable run is untouched) and leaves a paused run
    alone. Verified failing before the fix
    (`advanceOne is not a function`), passing after.
  - `apps/web/src/server/routers/extraction-tick.test.ts` — `extraction.tick`
    advances the named run and is refused for a caller who cannot edit the
    flow. Verified failing before (`No procedure found on path
    "extraction.tick"`), passing after.
  - `apps/web/src/components/extraction/run-tick-state.test.ts` — the tick
    decision: drives a running run, never overlaps, stops when blocked, ignores
    paused/terminal statuses.
- **E2E test:** `apps/web/e2e/fix-sample-run-never-processes.spec.ts` asserts
  `extraction.tick` is routable (the pre-fix body carried "No procedure found on
  path", which is also a 4xx, so the assertion is on the body — not the status),
  that it is ownership-gated identically to `extraction.cancel`, and that the
  run screen renders its progress strip without crashing. Not executed in the
  authoring sandbox (no Postgres/MinIO/browser stack); it runs in CI.
- **Validation:** `./validate.sh` — all 19 checks pass.
- **Version:** PATCH bump `2.16.0` → `2.16.1`.
