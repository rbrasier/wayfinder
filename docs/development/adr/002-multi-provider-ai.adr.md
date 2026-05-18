# ADR-002 — Multi-Provider AI Adapter via Vercel AI SDK

- **Status**: Accepted
- **Date**: 2026-05-07

## Context

We want to support multiple LLM providers (Anthropic, OpenAI, Mistral, more
later) without our application code knowing which one is in use. We also want
streaming structured output, since the showcase page (`/sample`) renders
fields progressively as they arrive.

## Decision

Use the **Vercel AI SDK** (`ai` v4 + `@ai-sdk/<provider>`) as the runtime
behind a single domain port, `ILanguageModel`.

- `packages/adapters/src/ai/language-model-adapter.ts` implements
  `ILanguageModel` once. Its constructor takes a `ProviderName`.
- `packages/adapters/src/ai/providers.ts` is a registry mapping each
  `ProviderName` to a default model and a resolver function. Adding a fourth
  provider is one new entry plus a literal added to `ProviderName`.
- Defaults: `AI_DEFAULT_PROVIDER` env var picks the active provider.
  Anthropic → `claude-haiku-4-5-20251001`.
- `streamObject` is the streaming primitive used by the `/sample` page. The
  schema is a Zod object shared via `@rbrasier/shared`, so the type flows from
  the model output to the React component without translation.

## Why Vercel AI SDK over raw provider SDKs?

- It already abstracts the provider differences behind a single API
  (`generateObject`, `streamText`, `streamObject`).
- It supports Zod-typed structured output natively.
- It interops with React (`useChat`, `experimental_useObject`) when we want
  client-side streaming hooks later.
- It keeps the adapter layer thin (~80 lines) so the domain port stays the
  source of truth.

## Consequences

**Positive**

- Switching providers is config-only.
- The application layer never imports an SDK — only `ILanguageModel`.
- Observability (Langfuse) can decorate the port with no provider-specific
  code (see ADR-004).

**Negative**

- We're coupled to Vercel AI SDK as a layer. If we ever want to drop it,
  we'd have to reimplement the adapter directly against each provider SDK.
  This is acceptable — the port is small (3 methods), the surface stable.
