# Phase — Pre-Generation Evaluation Gate

- **Status**: Awaiting review
- **Target version**: 1.53.0  (bump: MINOR — new behaviour gating step advancement; no schema change)
- **PRD**: _none — small, well-bounded reorder of an evaluation we already run_
- **ADRs**: ADR-013 (auto-node structured data / `extractStructuredFields`),
  ADR-026 (operator-confirmed completion, the advance-suppression precedent),
  ADR-027 (document-generation budgets), ADR-016 (prompt-cache ordering)
- **Depends on**: the chat stream route and its `turn-helpers`
  (`stream/route.ts`, `turn-helpers.ts`), `run-turn.ts` advance/await logic,
  `GenerateDocument` and its `persistDocumentGrading` (`generate-document.ts`),
  the shared `extractStructuredFields` (`structured-fields.ts`), the
  `documentGenerationConfidence` grade and its schema (`confidence.ts`).

## 1. Problem

A `generate_document` step advances the instant the **cheap chat model's**
`stepCompleteConfidence` crosses the node threshold (`run-turn.ts:126`,
`stream/route.ts:261-274`). Only *after* the session has advanced does the
**high-quality document-generation model** ever look at the work: its grade is
produced by `persistDocumentGrading` *inside* `generateDocument`
(`generate-document.ts:141`, `:208`), which runs in `applyAdvanceSideEffects`
(`turn-helpers.ts:527`) — i.e. after `persistAssistantTurn` already advanced
(`route.ts:281`).

So the expensive evaluation is post-hoc audit metadata, never a gate. The user
can leave a step — and have a document generated — without the higher-quality
model ever confirming the completion criteria were actually met. If that model
would have disagreed with the cheap model, nobody finds out until it is too late
to ask the user for the missing information.

## 2. Goals

- **Reorder, don't re-architect.** Keep the cheap `stepCompleteConfidence` and
  its threshold exactly as today — they remain the *trigger*, nothing more.
- When the cheap model crosses the threshold on a `generate_document` step, run a
  **pre-generation evaluation** with the doc-gen model *before* advancing:
  extract the template fields, then grade the would-be field values against the
  flow guidance docs and the step's completion criteria.
- **Pass** (both grades ≥ the node's existing `advanceConfidenceThreshold`):
  advance and generate the document, **reusing the already-extracted field
  values** so generation does not re-run the extraction.
- **Fail**: do **not** advance. Append the evaluation's `missingInformation`
  items to the assistant message's `aiPayload.contextGathered` (clearly labelled
  as *outstanding*), and stream a follow-up assistant turn that asks the user
  about those gaps. Because the gaps now live in gathered context, the cheap
  model will not re-report ≥ threshold until the user supplies them — which is
  what self-rate-limits the expensive call.
- While the evaluation runs, surface a transient **"cross-checking"** loading
  indicator in the chat (same visual language as the doc-generation loading
  badge).
- **Always on.** No node toggle — this is pure reordering of an evaluation we
  already perform.

## 3. Non-goals

- No new config knob: no per-node toggle, no separate evaluation threshold (the
  eval reuses the node's `advanceConfidenceThreshold` as its pass bar).
- No change to `conversation_only` steps — nothing to evaluate against a
  template, so they advance exactly as today.
- No DB migration; the gaps ride the existing `aiPayload.contextGathered` jsonb.
- No persisted eval status: the "cross-checking" indicator is a live stream
  annotation only (the evaluation is a few seconds; on reload it has resolved).
- No hard retry/loop counter — the gathered-context mechanism is the limiter.
- No change to `requireConfirmation`, branching, scheduled/auto/approval nodes
  beyond honouring the new gate ordering.

## 4. Approach

The cheap turn streams as today. When its `stepCompleteConfidence ≥ realThreshold`
**and** the current node is `generate_document` with a template, the stream route
writes a `cross-checking` annotation and calls a new application use-case,
`EvaluateStepReadiness`, before deciding to advance:

1. **Extract** the template fields with the doc-gen model via the existing
   `extractStructuredFields` (`purpose: "documentGeneration"`) — byte-for-byte the
   same extraction `GenerateDocument` performs today.
2. **Grade** those field values with the doc-gen/grading model using the existing
   grading prompt (factored out of `persistDocumentGrading`), extended to also
   return a `missingInformation: string[]`.
3. **Decide**: `passed` when both `guidanceAlignmentConfidence` and
   `criteriaAlignmentConfidence` ≥ the node's `advanceConfidenceThreshold`.

On **pass**, the route proceeds exactly as today (`persistAssistantTurn` +
`applyAdvanceSideEffects`), but threads the extracted `fieldValues` into
`GenerateDocument`, which skips re-extraction and persists the eval's grade as the
message's `documentGenerationConfidence`. The now-redundant in-generation
`persistDocumentGrading` call is removed (one fewer expensive call).

On **fail**, the route calls `persistAssistantTurn` with advance suppressed
(`advanceThreshold = Infinity`, `requireConfirmation = false`, so it neither
advances nor parks awaiting confirmation), appends the `missingInformation` items
to the just-persisted assistant message's `contextGathered`, and generates +
streams a follow-up assistant turn seeded with those gaps so the user is asked
about them immediately.

`EvaluateStepReadiness` is wired through the container so the eval honours the
configured doc-gen model and the ADR-027 budgets. Build strictly bottom-up
(shared schema → application → web), writing the test file before each
implementation file (CLAUDE.md rule).

## 5. Key entities / files

| Layer | File | Change |
|-------|------|--------|
| shared | `packages/shared/src/schemas/confidence.ts` | add `preGenerationEvaluationSchema` = the two `documentGenerationConfidence` confidences + rationales **plus** `missingInformation: string[]` (each item a short, user-facing description of what is missing or wrong); export its inferred type |
| application | `packages/application/src/use-cases/document/structured-fields.ts` | factor the grading prompt currently inline in `persistDocumentGrading` into an exported `gradeDocumentFields(...)` helper (or co-locate a new `grade-document.ts`) returning the eval schema, so the gate and any post-gen use share one implementation |
| application | `packages/application/src/use-cases/session/evaluate-step-readiness.ts` | NEW `EvaluateStepReadiness`: input = `{ messages, flow, node, budget? }`; resolves fields (`resolveFields` parity), runs `extractStructuredFields` (`purpose: "documentGeneration"`), grades via the shared helper, returns `{ passed, guidanceAlignmentConfidence, criteriaAlignmentConfidence, guidanceAlignmentRationale, criteriaAlignmentRationale, missingInformation, fieldValues }`; `passed` = both confidences ≥ `node.config.advanceConfidenceThreshold` (normalised) |
| application | `packages/application/src/use-cases/document/generate-document.ts` | accept optional precomputed `fieldValues` on `GenerateDocumentInput` → skip the batch extraction when provided; accept an optional precomputed grade to persist as `documentGenerationConfidence`; remove the now-redundant internal `persistDocumentGrading` call when a grade is supplied |
| web | `apps/web/src/lib/container.ts` | construct + expose `useCases.evaluateStepReadiness` (doc-gen `ILanguageModel`, session-message repo as needed) |
| web | `apps/web/src/app/api/chat/[sessionId]/stream/route.ts` | when `outputType === "generate_document"`, a template is configured, and `stepCompleteConfidence ≥ realThreshold` and `!isNeverDone`: write the `cross-checking` annotation, run `evaluateStepReadiness`; branch pass/fail as in §4; on pass thread `fieldValues` + grade onward; keep the branch-choice call gated on an actual advance |
| web | `apps/web/src/app/api/chat/[sessionId]/stream/turn-helpers.ts` | thread optional `fieldValues` + grade through `applyAdvanceSideEffects` → `generateDocument`; add `appendShortcomingsToContext(messageId, items)` (merge into `aiPayload.contextGathered`, labelled outstanding) and `streamGapFollowup(...)` (generate + persist + stream a follow-up turn seeded with the gaps) |
| web | `apps/web/src/components/chat/message-feed.tsx` (+ small badge component) | render a transient **"Cross-checking…"** loading badge for the assistant message currently under evaluation, driven by the `cross-checking` stream annotation; mirror the doc-generation loading badge styling |

## 6. Implementation steps (test-first per CLAUDE.md)

1. **Shared — schema.** Write the schema test, then add
   `preGenerationEvaluationSchema` + inferred type to `confidence.ts`. Assert it
   accepts the two confidences/rationales and a `missingInformation` string array,
   and rejects out-of-range confidences.

2. **Application — grading helper.** Write tests for `gradeDocumentFields(...)`
   (prompt includes step criteria + guidance docs + field values; returns the eval
   schema; propagates model errors as Results). Extract it from
   `persistDocumentGrading` without changing the existing grade output shape.

3. **Application — `EvaluateStepReadiness`.** Write
   `evaluate-step-readiness.test.ts` first: (a) both grades ≥ threshold → `passed:
   true`, returns `fieldValues`; (b) one grade below threshold → `passed: false`
   with non-empty `missingInformation`; (c) extraction error → Result error
   (no grade call); (d) threshold normalised from a fraction
   (`normaliseAdvanceConfidenceThreshold` parity) so flow-authored `0.9` is treated
   as 90; (e) reuses `resolveFields` so an inline-fields node and a template-derived
   node behave identically. Then implement.

4. **Application — generation reuse.** Extend `generate-document.test.ts`:
   (a) when `fieldValues` are supplied, extraction is **not** called and the doc
   renders from them; (b) when a precomputed grade is supplied, it is persisted as
   `documentGenerationConfidence` and the internal grading call does **not** run;
   (c) legacy path (no `fieldValues`, no grade) behaves byte-for-byte as today.
   Then implement the optional inputs.

5. **Web — container + orchestration.** Wire `evaluateStepReadiness`. In the
   stream route, insert the gate: detect the `generate_document` + threshold
   condition, write the `cross-checking` annotation, run the eval, and branch:
   - **pass** → `persistAssistantTurn` (normal threshold) + `applyAdvanceSideEffects`
     with `fieldValues` + grade threaded through to `generateDocument`;
   - **fail** → `persistAssistantTurn` with `advanceThreshold = Infinity` and
     `requireConfirmation = false`; `appendShortcomingsToContext`; `streamGapFollowup`.
   Cover with route/helper tests: pass advances + generates without re-extraction;
   fail does not advance, appends gaps to `contextGathered`, and emits a follow-up
   message; a `conversation_only` step and a sub-threshold turn are unchanged.

6. **Web — UI indicator.** Render the transient "Cross-checking…" badge from the
   `cross-checking` annotation in `message-feed.tsx`, mirroring the doc-generation
   loading badge. It clears when the turn resolves (advance + doc badge takes over
   on pass, or the follow-up message arrives on fail).

7. **e2e.** `apps/web/e2e/enhance-pre-generation-evaluation.spec.ts`: drive a
   `generate_document` step to the threshold; with the eval stubbed to **fail**,
   assert no advance, a follow-up question referencing the gap, and the gap present
   in subsequent context; with the eval stubbed to **pass**, assert advance + a
   generated document and no duplicate extraction.

8. **Version + validate.** Bump `VERSION` and root `package.json#version` to
   `1.53.0`. Run `./validate.sh`; fix all failures. Move this phase doc to
   `docs/development/implemented/v1.53.0/` with an implementation summary naming the
   e2e test that covers the change.

## 7. Acceptance criteria

- [ ] Cheap `stepCompleteConfidence` + threshold unchanged (trigger only) —
      guarded by run-turn/route tests showing the sub-threshold path is identical.
- [ ] On a `generate_document` step crossing threshold, the doc-gen model
      evaluates **before** any advance or generation.
- [ ] **Pass** → advance + generate, with the document rendered from the
      already-extracted `fieldValues` (no second extraction) and the eval grade
      persisted as `documentGenerationConfidence`.
- [ ] **Fail** → no advance; `missingInformation` appended to the message's
      `contextGathered`; a follow-up assistant turn asks the user about the gaps.
- [ ] The expensive eval does not re-fire until the cheap model next crosses the
      threshold (i.e. only after the user supplies new information).
- [ ] A transient "Cross-checking…" indicator shows while the eval runs and clears
      on resolution; no persisted eval status, no migration.
- [ ] `conversation_only` steps, branching, scheduled/auto/approval nodes, and
      `requireConfirmation` behave as before (the gate only reorders the
      generate_document advance).
- [ ] Architecture boundaries intact (`domain` dependency-free; eval is an
      application use-case behind `ILanguageModel`; Result pattern at boundaries).
- [ ] `VERSION` = `package.json#version` = `1.53.0`; `./validate.sh` passes.

## 8. Risks / open questions

- **Hot-path edit.** The gate sits in the streaming `execute()` block; lock the
  pass/fail/sub-threshold paths with tests before editing, and ensure a thrown or
  failed eval **fails open** (advance as today) rather than wedging the step.
- **Fail-turn UX (resolved).** The threshold turn streams normally; a
  "Cross-checking…" badge then appears; on fail a follow-up message is appended
  (the user briefly sees the cheap model's "done"-ish reply before the
  correction). Accepted over deferring the reply, which would cost latency and
  drop token streaming on that turn.
- **Gap framing in `contextGathered`.** Items must be labelled as *outstanding /
  not yet provided* so the cheap model treats them as things to ask about, not as
  satisfied facts. Covered by an explicit key prefix and a route/helper test.
- **Added latency on the threshold turn.** One extraction + one grade on the
  doc-gen model before advancing. Mitigated by reusing the extracted fields for
  generation (so total expensive calls do not increase on a pass) and by the
  self-rate-limiting on fail.
- **Pathological non-convergence.** If the doc-gen model never reaches the bar,
  the step cannot auto-advance. The cheap-model gating limits expensive retries;
  if a hard escape valve is later wanted, it composes cleanly with the existing
  `requireConfirmation` Proceed path (out of scope here).
