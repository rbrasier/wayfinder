# Summary — zod 4, AI SDK 5 and LangChain 1.x on alpha-2 (v0.28.49)

## What changed

No package in the lockfile resolves zod below 4.6.6 now. The GHSA-mrhx-c7xc-m3w5
waiver is gone from `scripts/audit-allowlist.sh`, along with both of its
`.trivyignore` entries. This clears Dependabot alerts #76, #77, #78 and #81 and
the two low advisories: `ai` GHSA-rwvc-j5jr-mgvh and `@ai-sdk/provider-utils`
GHSA-866g-f22w-33x8, the latter now on 3.0.42.

| Package | Before | After |
|---|---|---|
| `zod` | 3.25.76 (+ 4.6.7 under better-auth) | 4.6.7 only |
| `ai` | 4.3.19 | 5.0.279 |
| `@ai-sdk/openai`, `anthropic`, `mistral` | 1.x | 2.x |
| `@ai-sdk/amazon-bedrock` | 1.1.6 | 3.0.141 |
| `@ai-sdk/react` | 1.2.12 | 2.0.282 |
| `@ai-sdk/mcp` | — | 0.0.41 (the MCP client left `ai`) |
| `@langchain/core` / `langgraph` | 0.3.80 / 0.2.74 | 1.2.20 / 1.5.2 |
| `undici` (under provider-utils) | — | 6.29.1 (scoped override) |

Every version is the newest release older than the 7-day cooldown.
`packages/application` no longer declares `ai`, which it never imported.

## By layer

- **domain:** unchanged, including the `TurnStreamWriter` port and `TokenUsage`.
- **shared, api, web schemas:**
  - two-argument `z.record`
  - `.uuid()` → `.guid()` (143 sites)
  - output-typed `.default()` on the env booleans
  - `ZodType<T>` in the API validate middleware
  - an explicit `.optional()` on event-watch's `requestBody`
- **adapters:**
  - **Language-model adapter:** `maxOutputTokens`; one `toTokenUsage`
    mapping (input/output tokens, cache reads from usage, cache writes from
    Anthropic metadata); `providerMetadata`. `streamText` keeps reporting no
    cache tokens, as before.
  - **Providers:** the V2 `LanguageModelMiddleware`.
  - **Embeddings:** `dimensions` now goes through `providerOptions`.
  - **MCP client and pre-pass:** imports from `@ai-sdk/mcp`; `stopWhen:
    stepCountIs(n)`; `totalUsage`; tool calls read `input`/`output`.
  - **Scripted model stub:** walks zod 4's `_zod.def`.
- **web chat:**
  - **Server:** `route.ts` uses `createUIMessageStream` and
    `createUIMessageStreamResponse`. `UiMessageStreamTurnWriter` writes
    `text-start`/`text-delta`/`text-end` (one text part per bubble) and
    `data-turn-annotation` parts. The last open bubble is closed when the turn
    ends.
  - **Client:** `_content.tsx` uses `useChat` v5 through a
    `DefaultChatTransport`. The page keeps its own input state; `sendMessage`,
    `regenerate` and `status` replace `append`/`handleSubmit`, `reload` and
    `isLoading`. `useChat` is given `id: sessionId`: v5 keeps one `Chat` until
    its id changes, so without it a client-side move between chats would carry
    the previous conversation across, where v4 keyed its state by the API URL.
  - **Conversions:** `lib/chat/ui-messages.ts` turns persisted rows into v5
    messages, v5 messages into the feed shape (`content` plus the ordered
    `annotations`), and keeps the wire body `{ id, role, content }` that
    `streamTurnRequestSchema` validates.
  - **Scheduler:** `scheduled-session-fire-handler` reads input/output tokens.

No database change, no migration.

## Tests

Tests were written or updated before the code they cover.

- **New:**
  - `apps/api/src/middleware/validate.test.ts`: pins the 400 body shape.
  - `apps/web/src/lib/chat/ui-messages.test.ts`
  - `packages/adapters/src/ai/structured-output-schema.test.ts`: the chat
    turn's JSON Schema keeps its fields, required set and descriptions, and a
    transformed field is asked for as a number.
- **Amended:**
  - `turn-stream-writer.test.ts`: v5 chunks, one bubble per text part,
    annotations as data parts.
  - `language-model-adapter.test.ts`: v5 doubles, `maxOutputTokens`,
    unreported counts become 0, and the cache split.
  - `embeddings-adapter.test.ts`: provider options forwarded, and
    `EMBEDDINGS_DIMENSION` requested.
  - `mcp-tool-prepass.test.ts`: `totalUsage` across steps, `stopWhen`, and
    `input`/`output`.
  - `providers.test.ts`: V2 doubles.
- **Unchanged and passing:** the `scripted-language-model.test.ts` cases are the
  spec for the zod 4 walker.
- **Totals:** web 1,210, adapters 927, application 1,192, domain 960, mocks 181,
  api 27, shared 28.

## E2E

- `apps/web/e2e/helpers/chat-mock.ts` gains `uiMessageStreamBody` and
  `UI_MESSAGE_STREAM_HEADERS`, framed as the real route frames the stream.
  `delayChatStream` and the base fixture's chat mock use them.
- The in-page stream in `chat.spec.ts` (consulting-tools annotations) is
  rewritten to the same v5 framing.
- Policy group: streaming into the DOM. No new spec. The suite runs in CI.

## Known limitations

- **Error wording:** zod 4 words validation messages differently (e.g. "Invalid
  input: expected string, received number"). The API's 400 body shape is
  unchanged.
- **Cache-read figures:** OpenAI and Bedrock cache reads are now recorded, from
  `usage.cachedInputTokens`, where ai@4's adapter recorded only Anthropic's. The
  cost estimator already handles them (`PROMPT_INCLUDES_CACHE_TOKENS`), so
  cached OpenAI turns estimate slightly lower and cached Bedrock turns slightly
  higher, both closer to the real bill. `streamText` is held at zero, as before.
- **Scheduler test gap:** `scheduled-session-fire-handler` has no unit test;
  its usage mapping is enforced by `ai`'s types.
- **Pre-existing dead override:** the `browserslist` root override matches
  nothing in the lockfile, before and after this change. It's left for a
  separate cleanup.
- **AI SDK 6/7** remain a later step.
