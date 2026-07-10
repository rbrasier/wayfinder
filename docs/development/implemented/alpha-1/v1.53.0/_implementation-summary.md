# Implementation Summary — Pre-Generation Evaluation Gate (v1.53.0)

**Version bump:** MINOR (`1.52.2` → `1.53.0`) — new behaviour gating
`generate_document` step advancement; no DB schema change, no migration.

## What was built

A `generate_document` step previously advanced the instant the *cheap* chat
model's `stepCompleteConfidence` crossed the node threshold; the *high-quality*
doc-gen model only graded the work afterwards, as post-hoc audit metadata. This
phase reorders that evaluation into a **gate**: when the cheap model crosses the
threshold on a `generate_document` step, the doc-gen model now extracts the
template fields and grades them **before** the session advances.

- **Pass** (both `guidanceAlignmentConfidence` and `criteriaAlignmentConfidence`
  ≥ the node's existing `advanceConfidenceThreshold`): the step advances and the
  document is generated, **reusing the already-extracted field values** and the
  grade — so a pass adds no net expensive calls (extraction + grade replace the
  former post-generation grade).
- **Fail**: the step does **not** advance. The evaluation's `missingInformation`
  items are appended to the threshold turn's `aiPayload.contextGathered`, clearly
  labelled outstanding, and a follow-up assistant turn streams immediately to ask
  the user about the gaps. Because the gaps now live in gathered context, the
  cheap model will not re-report ≥ threshold until the user supplies them — which
  self-rate-limits the expensive evaluation.
- A transient **"Cross-checking…"** indicator shows in the chat while the gate
  runs, mirroring the document-generation loading badge.

The gate **fails open**: a thrown or errored evaluation advances exactly as
before, so it can never wedge a step. It is always on for `generate_document`
steps with a template; `conversation_only`, `requireConfirmation`, branching,
scheduled/auto/approval nodes, and the sub-threshold path are unchanged.

## Files created

- `packages/application/src/use-cases/document/field-resolution.ts` (+ test) —
  shared `resolveTemplateFields` / `batchTemplateFields` / `buildDocumentTranscript`
  helpers, extracted from `GenerateDocument` so the gate and generation resolve
  and batch fields identically.
- `packages/application/src/use-cases/document/grade-document.ts` (+ test) —
  `gradeDocumentFields(...)`, the grading prompt factored out of
  `persistDocumentGrading`, returning the pre-generation eval schema (the two
  confidences/rationales plus `missingInformation`).
- `packages/application/src/use-cases/session/evaluate-step-readiness.ts` (+ test)
  — `EvaluateStepReadiness`: resolves fields, extracts with the doc-gen model,
  grades via the shared helper, and decides `passed` against the normalised
  `advanceConfidenceThreshold`; returns the extracted `fieldValues` for reuse.
- `apps/web/e2e/enhance-pre-generation-evaluation.spec.ts` — Playwright e2e
  covering the pass (advance + document, no duplicate extraction, transient
  indicator) and fail (no advance, follow-up question, persisted gap) paths.

## Files modified

- `packages/shared/src/schemas/confidence.ts` (+ test) — added
  `preGenerationEvaluationSchema` (extends `documentGenerationConfidenceSchema`
  with `missingInformation: string[]`) and `PreGenerationEvaluationData`.
- `packages/application/src/use-cases/document/generate-document.ts` (+ test) —
  accepts optional precomputed `fieldValues` (skips extraction) and `grade`
  (persisted as `documentGenerationConfidence`, skipping the internal grading
  call); now uses the shared field-resolution helpers and `gradeDocumentFields`.
- `packages/application/src/use-cases/{document,session}/index.ts` — export the
  new modules.
- `apps/web/src/lib/container.ts` — construct + expose
  `useCases.evaluateStepReadiness`.
- `apps/web/src/app/api/chat/[sessionId]/stream/route.ts` — insert the gate:
  write the `cross-checking` annotation, run `evaluateStepReadiness`, and branch
  pass/fail; branch-choice is now computed lazily (only on an actual advance) and
  the extracted `fieldValues` + grade are threaded onward on a pass.
- `apps/web/src/app/api/chat/[sessionId]/stream/turn-helpers.ts` (+ test) —
  thread `precomputedDocument` through `applyAdvanceSideEffects` →
  `generateDocument`; added `appendShortcomingsToContext(...)` and
  `streamGapFollowup(...)`.
- `apps/web/src/components/chat/message-feed.tsx` &
  `apps/web/src/components/chat/milestone-pill.tsx` — render the transient
  `CrossCheckingBadge` from the `cross-checking` stream annotation.
- `VERSION`, root `package.json` — `1.53.0`.

## Migrations run

None. The outstanding gaps ride the existing `aiPayload.contextGathered` jsonb;
no persisted eval status.

## Tests / e2e

- Unit: shared schema (`confidence.test.ts`), `field-resolution.test.ts`,
  `grade-document.test.ts`, `evaluate-step-readiness.test.ts`, extended
  `generate-document.test.ts` (reuse paths), extended `turn-helpers.test.ts`
  (`appendShortcomingsToContext`, `streamGapFollowup`, precomputed-document
  threading). `./validate.sh` passes (15/15).
- e2e: `apps/web/e2e/enhance-pre-generation-evaluation.spec.ts` covers the
  pass and fail user-visible paths (driven by the `/e2e` MCP skill against a
  running stack; excluded from the vitest unit run).

## Known limitations

- The follow-up correction streams into the same response after the cheap
  model's threshold reply, so on a fail the user briefly sees the "done"-ish
  reply before the correction (accepted trade-off; preserves token streaming).
- No hard escape valve for a doc-gen model that never reaches the bar — the
  cheap-model gating limits expensive retries, and the existing
  `requireConfirmation` Proceed path composes cleanly if one is later wanted.
