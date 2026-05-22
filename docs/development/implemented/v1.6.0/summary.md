# Implementation Summary — v1.6.0

## What was built

Restructured the AI turn model from two parallel calls (streamText + streamObject) into a single structured `streamObject` call, and introduced XML-tagged system prompts with expert persona, context accumulation, and document template injection.

## Files created

- `packages/domain/src/entities/system-setting.ts` — new `SystemSetting` entity
- `packages/domain/src/ports/system-settings-repository.ts` — new `ISystemSettingsRepository` port
- `packages/adapters/src/repositories/drizzle-system-settings-repository.ts` — Drizzle implementation
- `packages/adapters/src/agents/flow-session-graph.test.ts` — 16 tests for prompt building
- `packages/adapters/drizzle/0005_structured_ai_turn.sql` — migration: `expert_role`, `ai_payload`, `admin_system_settings`

## Files modified

| File | Change |
|------|--------|
| `packages/domain/src/entities/flow.ts` | Added `expertRole: string \| null` to `Flow` and `NewFlow` |
| `packages/domain/src/entities/session-message.ts` | Added `AiTurnPayload` type; added `aiPayload` field to `SessionMessage` and `NewSessionMessage` |
| `packages/domain/src/entities/index.ts` | Export `SystemSetting` |
| `packages/domain/src/ports/session-agent.ts` | New `BuildSystemPromptInput` shape; removed `BuildConfidencePromptInput`; added `BuildBranchChoicePromptInput` and `buildBranchChoicePrompt` |
| `packages/domain/src/ports/flow-repository.ts` | Added `expertRole` to `FlowUpdate` |
| `packages/domain/src/ports/index.ts` | Export new ports |
| `packages/shared/src/schemas/confidence.ts` | Replaced old schemas with `turnResponseSchema` and `branchChoiceSchema` |
| `packages/adapters/src/agents/flow-session-graph.ts` | Full rewrite — XML prompt structure, expert role, gathered context, template injection, branch choice prompt |
| `packages/adapters/src/db/schema/wayfinder.ts` | `expert_role` on `app_flows`, `ai_payload` on `app_session_messages`, new `admin_system_settings` table |
| `packages/adapters/src/repositories/drizzle-flow-repository.ts` | Map `expert_role` in `toEntity`, `create`, `update` |
| `packages/adapters/src/repositories/drizzle-session-message-repository.ts` | Map `ai_payload` in `toEntity` and `create` |
| `packages/adapters/src/repositories/index.ts` | Export `DrizzleSystemSettingsRepository` |
| `packages/application/src/use-cases/session/run-turn.ts` | Accept `aiPayload: AiTurnPayload` instead of `confidence: ConfidenceScore`; store `aiPayload` on message; derive confidence from `aiPayload.stepCompleteConfidence` |
| `packages/application/src/use-cases/session/session.test.ts` | Updated all `RunTurn` tests to use `aiPayload`; added `aiPayload` to `FakeSessionMessageRepository`; added `expertRole` to `makeFlow` fixture |
| `packages/application/src/use-cases/document/generate-document.ts` | Upgraded document generation model to `claude-sonnet-4-20250514` |
| `apps/web/src/lib/container.ts` | Registered `DrizzleSystemSettingsRepository` as `systemSettings` |
| `apps/web/src/app/api/chat/[sessionId]/stream/route.ts` | Full rewrite — single `streamObject` turn call; text delta streaming via `partialObjectStream`; post-completion branch choice call; `gatheredContext` reconstruction from prior messages; `organisationName` fetched from system settings |
| `apps/web/src/server/routers/flow.ts` | Updated `previewPrompt` to pass `workflowName`, `organisationName`, `expertRole`; added `expertRole` to `update` mutation input |
| `apps/web/src/components/chat/message-feed.tsx` | Simplified `ConfidenceAnnotation` — removed unused `readyToAdvance`/`missingInformation` fields |
| `apps/web/src/app/(user)/chats/[sessionId]/page.tsx` | Simplified fake confidence annotation for initial messages |
| `apps/web/src/app/(user)/flows/[id]/config/page.tsx` | Added `expertRole` debounced inline input to flow header toolbar |

## Migrations run

`0005_structured_ai_turn.sql`:
- `ALTER TABLE app_flows ADD COLUMN expert_role text`
- `ALTER TABLE app_session_messages ADD COLUMN ai_payload jsonb`
- `CREATE TABLE admin_system_settings (id, key UNIQUE, value, created_at, updated_at)`

## Architectural decisions

- **Branch choice is a separate post-completion call** — only fires when `stepCompleteConfidence >= 90` AND there are multiple outgoing edges. Single-edge (linear) steps skip it entirely.
- **`ai_payload` on `app_session_messages`** — full AI JSON payload stored per assistant message; `contextGathered` arrays are aggregated across turns to reconstruct `gatheredContext` for subsequent turns.
- **`confidence` smallint column preserved** — populated from `aiPayload.stepCompleteConfidence` for fast queries without parsing JSONB.
- **Text streaming via `partialObjectStream`** — iterates partial objects and writes `response` text deltas to the data stream as they build up, preserving the typing-effect UX.
- **`admin_system_settings` table** — key/value store; `organisation_name` key drives the org clause in the prompt; absent key silently omits the clause.

## Known limitations

- Document content is still filename-only in prompts (deferred to the context document extraction phase).
- Admin UI to set `organisation_name` is not built; value must be inserted directly into the DB.
- `expertRole` input on the canvas page has no save confirmation — it auto-saves after 800 ms debounce.
