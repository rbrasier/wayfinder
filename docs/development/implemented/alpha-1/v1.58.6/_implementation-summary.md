# v1.58.6 — Fix document-generation step flow (premature next step & missing terminal document)

## Symptom

Two follow-ons from the recent document-generation work, on a
`generate_document` step with a policy context doc:

1. **The next step opened while the document was still generating.** After a step
   crossed the threshold, the "Generating document" loading appeared but the
   session *concurrently* opened the next step, instead of waiting for the
   document.
2. **The final (terminal) step cross-checked fine but never progressed.** On the
   last step the cross-check passed and the assistant said "all done", but no
   document was rendered and the step was never shown as complete ("Show Data"
   confirmed nothing was recorded).

## Root cause

Both trace to `applyAdvanceSideEffects` (`turn-helpers.ts`) firing document
generation **fire-and-forget** (`void generateDocument(...)`):

1. **Bug 1** — the opener (`generateInitialMessage`) ran concurrently with the
   un-awaited generation, so the next step appeared before the document existed.
2. **Bug 2 (part 1)** — advancing into a terminal node only flips
   `session.status` to `complete`; there is no next-step opener, so on the
   terminal path the function fired the generation and returned immediately. With
   nothing awaiting it, the turn ended before the generation could persist the
   document.
3. **Bug 2 (part 2)** — advancing into a terminal node also leaves
   `currentNodeId` on the final node, so the terminal message keeps `stepNodeId
   === currentNodeId`. `resolveMilestoneState` treats any message still on the
   current node as *not advanced* (the guard added for the gate's fail path), so
   the "Step complete" pill and document card never rendered.

## Fix

1. **Await generation before opening the next step** (`turn-helpers.ts`) —
   `applyAdvanceSideEffects` now `await`s `generateDocument` (instead of `void`)
   before `generateInitialMessage` and before the terminal-path return. This
   orders the opener after the document (bug 1) and guarantees the terminal
   document persists before the turn ends (bug 2, part 1).
2. **Keep the loading feedback during the wait** — `applyAdvanceSideEffects`
   takes an optional `onDocumentGenerationChange(active)` callback; the stream
   route (`route.ts`) wires it to a transient `{ type: "generating-document",
   active }` message annotation, mirroring the v1.58.5 cross-checking badge. A new
   `resolveGeneratingDocumentState` resolver and `GeneratingDocumentBadge` render
   a "Generating document…" badge while generation is awaited.
3. **Render the terminal milestone** — `resolveMilestoneState` gains
   `isSessionComplete`; when the session is complete the `stepNodeId !==
   currentNodeId` guard is relaxed so the terminal step renders its "Step
   complete" pill and document card (bug 2, part 2). `MessageFeed` passes it from
   its existing `isComplete` prop.

## Regression tests added

- `milestone-state.test.ts` — a completed session renders the terminal step's
  milestone despite `stepNodeId === currentNodeId`; still suppressed while the
  session is active (gate fail path).
- `generating-document-state.test.ts` (new) — latest annotation wins; inactive
  with none; ignores unrelated annotations.
- `turn-helpers.test.ts` — `applyAdvanceSideEffects` awaits generation before the
  opener (deferred-promise ordering), and toggles the generating-document signal
  true→false around generation. The obsolete fire-and-forget test was removed.
- `apps/web/e2e/fix-document-generation-step-flow.spec.ts` (new, /e2e skill) —
  the "Generating document…" badge shows and the next step only appears once the
  document exists; the terminal step renders its document and completes.

## Validation

`./validate.sh` — all 15 checks pass.

## Version

PATCH: `1.58.5` → `1.58.6` (bug fix, no schema change).
