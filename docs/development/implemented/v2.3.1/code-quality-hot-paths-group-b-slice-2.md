# Implementation Summary — Code Quality: Hot Paths, Group B (slice 2) (v2.3.1)

- **Version**: 2.3.1 (**PATCH** — port surface additions are optional; no
  behaviour change to any existing caller until slice 3 rewires the stream
  route through the port).
- **Date**: 2026-07-10
- **Phase**: "Code Quality: Hot Paths, Boundaries, and Decomposition", **Group B
  — Streaming inside the `ILanguageModel` port** (phase doc under
  `to-be-implemented/`). This is the phase's explicitly riskiest group; it is
  being landed in small, individually-verifiable slices.
- **Scope built**: extend the `ILanguageModel` port and its adapter so that the
  in-flight streaming call in the chat route can move onto the port without
  regressing Anthropic prompt caching or losing streamed errors — the two
  concerns the current SDK-direct path relies on.

## Context — what was already in place

The port already declared `streamObject`/`streamText`; the three decorators
(`withUsageTracking`, `withQuotaEnforcement`, `withOptionalLangfuse`) already
covered both streaming methods. Slice 1 (v2.2.1) moved the route's non-streaming
branch-choice call through the port. But the streaming turn
(`apps/web/src/app/api/chat/[sessionId]/stream/stream-turn.ts`) still calls the
AI SDK's `streamObject` directly because it needs two things the port did not
expose:

1. **Per-message `providerOptions`** to attach an Anthropic `cache_control`
   marker to the system prompt — Wayfinder's ~90 % prompt-cache hit rate depends
   on this, and no e2e test can see it (caching happens inside the provider).
2. **An `onError` callback** — `partialObjectStream` silently swallows error
   chunks and `object` never resolves on failure, so without a hook the route
   would hang forever on any provider/network/schema failure.

The adapter's existing `streamObject` also dropped the response
`providerMetadata` on the floor, so the cache-token fields on `TokenUsage`
(`cacheReadTokens` / `cacheWriteTokens`) always came back as 0 for streaming
calls — cost accounting on cached streamed turns was silently wrong.

## What was built

- `packages/domain/src/ports/language-model.ts`:
  - New optional `providerOptions?: ProviderMessageOptions` on `ChatMessage`,
    typed opaquely so provider-specific keys stay a port concern rather than a
    domain one.
  - New optional `onError?: (event: { error: unknown }) => void` on
    `StreamObjectInput`.
- `packages/adapters/src/ai/language-model-adapter.ts`:
  - `streamObject` now passes `input.onError` through to the SDK.
  - `streamObject`'s `usage` promise now awaits `result.providerMetadata`
    alongside `result.usage` and runs the extracted meta through the existing
    `extractMeta` helper, so Anthropic `cacheReadInputTokens` /
    `cacheCreationInputTokens` land on the `TokenUsage` the decorators record.
  - The SDK's `messages` type already accepts `providerOptions` per message, so
    passing them through is a no-op cast — the change is purely at the port
    surface.

Behaviour of the port for any existing caller is unchanged: the two new fields
are optional, and no caller in this repo passes them yet. The next slice will
switch the route to `container.services.llm.streamObject({...})` with a
`cache_control`-annotated system message and an `onError` capture, at which
point the two additions become load-bearing.

## Files changed

- `packages/domain/src/ports/language-model.ts` — add
  `ProviderMessageOptions`, extend `ChatMessage` with optional
  `providerOptions`, extend `StreamObjectInput` with optional `onError`.
- `packages/adapters/src/ai/language-model-adapter.ts` — pass `onError`
  through; extract cache tokens from `providerMetadata` in the usage promise.
- `packages/adapters/src/ai/language-model-adapter.test.ts` — three new
  streamObject tests: cache tokens extracted from `providerMetadata`,
  `ChatMessage.providerOptions` passed through, `onError` passed through.
- `VERSION`, root `package.json` — 2.3.0 → 2.3.1.

## Migrations run

None.

## Tests

- New adapter tests (3) cover cache-token extraction, providerOptions
  passthrough, and onError passthrough.
- Full adapter suite: 47 files / 394 tests pass.
- Full domain suite: 18 files / 195 tests pass.
- `./validate.sh` green (19/19).

Slice 3 (route through the port + `ExecuteTurn` extraction + E14/E16
boundary tightening) will exercise the new port shape end-to-end via the
existing chat e2e; a dedicated `TokenUsage` assertion on a real two-turn
conversation will confirm cache tokens survive the port hop.
