# Bug Fix: Usage Tracking Silent Failures

## Symptoms

1. Chat AI usage events are not recorded in `ai_usage_events` — only document-generation calls appear.
2. Sonnet cost always shows `$0.0000` in the usage summary despite successful calls.

## Root Cause

### Bug 1 — FK constraint violation silently swallowed

`ai_usage_events.conversation_id` has a foreign key referencing `ai_conversations.id`.
The chat route passes `sessionId` (from `app_sessions`) as `conversationId`.
Postgres rejects the insert with an FK violation. `recordTokenUsage` discards
the result via `void repo.create(...)`, so the failure is silent.

Document-generation calls succeed because they pass `conversationId: undefined` → `null`,
which satisfies the nullable FK constraint.

**Affected file:** `packages/adapters/src/db/schema/ai.ts` line 28
**Caller:** `apps/web/src/app/api/chat/[sessionId]/stream/route.ts` lines 127, 168, 300, 374

### Bug 2 — Model name mismatch in cost estimation

`MODEL_RATES` uses short names (`"claude-sonnet-4-6"`) but `GenerateDocument`
passes the dated API name (`"claude-sonnet-4-20250514"`). `estimateCost` finds
no matching rate and returns 0.

**Affected file:** `packages/adapters/src/observability/usage-tracking-adapter.ts` lines 21–33

## Reproduction Steps

1. Start a chat session and send 3+ messages.
2. Query `SELECT * FROM ai_usage_events WHERE purpose = 'chat-turn'` → 0 rows.
3. Trigger a document generation → observe `document-generation` and `document-summary` rows appear.
4. Check `cost_usd` for sonnet rows → always 0.

## Fix Applied

### Bug 1 — FK constraint removed, error logging added

- **`packages/adapters/src/db/schema/ai.ts`**: Removed FK constraint on
  `conversation_id` — the column stores IDs from multiple entity types
  (sessions, conversations) so a single FK was architecturally incorrect.
  Requires `drizzle-kit push` to apply the schema change.
- **`packages/adapters/src/observability/usage-tracking-adapter.ts`**: Replaced
  `void repo.create(...)` with `.then()/.catch()` that logs failures to
  `console.error` with `[usage-tracking]` prefix so future insert issues
  are visible in server logs.

### Bug 2 — Dated model name added to cost rates

- **`packages/adapters/src/observability/usage-tracking-adapter.ts`**: Added
  `"claude-sonnet-4-20250514"` entry to `MODEL_RATES` with the same rates
  as `"claude-sonnet-4-6"`.

### Regression tests

- **`packages/adapters/src/observability/usage-tracking-adapter.test.ts`** (new):
  - `recordTokenUsage` logs to console when `repo.create` returns an error result
  - `recordTokenUsage` logs to console when `repo.create` throws
  - `estimateCost` returns non-zero for dated model name `claude-sonnet-4-20250514`
  - `estimateCost` returns non-zero for short model name `claude-sonnet-4-6`

### Version bump

PATCH: 1.9.0 → 1.9.1
