# Implementation Summary — Code Quality: Hot Paths, Group B (slice 3) (v2.3.2)

- **Version**: 2.3.2 (**PATCH** — internal refactor; the streaming turn and the
  gap-followup now go through the port instead of the AI SDK directly. The
  usage rows, quota checks, and Langfuse spans are unchanged in content; only
  the code path that produces them has moved).
- **Date**: 2026-07-10
- **Phase**: "Code Quality: Hot Paths, Boundaries, and Decomposition", **Group B
  — Streaming inside the `ILanguageModel` port** (phase doc under
  `to-be-implemented/`).
- **Scope built**: route the chat stream turn and the failed-cross-check gap
  follow-up through `ILanguageModel.streamObject`, deleting the hand-rolled
  `recordTokenUsage` plumbing that duplicated `withUsageTracking`. Leaves the
  turn-helpers opener/branch/title calls and the route's `ExecuteTurn`
  extraction for slice 4 (item 6).

## Context — what was already in place

Slice 1 (v2.2.1) moved the branch-choice `generateObject` through the port.
Slice 2 (v2.3.1) extended the port with the two hooks the streaming turn
depends on:

- optional per-message `providerOptions` on `ChatMessage` (Anthropic
  `cache_control` marker for the system prefix);
- an optional `onError` callback on `StreamObjectInput`;

and taught the adapter's `streamObject` to extract Anthropic
`cacheReadInputTokens` / `cacheCreationInputTokens` from `providerMetadata` so
the `TokenUsage` promise on a streamed call carries cache tokens.

## What was built

- `apps/web/src/app/api/chat/[sessionId]/stream/stream-turn.ts` — rewritten to
  take an `ILanguageModel` instead of a raw AI SDK `LanguageModel`. It attaches
  the `cache_control` marker to the system message via
  `ChatMessage.providerOptions` (the new port field) and captures errors via
  the port's `onError` hook. The partial-object diffing logic that writes text
  deltas to the data-stream writer is unchanged.
- `apps/web/src/app/api/chat/[sessionId]/stream/turn-helpers.ts::streamGapFollowup`
  — routed through the port (`purpose: "chat-gap-followup"`). Its
  `recordTokenUsage` call is gone; the decorator does it. Its interface no
  longer takes `model: LanguageModel` or `provider` — only the model name
  string.
- `apps/web/src/app/api/chat/[sessionId]/stream/route.ts` — the top-level
  streaming call now uses `container.services.llm.streamObject` (via
  `streamTurn`), and the manual `recordTokenUsage(...)` after it is gone.
  `chatModel` (the resolved SDK model) is deleted from the route; `branchingModel`
  stays because `applyAdvanceSideEffects` still uses it for the opener/branch
  calls in `turn-helpers.ts` (moved in slice 4). The eager
  `container.services.quotaEnforcer.check(userId)` at the top of the route is
  retained: the port decorator also enforces quota, but by then the stream is
  set up, so the eager check preserves the pre-stream 402/403 UX. The
  `recordTokenUsage` import is dropped from the route.
- `stream-turn.test.ts` — rewritten to mock `ILanguageModel` instead of
  `MockLanguageModelV1`. New coverage: `cache_control` marker is attached to
  the system message; the port's `onError` hook rejects the promise instead of
  hanging; the port's `err` result rejects with its cause.
- `turn-helpers.test.ts::streamGapFollowup` — rewritten to inject a fake
  `container.services.llm`; new assertion that the port call carries
  `purpose: "chat-gap-followup"` plus the identifier fields the decorator
  needs.

## Files changed

- `apps/web/src/app/api/chat/[sessionId]/stream/stream-turn.ts`
- `apps/web/src/app/api/chat/[sessionId]/stream/stream-turn.test.ts`
- `apps/web/src/app/api/chat/[sessionId]/stream/turn-helpers.ts` — only the
  `streamGapFollowup` block; the opener/branch/title paths are unchanged and
  still call the SDK directly (slice 4 scope).
- `apps/web/src/app/api/chat/[sessionId]/stream/turn-helpers.test.ts` — only
  the `streamGapFollowup` block.
- `apps/web/src/app/api/chat/[sessionId]/stream/route.ts`
- `VERSION`, root `package.json` — 2.3.1 → 2.3.2.

## Migrations run

None.

## Tests

- Full web unit suite (34 files / 206 tests) green.
- Full domain suite (18 files / 195 tests) green.
- Full adapter suite (47 files / 394 tests) green.
- `./validate.sh` green (19/19).
- Cache-token verification against a real two-turn conversation still deferred
  to end-to-end verification once the chat e2e picks this branch up; the
  adapter test in slice 2 covers the extraction unit-side.

Slice 4 will extract `ExecuteTurn` (item 6), route the remaining
turn-helpers SDK calls (opener, recompute-branch, title) through the port, and
land E14 (narrow `container.repos.*` reach in the route) and E16 (move
`confirmStep` into the application layer).
