# v1.3.0 — Phase 2: Chat Interface

**Version bump**: MINOR (new feature, no schema changes)  
**Date**: 2026-05-19

## What was built

Phase 2 delivers the full end-to-end chat interface for running sessions on published flows.

### Domain layer (`packages/domain`)

- `ports/session-repository.ts` — `ISessionRepository` with `create`, `findById`, `listByUser`, `listAll`, `update`
- `ports/session-message-repository.ts` — `ISessionMessageRepository` with `create`, `listBySession`
- `ports/session-agent.ts` — `ISessionAgent` with `buildSystemPrompt` and `buildConfidenceSystemPrompt`

### Shared layer (`packages/shared`)

- `schemas/confidence.ts` — `confidenceSchema`, `turnSchema` (Zod), `ConfidenceReading`, `TurnReading` types

### Adapters layer (`packages/adapters`)

- `repositories/drizzle-session-repository.ts` — Drizzle impl of `ISessionRepository`
- `repositories/drizzle-session-message-repository.ts` — Drizzle impl of `ISessionMessageRepository`
- `agents/flow-session-graph.ts` — `FlowSessionGraph` implements `ISessionAgent`; builds context-aware system prompts for each node and a structured confidence evaluation prompt

### Application layer (`packages/application`)

- `use-cases/session/start-session.ts` — creates a session, detects root node (no incoming edges), validates flow is published
- `use-cases/session/list-sessions.ts` — lists sessions for a user
- `use-cases/session/list-all-sessions.ts` — lists all sessions (admin view)
- `use-cases/session/get-session.ts` — returns full `SessionDetail` (session + messages + flow + nodes + edges)
- `use-cases/session/run-turn.ts` — persists user + assistant messages, evaluates advance predicate, advances session to next node or marks complete
- `use-cases/session/session.test.ts` — 17 tests covering all use-cases

### Web app (`apps/web`)

**Server**
- `server/routers/session.ts` — full tRPC router: `list`, `listAll`, `get`, `create`, `listPublishedFlows`
- `app/api/chat/[sessionId]/stream/route.ts` — POST streaming endpoint: auth, loads session, builds system prompt, runs `streamText` + `streamObject` in parallel, writes confidence annotation, persists via `RunTurn`, fires background title generation on first message

**UI components** (`components/chat/`)
- `confidence-bar.tsx` — green/amber/grey progress bar with monospace % label; shows "Evaluating…" during streaming
- `milestone-pill.tsx` — green step-complete pill; amber placeholder for `generate_document` nodes (Phase 3)
- `step-progress-rail.tsx` — horizontal scrollable rail with pending/current/complete badges per node
- `chat-composer.tsx` — auto-resize textarea, Enter sends, Shift+Enter newlines, read-only shared mode
- `share-button.tsx` — copies `?shared=true` URL to clipboard
- `message-feed.tsx` — user (right, blue) and assistant (left, white) bubbles; confidence bar under each assistant message; milestone pills on step advance; uses streaming messages during turn, DB messages otherwise
- `session-card.tsx` — session listing card with flow icon, title, status badge, relative timestamp, optional user badge
- `new-chat-modal.tsx` — grid of published flows; click to create session and redirect

**Pages**
- `(user)/chats/page.tsx` — Active/Completed/All tabs, session grid, New Chat button
- `(user)/chats/[sessionId]/page.tsx` — full chat interface: header, step rail, message feed, composer; shared read-only mode via `?shared=true`
- `(admin)/admin/sessions/page.tsx` — admin table of all sessions with user badge column

**Container**
- `lib/container.ts` — wired `DrizzleSessionRepository`, `DrizzleSessionMessageRepository`, `FlowSessionGraph`, and all five session use-cases

## Files created / modified

| File | Change |
|------|--------|
| `packages/domain/src/ports/session-repository.ts` | new |
| `packages/domain/src/ports/session-message-repository.ts` | new |
| `packages/domain/src/ports/session-agent.ts` | new |
| `packages/domain/src/ports/index.ts` | updated |
| `packages/shared/src/schemas/confidence.ts` | new |
| `packages/shared/src/schemas/index.ts` | updated |
| `packages/adapters/src/repositories/drizzle-session-repository.ts` | new |
| `packages/adapters/src/repositories/drizzle-session-message-repository.ts` | new |
| `packages/adapters/src/repositories/index.ts` | updated |
| `packages/adapters/src/agents/flow-session-graph.ts` | new |
| `packages/adapters/src/agents/index.ts` | updated |
| `packages/application/src/use-cases/session/` | new directory, 6 files |
| `packages/application/src/use-cases/index.ts` | updated |
| `apps/web/src/server/routers/session.ts` | replaced stub |
| `apps/web/src/app/api/chat/[sessionId]/stream/route.ts` | new |
| `apps/web/src/app/(user)/chats/page.tsx` | replaced stub |
| `apps/web/src/app/(user)/chats/[sessionId]/page.tsx` | replaced stub |
| `apps/web/src/app/(admin)/admin/sessions/page.tsx` | new |
| `apps/web/src/app/(admin)/admin/layout.tsx` | added Sessions nav link |
| `apps/web/src/components/chat/*.tsx` | 8 new components |
| `apps/web/src/lib/container.ts` | wired session repos + use-cases |
| `VERSION` | 1.2.0 → 1.3.0 |
| `package.json` | 1.2.0 → 1.3.0 |

## Known limitations

- **No document generation** — nodes with `outputType = 'generate_document'` show a Phase 3 placeholder pill.
- **No gathered context persistence** — system prompts do not include cross-node accumulated context; this is a Phase 4 enhancement.
- **FlowSessionGraph does not use LangGraph** — the `ISessionAgent` adapter builds prompts without LangGraph state management; full LangGraph checkpoint integration is deferred to Phase 4 polish when the `gatheredContext` pattern is formalised.
- **Sharing is honour-system** — the `?shared=true` URL renders read-only UI; server-side enforcement (anyone with the link can still call `session.get` via tRPC) is by design for MVP — Phase 4 adds explicit share tokens.
