# Bug: Workflow advances to next step when document generation fails

## Root Cause

`generateDocument()` in `turn-helpers.ts` returns `Promise<void>`. On failure it
correctly sets `documentStatus = "failed"` on the message row, but the caller in
`route.ts` receives no signal — it falls straight through to `generateInitialMessage`,
which advances the session to the next node regardless of the doc-gen outcome.

## Reproduction

1. Configure a workflow that has a `generate_document` output node.
2. Trigger any chat turn that reaches `stepCompleteConfidence >= 90` on that node.
3. Have an AI model error occur during document generation (e.g. invalid model name,
   API failure, rate limit).
4. Observe: the UI progresses to the next step instead of surfacing the failure.

## Expected behaviour

When document generation fails the UI should remain on the failed step and show
the `MilestonePill` amber "failed" state. The session must NOT advance.

## Affected files

- `apps/web/src/app/api/chat/[sessionId]/stream/turn-helpers.ts`
- `apps/web/src/app/api/chat/[sessionId]/stream/route.ts`

## Fix plan

1. Change `generateDocument` return type from `Promise<void>` to `Promise<boolean>`.
   - Return `true` after the success path.
   - Return `false` on every error / catch path.
2. In `route.ts`, gate the `generateInitialMessage` call behind the boolean result.
   The block at line 228 (`if (runResult.data.newNodeId)`) must only execute when
   `generateDocument` returned `true`.

## Version bump

`1.12.0` → `1.12.1` (PATCH — bug fix, no schema change)

## Implementation summary

**Root cause confirmed:** `generateDocument` returned `void`, giving the route no
way to detect failure. The `generateInitialMessage` call that advances to the next
step executed unconditionally.

**Fix applied:**
- `turn-helpers.ts`: return type changed to `Promise<boolean>`; every error path
  (Result.error and thrown exceptions) returns `false`; success path returns `true`.
- `route.ts`: captured the return value as `docGenSucceeded`; added early return
  (`if (!docGenSucceeded) return;`) so the execute callback stops before
  `generateInitialMessage` runs.

**Regression tests added** (`generateDocument return value` describe block in
`turn-helpers.test.ts`): three tests covering Result.error path, thrown exception
path, and success path.
