# v1.58.5 — Fix document-generation gate livelock, misleading messages & cross-check badge

## Symptom

On a `generate_document` step (New Hire → step 1) with a policy context doc,
after a cross-check failed and the operator supplied the correction:

- The **"Cross-checking…" badge stayed visible** after the follow-up question —
  it only cleared when the *next* cross-check started.
- The assistant showed a false **"ready to submit"** message, then a **second
  near-duplicate** "ready" message.
- **No document was generated** and the session **never advanced** — "Show Data"
  reported no steps complete.

## Root cause

All the "no document / no advance" symptoms are the pre-generation gate's **fail
path**, not a pass. `route.ts` streams and persists the cheap model's optimistic
"ready to submit" reply, *then* runs the gate; on a fail it holds the step
(`advanceThreshold = Infinity`) and streams a second follow-up. Three defects:

1. **Badge lingers.** The route wrote `{ type: "cross-checking", active: true }`
   with no matching off-signal, so the badge only cleared when `isStreaming`
   flipped false — i.e. after the whole fail-path follow-up finished streaming.
2. **Misleading + duplicate messages.** The optimistic "ready to submit" turn was
   persisted and shown even though the gate overruled it, then contradicted by
   the follow-up.
3. **Livelock.** The gate could hold the same node indefinitely; a grader that
   kept dipping below threshold with a non-empty `missingInformation` list left
   the step stuck, generating nothing.

## Fix

1. **Bound the gate** — `readiness-gate.ts` gains `priorGateHolds` /
   `maxGateHolds` (= 1). Once the gate has held a node and surfaced its gaps, the
   next threshold turn on that node skips the gate and advances + generates. A
   prior hold is counted by `gate-holds.ts` (`countGateHoldsOnNode`), which looks
   for the `OUTSTANDING` context key on assistant turns for the node.
2. **Fix fail-path messaging** — `route.ts` no longer persists the optimistic
   "ready to submit" turn on a gate fail. Only the corrective follow-up is
   streamed and stored, and the outstanding items are attached to *it*
   (`streamGapFollowup` now returns the persisted message id), which records the
   hold for the bound above.
3. **Cross-check off-signal** — `route.ts` writes
   `{ type: "cross-checking", active: false }` in a `finally` as soon as the gate
   finishes, so the badge clears immediately.
4. **Cycling badge** — the `active: true` annotation now carries the context-doc
   labels (filename without extension). `cross-checking-state.ts`
   (`resolveCrossCheckingState`) drives the badge from the *latest* annotation's
   `active` flag, and `CrossCheckingBadge` cycles the labels every 3s
   ("Cross-checking &lt;document&gt;…").

## Regression tests added

- `readiness-gate.test.ts` — the gate is skipped once `priorGateHolds >=
  maxGateHolds`; honours a higher limit.
- `gate-holds.test.ts` (new) — counts OUTSTANDING-bearing assistant turns per
  node; ignores other nodes and user turns.
- `cross-checking-state.test.ts` (new) — the latest annotation wins (active:false
  clears a prior active:true); labels carried and sanitised.
- `turn-helpers.test.ts` — `streamGapFollowup` returns the persisted message id
  (null when persistence fails, so no hold is recorded).
- `apps/web/e2e/fix-document-generation-gate-livelock.spec.ts` (new) —
  end-to-end: one clear follow-up (no false "ready"), advance + document on the
  correction, and the badge clears when each cross-check finishes.

## Validation

`./validate.sh` — all checks pass (DB/drizzle checks skipped without a database).

## Version

PATCH: `1.58.4` → `1.58.5` (bug fix, no schema change).
