# Fix document-generation step flow — premature next step & missing terminal document

## Symptoms

Two follow-on defects after the recent document-generation changes (v1.58.x), on
a `generate_document` step with a context (policy) doc:

1. **The next step opens while the document is still generating.** After a step
   crosses the threshold, the "Generating document" loading badge appears but the
   session **concurrently** opens the next step. It should wait until the
   document has been generated, then move to the next step.

2. **The final (terminal) step cross-checks fine but nothing progresses.** On the
   last step of the flow the cross-check passes, the assistant says "all done",
   but **no document is rendered** and the step is not shown as complete
   ("Show Data" confirms no progress).

## Root cause

### Bug 1 — fire-and-forget generation races the opener

`apps/web/src/app/api/chat/[sessionId]/stream/turn-helpers.ts`
(`applyAdvanceSideEffects`) fires document generation without awaiting it:

```ts
void generateDocument(container, milestone.id, ...);
// ...falls straight through to:
await generateInitialMessage({ ... }); // opens the NEXT step
```

The generation and the next-step opener run concurrently, so the opener (and the
advanced step rail) appear before the document is ready.

### Bug 2 — terminal step: orphaned generation + suppressed milestone

Advancing *into a terminal node* only flips `session.status` to `complete`; it
does **not** change `currentNodeId` (`run-turn.ts`, the `outgoing.length === 0`
branch). Two consequences:

1. **Orphaned generation.** On the terminal path `applyAdvanceSideEffects` fires
   `void generateDocument(...)` and then returns immediately (`if (!newNodeId)
   return`). With no next-step opener to await, the turn ends before the
   fire-and-forget generation can persist — so no document is stored.

2. **Suppressed milestone.** Because `currentNodeId` is unchanged, the terminal
   step's final message has `stepNodeId === currentNodeId`. `resolveMilestoneState`
   (`milestone-state.ts`) treats any message still on the current node as
   *not advanced* (the guard added for the pre-generation gate's fail path), so
   the "Step complete" pill **and the document card never render** — even if a
   document had been generated.

## Fix plan

1. **Await generation before opening the next step** — in
   `applyAdvanceSideEffects`, `await generateDocument(...)` (instead of `void`)
   before `generateInitialMessage` and before the terminal-path return. This
   orders the opener after the document (bug 1) and guarantees the terminal
   document is persisted before the turn ends (bug 2, part 1).

2. **Keep the loading feedback during the wait** — the route writes a transient
   `{ type: "generating-document", active }` stream annotation around the awaited
   generation, mirroring the v1.58.5 `cross-checking` badge. A new
   `resolveGeneratingDocumentState` resolver and a `GeneratingDocumentBadge`
   render it while the document generates.

3. **Render the terminal milestone** — `resolveMilestoneState` gains
   `isSessionComplete`; when the session is complete the `stepNodeId !==
   currentNodeId` guard is relaxed so the terminal step renders its "Step
   complete" pill and document card (bug 2, part 2).

## Regression tests

- `milestone-state.test.ts` — a completed session renders the terminal step's
  milestone even though `stepNodeId === currentNodeId`; still suppressed while the
  session is active (gate fail path).
- `generating-document-state.test.ts` (new) — latest annotation wins; inactive
  with none.
- `turn-helpers.test.ts` — `applyAdvanceSideEffects` awaits generation before the
  opener, and toggles the generating-document signal on then off.
- `apps/web/e2e/fix-document-generation-step-flow.spec.ts` (new) — end to end:
  the next step does not appear until the document is generated, and the terminal
  step renders its document.

## Version

PATCH: `1.58.5` → `1.58.6` (bug fix, no schema change).
