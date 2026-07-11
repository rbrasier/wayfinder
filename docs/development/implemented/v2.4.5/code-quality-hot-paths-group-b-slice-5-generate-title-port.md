# v2.4.5 — Group B slice 5: `generateTitle` through the `ILanguageModel` port

**Phase**: "Code Quality: Hot Paths, Boundaries, and Decomposition",
**Group B** (streaming inside the `ILanguageModel` port), item 5 — final slice.
**Bump**: PATCH (2.4.4 → 2.4.5). No schema change; a new port method + one
caller migration, consistent with the earlier Group B slices (v2.2.1–v2.3.3).

## Problem

`generateTitle` (session title from the first user message) was the last model
call in the chat stream path still bypassing the port. It called the Vercel SDK
`generateText` directly via `resolveModel`, then hand-rolled `recordTokenUsage`
against `container.repos.usageRepo` — re-plumbing exactly the concerns the
`ILanguageModel` decorators already own (ADR-026): usage recording, quota
enforcement, the concurrency governor, and Langfuse tracing. The port exposed
`generateObject`, `streamText`, and `streamObject`, but not `generateText`, so
there was no port-shaped path for a plain text completion.

## Change

- **Domain port** (`packages/domain/src/ports/language-model.ts`): new
  `GenerateTextInput` type and `ILanguageModel.generateText(...) →
  Result<{ text: string; usage: TokenUsage }>`, mirroring the existing call
  shapes (purpose, ids, model, system/prompt/messages, temperature, maxTokens).
- **Base adapter** (`language-model-adapter.ts`): implements `generateText`
  over the SDK's `generateText`, running under the concurrency governor and
  extracting Anthropic cache tokens from `experimental_providerMetadata` (same
  `extractMeta` used by `generateObject`).
- **Decorators**: `UsageTrackingAdapter` records usage on success;
  `QuotaEnforcingLanguageModel` runs the pre-call cap check;
  `LangfuseTracingAdapter` traces the call. So every decorator now covers
  `generateText` uniformly.
- **Caller** (`stream/turn-helpers.ts`): `generateTitle` now calls
  `container.services.llm.generateText({ purpose: "chat-title", ... })` and
  drops the direct SDK call, `resolveModel`, `ProviderCredentials`, and the
  hand-rolled `recordTokenUsage`. Its signature loses the `provider` and
  `credentials` parameters; the two call sites in `stream/route.ts` no longer
  compute `provider`/`apiKey` locals. Best-effort behaviour is preserved: a
  port error (including a quota block) falls back to a truncated slice of the
  first user message.

## Tests

- `language-model-adapter.test.ts`: `generateText` returns ok text + normalised
  usage, carries Anthropic cache tokens through, honours the `model` override,
  and maps a rejection to `AI_PROVIDER_FAILED`.
- `turn-helpers.test.ts`: `generateTitle` routes through the port with the
  `chat-title` purpose + session id and persists the trimmed title; on a port
  error it falls back to the truncated message.
- Existing usage/quota decorator suites and the 58-test stream suite stay green.

## Notes

Group B now has only item 6 (`ExecuteTurn` extraction, with E14 falling out of
it) remaining. Grepping the stream route + turn-helpers for direct
`generateText`/`generateObject`/`streamObject` SDK calls now finds none — all
model calls traverse the decorated port.
