# Enhancement — zod 4, AI SDK 5 and LangChain 1.x on alpha-2

Source: Dependabot alerts #76, #77, #78, #81 (zod, high) and the low `ai` /
`@ai-sdk/provider-utils` advisories (GHSA-rwvc-j5jr-mgvh, GHSA-866g-f22w-33x8).
Follow-up to rbrasier/wayfinder#370. No issue.
Base: `release/alpha-2`, stacked on #370's head until it merges. PATCH → 0.28.49.

## Why

zod 3.25.76 is the last 3.x and has no fix for GHSA-mrhx-c7xc-m3w5. It is
currently waived in `scripts/audit-allowlist.sh` and `.trivyignore`. zod 3 cannot
be dropped on its own. These packages need it at our current versions:

| Package | Now | Version that accepts zod 4 |
|---|---|---|
| `ai` | 4.3.19 | 5.0.279 |
| `@ai-sdk/react` | 1.2.12 | 2.0.282 |
| `@ai-sdk/openai` | 1.3.24 | 2.0.136 |
| `@ai-sdk/anthropic` | 1.2.12 | 2.0.110 |
| `@ai-sdk/mistral` | 1.2.8 | 2.0.53 |
| `@ai-sdk/amazon-bedrock` | 1.1.6 | 3.0.141 |
| `@ai-sdk/provider` (test types) | 1.x | 2.0.5 |
| `@langchain/core` | 0.3.80 | 1.2.20 |
| `@langchain/langgraph` | 0.2.74 | 1.5.2 |
| `@modelcontextprotocol/sdk` | 1.32.1 | same version; it accepts `^3.25 \|\| ^4` |

Every target is the newest release older than the repository's 7-day cooldown,
and all of them share `@ai-sdk/provider` 2.0.5 and `@ai-sdk/provider-utils`
3.0.42 (≥3.0.28, which clears GHSA-866g-f22w-33x8). AI SDK 5 is the smallest
major that accepts zod 4; 6 and 7 are out of scope.

A trial install of this set left no `zod@3` in the lockfile, and `tsc` reported 85
distinct errors. The sections below group them.

## What changes

### 1. Dependencies

- `zod` → `^4.6.7` in `packages/shared`, `packages/application`,
  `packages/adapters` (dependency and peer), `apps/api`, `apps/web` and `mocks`.
- The AI SDK and LangChain ranges above, in `packages/adapters` (dependency and
  peer) and `apps/web`.
- `packages/application` declares `ai` but must not import it (ADR-001). Remove
  the declaration if nothing imports it; otherwise stop and report.
- Root `pnpm.overrides`: `zod@4` stays (`>=4.6.6 <5`). Add nothing new.
- Regenerate the lockfile once, then check it: only the AI/zod family may move,
  and `grep '^  zod@3'` must return nothing.

### 2. zod 4 schemas

- `z.record(value)` → `z.record(z.string(), value)`. This is most of the 12
  "Expected 2-3 arguments" errors, in `shared/src/schemas/*`, the
  `apps/web` routers and `env.ts`.
- `ZodTypeDef` (removed) → `z.ZodType` generics.
- Where zod 4's `z.record` output type is `Record<string, unknown>`, keep the
  existing type casts out: fix the schema so the inferred type is right.
- `apps/api/src/middleware/validate.ts`: keep the same error body for clients.
  Map zod 4 issues (`error.issues`) to today's response shape and test that shape.

### 3. AI SDK 5 in the adapters

- `language-model-adapter.ts`:
  - `maxTokens` → `maxOutputTokens`, and `maxSteps` → `stopWhen: stepCountIs(n)`.
  - Usage changes from `promptTokens`/`completionTokens` to
    `inputTokens`/`outputTokens`. Map them onto the unchanged domain fields,
    defaulting `undefined` to 0, as today's zero-usage path does.
  - `experimental_providerMetadata` → `providerMetadata`.
  - `generateObject`/`streamObject` take zod 4 schemas directly.
- `providers.ts`: `LanguageModelV1Middleware` → `LanguageModelMiddleware`
  (V2). Check that `wrapLanguageModel` still behaves the same.
- `embeddings-adapter.ts`: `EmbeddingModel` is generic in v5
  (`EmbeddingModel<string>`), and its test double moves to `EmbeddingModelV2`.
- `mcp/ai-sdk-mcp-client.ts`, `mcp/mcp-tool-prepass.ts`: the v5
  `experimental_createMCPClient` and tool typing, with the `StepResult` shapes
  used by the prepass.
- `observability/usage-tracking-adapter.ts`: the same usage mapping.
- `apps/web/src/lib/scheduler/scheduled-session-fire-handler.ts`: the
  `generateObject` result typing.
- `packages/application` extraction and document use cases: typing from the
  zod 4 record output only. No AI SDK code moves into the application layer.
- `agents/langgraph-agent-runner.ts`: LangGraph 1.x typechecks unchanged; its
  existing tests are the runtime check.

Before writing any call, check every v5 API name against `node_modules`
rather than relying on memory.

### 4. Chat streaming — v4 data stream → v5 UI message stream

The domain port `TurnStreamWriter` (`packages/domain/src/ports/turn-stream-writer.ts`)
does not change. Only its adapter and the browser side do.

- **Server:** `route.ts` replaces `createDataStreamResponse` with
  `createUIMessageStream` and `createUIMessageStreamResponse`.
  `turn-stream-writer.ts` writes text as `text-start` / `text-delta` /
  `text-end` parts and each `TurnStreamAnnotation` as a
  `data-turn-annotation` part, instead of `writeMessageAnnotation`.
- **Client:** `_content.tsx` moves to `useChat` v5:
  - a `DefaultChatTransport` with the same API path and body;
  - the input field's state now lives in the component;
  - `sendMessage` replaces `append`/`handleSubmit`, `regenerate` replaces
    `reload`, and `status` replaces `isLoading`.
- **One adapter function:** `annotationsOf(message)` reads the data parts back
  as `TurnStreamAnnotation[]`. `message-feed.tsx`'s existing `resolve*`
  functions then keep their current input. Text comes from the text parts.
- **Stored history:** stored messages are rebuilt into v5 `UIMessage` objects
  in code, with text and annotation parts. There is no data migration.
- **E2E mock:** `apps/web/e2e/helpers/chat-mock.ts` sends the v5 wire
  format (SSE, `x-vercel-ai-ui-message-stream: v1`) instead of the
  `0:` / `d:` lines.

### 5. Waiver removal

Remove GHSA-mrhx-c7xc-m3w5 from `scripts/audit-allowlist.sh` and its CVE from
`.trivyignore`. Its own REMOVE WHEN condition ("no package resolves zod below
4.6.6") is then met, and `waiver-check.mjs` would flag the stale entry otherwise.

## Business rules

None change. Token limits, step limits, usage figures, validation outcomes and
every chat badge behave as before.

## Database

No change and no migration. Persisted message and usage formats are
Wayfinder's own.

## Tests

Tests are updated before the code they cover.

- `turn-stream-writer.test.ts`: asserts the v5 parts written. The new
  `annotations-of` test covers the reverse mapping.
- `language-model-adapter.test.ts`, `providers.test.ts`,
  `embeddings-adapter.test.ts`, `mcp-tool-prepass.test.ts`,
  `usage-tracking-adapter.test.ts`: v5 doubles and usage mapping.
- The `apps/api` validate middleware test pins the error body.
- The `message-feed` model tests receive annotations through `annotationsOf`.
- E2E: the `chat-mock.ts` helper is amended, covering `chat.spec.ts` and
  `chat-typing-and-retry.spec.ts`. This is policy group "streaming into the
  DOM"; no new spec. CI runs the suite.

## Risks

- **Chat:** the stream protocol changes end to end. The e2e chat specs are the
  check.
- **Structured outputs:** v5 converts zod 4 schemas to JSON Schema natively, so
  the adapter tests compare the generated schema for one representative object.
- **MCP and agents** are the next most likely to break at runtime. Their
  adapter tests and the mocks MCP round trip cover them.

## Out of scope

- AI SDK 6/7.
- The minio-bound stream-json and decode-uri-component alerts.
- Unrelated refactors.

## Found during the build

These are corrections to the plan above. The approved scope is unchanged.

- **The MCP client moved packages.** `ai@5.0.279` no longer ships
  `experimental_createMCPClient`; it lives in `@ai-sdk/mcp`. 0.0.41 is the ai-5
  line, built on the same `@ai-sdk/provider` 2.0.5 and `provider-utils` 3.0.42,
  and it keeps the same export names. It's a new adapters dependency.
- **`@ai-sdk/provider-utils` 3.x pulls in `undici@5`,** which has high
  advisories. Its only use is the SSRF-safe download `fetch`
  (`new Agent({ connect: { lookup } })` and `fetch(…, { dispatcher })`), the
  same API in undici 6. A scoped root override,
  `"@ai-sdk/provider-utils>undici": ">=6.29.1 <7"`, moves it to the patched
  line, and `@fastify/busboy` drops out with it.
- **zod 4's `uuid()` is RFC 9562-strict.** It checks the version and variant
  bits, where zod 3 accepted any 8-4-4-4-12 hex string. To keep validation
  outcomes identical, all 143 `.uuid()` calls become `.guid()`, which is zod 4's
  name for zod 3's rule.
- **zod 4 `.default()` takes the output type and short-circuits parsing.** The
  four env booleans with `.transform(…).default("false")` become
  `.default(false)`, with the same resulting values. The single-argument
  `z.record(value)` calls become `z.record(z.string(), value)`; in `hr.ts` and
  the column-mapping detector, zod 4 had otherwise read the enum as the key.
- **`event-watch`'s `requestBody: z.unknown()`** is inferred as required in
  zod 4. It's now `.optional()`, which is what the router's `withBody` expects.
- **Embedding dimensions.** `@ai-sdk/openai@2`'s `textEmbeddingModel()` drops
  its settings argument, and `dimensions` is now a per-call
  `providerOptions.openai`. `EmbeddingsAdapter` takes provider options next to
  its model, so vectors stay `EMBEDDINGS_DIMENSION` wide (ADR-017).
- **Usage.** In v5, cache reads come from `usage.cachedInputTokens`; Anthropic
  reports cache writes only in provider metadata. In `generateText`,
  `usage` covers only the last step, and `totalUsage` is the sum.
  - The MCP pre-pass records `totalUsage`; with `usage` it would bill a tool
    loop as one call.
  - Step tool calls and results renamed `args`→`input` and `result`→`output`.
    Without the change, the audit trail would record empty arguments.
- **Scripted model (test/e2e LLM stub).** Its schema-default walker read zod 3's
  `_def.typeName`; it now reads zod 4's `_zod.def.type`, with number bounds
  taken from `minValue` / `maxValue` / `isInt`.
- **Temperature middleware.** ai@5 no longer injects a default temperature,
  but the providers forward any value they're given, so the middleware still
  guarantees the Claude 5 family never receives one. Its comment is corrected.
- **Dead override.** `jsondiffpatch` only came in through ai@4, so its
  override is removed.
