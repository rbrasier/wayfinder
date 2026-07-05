# Bug fix — Pre-generation gate: phantom "Generating document" badge and confusing duplicate follow-up

## Symptom

On a `generate_document` step, after the operator supplies the last piece of
information:

1. A **second assistant message** appears that duplicates the first ("everything
   looks complete") instead of introducing the next step or asking for anything.
2. A **"Generating document — …" badge spins forever**, with no error in the
   logs and no document ever produced.
3. "Show Data" reports **no steps completed** — the session never advanced.

## Reproduction

1. Run a flow whose current step is a `generate_document` node with a template.
2. Answer the chat until the cheap model reports high confidence (≥ the node's
   `advanceConfidenceThreshold`), triggering the pre-generation evaluation gate.
3. Have the gate return a **confidence just below the threshold with an empty
   `missingInformation` list** (a common grader outcome when nothing is
   genuinely wrong).

Observed: the step is held, a bland "looks complete" follow-up is streamed, and
the chat shows a permanent "Generating document" pill.

## Root cause (verified)

This is the **gate-fail path** in `apps/web/src/app/api/chat/[sessionId]/stream/route.ts`
(lines 387–435), not a passed check. Two independent defects combine:

### A. Phantom badge (the blocker) — frontend

On the fail path the step stays the **current** node and **no** `generateDocument`
call is dispatched, so `documentStatus` is never set. But
`apps/web/src/components/chat/message-feed.tsx` derives `isAdvancingMsg` purely
from *confidence ≥ 90 + this being the last message on a doc node* — it never
checks whether the session actually left the step. The 95%-confidence follow-up
is therefore mis-classified as "advanced + generating", and `docState` falls
through to `"generating"` because `documentStatus` is null and no document
exists. The pill can never resolve because nothing is generating.

`_content.tsx`'s own `hasGeneratingDoc` (which drives the poll) *already*
excludes `stepNodeId === currentNodeId`; `message-feed.tsx` was simply
inconsistent with it.

### B. Confusing duplicate follow-up — backend

`packages/application/src/use-cases/session/evaluate-step-readiness.ts` fails the
gate whenever either alignment confidence is below the threshold, **even when the
grader lists no concrete missing information**. On such a failure
`streamGapFollowup` has nothing actionable to ask for and the cheap chat model
just re-confirms "everything looks complete" — a pointless second message that
contradicts the (invisible) hold. The gate exists to catch *actionable* gaps; a
pure-confidence dip with an empty `missingInformation` list should not hold the
step.

## Fix plan

1. **Frontend (`message-feed.tsx` + `_content.tsx`):** thread `currentNodeId`
   into `MessageFeed` and require `msg.stepNodeId !== currentNodeId` for
   `isAdvancingMsg`, so a step still held as the current node shows no milestone
   pill and no document badge. This aligns the message feed with the existing
   `completedNodeIds` / `hasGeneratingDoc` logic.

2. **Backend (`evaluate-step-readiness.ts`):** treat the gate as **passed when
   `missingInformation` is empty**, regardless of the confidence dip. The
   fail-path follow-up then only fires when there are real gaps to surface, and a
   step with nothing concrete outstanding advances quietly and generates its
   document.

3. **Backend (`readiness-gate.ts` + `route.ts`):** extract the gate-trigger
   condition into a testable `shouldEvaluateStepReadiness` helper and **skip the
   pre-generation cross-check entirely when the flow has no context docs**. The
   gate grades the would-be document against the flow's guidance documentation;
   with no context docs there is nothing for the larger model to check, so the
   cheap model's threshold decides the advance on its own (no extra expensive
   calls, no phantom cross-check).

## Regression guards

- Unit: `evaluate-step-readiness.test.ts` — a below-threshold confidence with an
  empty `missingInformation` list now passes.
- Unit: `message-feed` — no document pill / milestone is rendered for a
  high-confidence assistant message whose `stepNodeId` is still the current node.
- Unit: `readiness-gate.test.ts` — the gate is skipped when the flow has no
  context docs (and for below-threshold / non-doc / templateless / never-done /
  confirmation-gated steps).
- E2E: `apps/web/e2e/fix-pre-generation-gate-phantom-doc-badge.spec.ts` —
  reproduces the empty-gap fail scenario and asserts no stuck "Generating
  document" badge.

## Version

PATCH: `1.58.2` → `1.58.3` (bug fix, no schema change).
