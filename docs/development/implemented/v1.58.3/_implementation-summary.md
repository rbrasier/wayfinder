# v1.58.3 — Fix pre-generation gate: phantom document badge, duplicate follow-up, no-context skip

## Symptom

On a `generate_document` step, after the operator supplied the last detail:

- A **second assistant message** appeared that duplicated the first ("everything
  looks complete") instead of advancing or asking for anything.
- A **"Generating document — …" badge spun forever** with no error and no
  document ever produced.
- "Show Data" reported **no steps completed** — the session had not advanced.

## Root cause

The transcript was the pre-generation gate's **fail path**, not a pass. Two
independent defects combined:

1. **Phantom badge (frontend).** On the fail path the step stays the current node
   and no `generateDocument` runs, so `documentStatus` is never set. But
   `message-feed.tsx` inferred "advanced + generating" purely from *confidence ≥
   90 + last message on a doc node*, never checking whether the session actually
   left the step. The 95% follow-up was mis-classified as advancing, and
   `docState` fell through to `"generating"` — a badge that could never resolve.

2. **Confusing follow-up (backend).** `evaluate-step-readiness.ts` failed the
   gate on any confidence dip, **even with an empty `missingInformation` list**.
   The fail-path `streamGapFollowup` then had nothing concrete to ask and just
   re-confirmed "everything looks complete" — a pointless duplicate turn.

## Fix

1. **`apps/web/src/components/chat/milestone-state.ts` (new) + `message-feed.tsx`
   + `_content.tsx`:** extracted the milestone/badge decision into a pure,
   unit-tested `resolveMilestoneState`. It now requires `stepNodeId !==
   currentNodeId` — a step still held as the current node is not a completed
   milestone, so no pill and no phantom badge. `currentNodeId` is threaded from
   `_content.tsx`. This aligns the feed with the already-correct `completedNodeIds`
   / `hasGeneratingDoc` logic.

2. **`packages/application/src/use-cases/session/evaluate-step-readiness.ts`:** the
   gate now passes when `missingInformation` is empty, regardless of the
   confidence dip. The fail-path follow-up only fires when there are real gaps to
   surface; a step with nothing concrete outstanding advances quietly and
   generates its document.

3. **`apps/web/src/app/api/chat/[sessionId]/stream/readiness-gate.ts` (new) +
   `route.ts`:** extracted the gate-trigger condition into a testable
   `shouldEvaluateStepReadiness` helper and **skip the pre-generation cross-check
   when the flow has no context docs**. The gate grades the would-be document
   against the flow's guidance documentation; with no context docs there is
   nothing for the larger model to check, so the cheap model's threshold decides
   the advance on its own — no extra expensive calls, no cross-check indicator.

## Regression tests added

- `evaluate-step-readiness.test.ts` — a below-threshold confidence with an empty
  `missingInformation` list now passes (failed before the fix).
- `milestone-state.test.ts` (new) — a high-confidence turn still on the current
  node is not treated as advancing and shows no document badge; real advances,
  awaiting-confirmation, done/failed states covered.
- `readiness-gate.test.ts` (new) — the gate is skipped when the flow has no
  context docs (plus below-threshold / non-doc / templateless / never-done /
  confirmation-gated cases).
- `apps/web/e2e/fix-pre-generation-gate-phantom-doc-badge.spec.ts` (new) —
  end-to-end: an empty-gap confidence dip advances quietly and generates the
  document with no phantom "Generating document" badge and no duplicate turn.

## Validation

`./validate.sh` — all 15 checks pass (coverage thresholds met). Full unit suites:
web 180 passed, application 456 passed.

## Version

PATCH: `1.58.2` → `1.58.3` (bug fix, no schema change).
