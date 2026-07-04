# fix — document generation gate livelock, misleading messages & cross-check badge

## Symptoms (reported)

On a `generate_document` step (New Hire → step 1), after a policy cross-check
failed and the operator supplied the correction:

1. After the first cross-check failed and the assistant correctly went back to
   ask a follow-up, the **"Cross-checking…" loading badge stayed visible** — it
   only disappeared when the *next* cross-check started.
2. After the operator responded with the fix, the cross-check *appears* to pass.
3. The assistant then says it is **"ready to submit"**, but **no document is
   generated** and the session **does not advance**.
4. A **second** near-duplicate "ready to submit" message appears — still no
   document.
5. It **never progresses** to the next step. "Show Data" reports **no steps
   completed**.

Plus an enhancement request: the cross-check badge should **cycle through the
context documents** — "Cross-checking &lt;doc 1&gt;…", after 3s
"Cross-checking &lt;doc 2&gt;…", etc. — using each document's title if
available, otherwise its filename without the extension.

## Root cause

All of the "no document / no advance" symptoms are the pre-generation gate's
**fail path**, not a pass. On a `generate_document` step the chat route
(`apps/web/src/app/api/chat/[sessionId]/stream/route.ts`):

1. streams and **persists** the cheap chat model's optimistic reply ("Step 1 is
   ready to be submitted! 🎉", 100%),
2. *then* runs `evaluateStepReadiness`,
3. on a **fail** calls `persistAssistantTurn` with `advanceThreshold = Infinity`
   (never advances) and streams a *second* follow-up via `streamGapFollowup`.

The two near-duplicate "ready to submit" messages, the missing document, and
"Show Data" showing nothing complete (`buildCompletedStepData` only counts a
node the session has *left*) are all consistent with the gate holding the step
open twice.

Three distinct defects:

- **Badge lingers (bug 1).** `route.ts` writes
  `{ type: "cross-checking", active: true }` before the eval but there is **no
  matching off-signal**. `message-feed.tsx` only clears the badge when
  `isStreaming` flips false, so on the fail path it stays lit through the entire
  gap-follow-up stream.
- **Misleading + duplicate messages (bugs 3, 4).** On a fail the cheap model's
  *optimistic* "ready to submit" message is persisted and shown, then
  contradicted by the follow-up — the user sees a false "ready" plus a confusing
  near-duplicate.
- **Livelock (bug 5).** The gate can hold the same node **indefinitely**. The
  intended self-limit (OUTSTANDING context suppressing the cheap model's
  confidence) does not hold — the cheap model reports ≥ threshold again, the
  grader can fail again on a flaky sub-threshold confidence, and the step never
  advances.

## Fix plan

1. **Bound the gate (`readiness-gate.ts`).** Add `priorGateHolds` and
   `maxGateHolds` (= 1) to `shouldEvaluateStepReadiness`. Once the gate has
   already held a node once and surfaced its gaps, the next time the cheap model
   reaches threshold on that node the gate is skipped and the step advances +
   generates its document (the gate becomes advisory). A prior hold is detected
   by counting assistant messages on the current node whose gathered context
   carries the `OUTSTANDING` key.

2. **Fix fail-path messaging (`route.ts`, `turn-helpers.ts`).** On a gate fail,
   **do not persist** the cheap model's optimistic "ready" message. Stream only
   the corrective follow-up, and attach the OUTSTANDING items to *that* message
   (so the hold is counted for the bound above).

3. **Cross-check off-signal (`route.ts`).** Write
   `{ type: "cross-checking", active: false }` as soon as the eval finishes
   (pass or fail, in a `finally`), before the follow-up streams, so the badge
   clears immediately.

4. **Cycling badge (`message-feed.tsx`, `milestone-pill.tsx`).** Carry the
   context-doc labels on the `active: true` annotation. Drive the badge from the
   *latest* cross-checking annotation's `active` flag (a pure resolver), and
   cycle the labels every 3s. Labels use the filename without its extension
   (`FlowContextDoc` has no separate title field).

## Regression tests

- `readiness-gate.test.ts` — the gate is skipped once `priorGateHolds >=
  maxGateHolds` (plus the existing cases).
- `gate-holds.test.ts` (new pure helper) — counts OUTSTANDING-bearing assistant
  turns on a node.
- `cross-checking-state.test.ts` (new pure resolver) — the latest annotation's
  `active` flag wins; labels are carried through.
- `apps/web/e2e/fix-document-generation-gate-livelock.spec.ts` — end-to-end: a
  gate fail asks a single clear follow-up (no false "ready"); a second threshold
  turn advances and generates the document; the badge clears when each
  cross-check finishes.

## Version

PATCH: `1.58.4` → `1.58.5` (bug fix, no schema change).
