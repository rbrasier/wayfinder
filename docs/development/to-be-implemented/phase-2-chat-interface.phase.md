# Phase 2 — Chat Interface

- **Status**: Awaiting Implementation
- **Target version**: `1.3.0`  (bump: MINOR — new feature; reuses Phase 0 schema)
- **PRD**: [`../prd/wayfinder.prd.md`](../prd/wayfinder.prd.md)
- **ADRs**: 005 (route groups), 006 (schema), 007 (session-scoped LangGraph), 010 (INodeExecutor)
- **Depends on**: Phase 0 (v1.1.0), Phase 1 (v1.2.0)

## 1. Problem

A published flow is now configurable but unusable. Phase 2 makes flows
runnable: end users start sessions on published flows, hold a streaming
multi-turn conversation with an AI that builds confidence per step,
advances when confidence ≥ 90, and persists state across browser refresh
and server restart.

Document generation is **not** in Phase 2 — when a node with
`output_type = 'generate_document'` completes, a placeholder "document
generation pending (Phase 3)" pill is shown. Phase 3 fills it in.

## 2. Goals

- A user opens `/chats`, sees their (empty at first) session list, clicks
  "New Chat", picks the procurement flow, lands on `/chats/[sessionId]`.
- The first node's prompt streams in from the agent within 2 seconds of
  arriving.
- Each user message streams a token-by-token agent reply, plus a structured
  confidence reading rendered in the confidence bar.
- When confidence ≥ 90 and `readyToAdvance` is true, the step badge in the
  progress rail flips to complete and the next node's prompt streams in.
- Branching nodes (multiple outgoing edges) advance to the correct branch
  based on the AI's `branchChoice` (ADR-007).
- Sessions survive browser refresh: messages, step state, confidence all
  re-render from `app_session_messages` and `app_sessions.graph_checkpoint`.
- Sessions survive server restart: re-opening a paused session resumes the
  LangGraph checkpoint and the next user message produces a coherent reply.
- An admin viewing `/admin/sessions` sees every session, with user badges
  on each card.
- Sharing a session URL renders the session read-only for any authenticated
  user with the link.

## 3. Non-goals

- No document generation — Phase 3.
- No SSE / push for inbound webhook events — Phase 5.
- No retry / undo of an agent turn — out of scope.
- No multi-turn cost preview — out of scope.

## 4. Key entities

| Module                                                               | Lives in                                                                | New |
| -------------------------------------------------------------------- | ----------------------------------------------------------------------- | --- |
| `ISessionAgent` port                                                 | `packages/domain/src/ports/session-agent.ts`                            | yes |
| `FlowSessionGraph` adapter                                           | `packages/adapters/src/agents/flow-session-graph.ts`                    | yes |
| Confidence schema (Zod)                                              | `packages/shared/src/schemas/confidence.ts`                             | yes |
| `StartSession` use case                                              | `packages/application/src/use-cases/session/start-session.ts`           | yes |
| `RunTurn` use case                                                   | `packages/application/src/use-cases/session/run-turn.ts`                | yes |
| `session.*` tRPC router (real impl)                                  | `apps/web/src/server/trpc/routers/session.ts`                           | replaces stub |
| Streaming route                                                      | `apps/web/src/app/api/chat/[sessionId]/stream/route.ts`                 | yes |
| `SessionsListing` page                                               | `apps/web/src/app/(user)/chats/page.tsx`                                | yes (was stub) |
| `ChatInterface` page                                                 | `apps/web/src/app/(user)/chats/[sessionId]/page.tsx`                    | yes (was stub) |
| `AdminSessionsListing` page                                          | `apps/web/src/app/(admin)/admin/sessions/page.tsx`                      | yes |
| UI components: `SessionCard`, `StepProgressRail`, `MessageFeed`, `ConfidenceBar`, `MilestonePill`, `ChatComposer`, `NewChatModal`, `ShareButton` | `apps/web/src/components/chat/`                          | yes |

## 5. Pages / surfaces

### `/chats`

Tabs: Active / Completed / All. Search by title. Filter by flow type.

Session card:

- Flow icon (left)
- Title (first user message, AI-summarised, max 80 chars)
- Last message snippet (gray, max 100 chars)
- Progress bar: completed steps / total steps
- Status pill (`Active`/`Completed`/`Abandoned`)
- Timestamp (relative — "2h ago")
- (Admin view only) user badge: avatar + name + initials

"New Chat" button → modal grid of `published` flows the user can access:

- Each card: icon, name, description, "Start" CTA.
- Click → `session.create({ flowId })` → redirect to `/chats/[sessionId]`.

Admin view (`/admin/sessions` or toggle from `/chats`):

- Amber banner: "Admin view — all sessions across all users."
- "New Flow" button (links to `/admin/flows` New Flow modal — does not start
  a session).

### `/chats/[sessionId]`

Header: flow icon + name, status pill, Share button, links to My Chats and
Configure.

Step progress rail (horizontally scrollable on mobile):

- One badge per node in the flow.
- States: `pending` (grey), `current` (blue), `complete` (green with check).
- Connecting lines between badges.
- Step name below each badge.

Message feed (scrollable):

- User messages: right-aligned, primary blue background, white text.
- Agent messages: left-aligned, white background with border, dark text.
- Below each agent message: `ConfidenceBar` (mini progress bar +
  monospace % label). Green ≥ 80, amber 50–79, grey < 50.
- On step completion: green `MilestonePill` inline with text "Step
  complete — <node name> (<confidence>%)".
- On a `generate_document` step completion: placeholder pill in Phase 2
  ("Document generation coming in v1.4.0"). Phase 3 replaces with a real
  document card.

Composer (`ChatComposer`):

- Auto-resize textarea (max 120 px).
- Enter sends; Shift+Enter inserts newline.
- Send button (arrow icon, disabled when textarea empty).
- Hint text below: "Wayfinder works agentically — it asks follow-up
  questions and signals when each step is complete."

### Read-only shared mode

When `?shared=true` is in the URL and the requester is authenticated:

- The composer is replaced by a notice: "This is a shared session — view
  only."
- All other UI renders normally.

### Streaming endpoint

`POST /api/chat/[sessionId]/stream`:

- Body: `{ message: string }`.
- Persists the user message to `app_session_messages`.
- Calls `streamText` for the agent reply (tokens) and `streamObject` for
  the confidence + branchChoice schema **in parallel**.
- Sends the token stream as the response body via Vercel AI SDK
  `toDataStreamResponse`.
- On stream completion, persists the agent message and the confidence row,
  updates `app_sessions.graph_checkpoint`, and advances the session if the
  predicate is true.

## 6. Database changes

None beyond Phase 0. Phase 2 populates `app_sessions`, `app_session_messages`,
and writes `graph_checkpoint`.

## 7. Acceptance criteria

- [ ] A user opens `/chats` and the list renders within 1 second for 200
      sessions (manual: seed 200 rows and measure).
- [ ] "New Chat" → flow card click creates a session row with
      `status='active'`, `current_node_id` = first node, and redirects to
      `/chats/[sessionId]`.
- [ ] On `/chats/[sessionId]` the first agent prompt streams in within 2
      seconds.
- [ ] Sending a user message produces a streamed agent reply; the agent
      message appears in `app_session_messages` after stream completion
      with `role='assistant'`.
- [ ] After each agent reply, the confidence bar shows a 0–100 number that
      matches the `confidence.score` in the structured response.
- [ ] When `confidence >= 90 && readyToAdvance`, the step badge flips to
      complete, a milestone pill appears in the feed, and the next node's
      prompt streams in.
- [ ] On a branching node, the AI's `branchChoice` is honoured: the session
      advances to the chosen target node (verified by inspecting
      `current_node_id`).
- [ ] Refreshing the page restores: messages, step states, confidence bars,
      milestone pills, and the current node's prompt.
- [ ] Stopping and restarting the dev server (`pnpm dev`) and sending the
      next user message produces a coherent reply that continues from the
      last checkpoint.
- [ ] An admin on `/admin/sessions` sees a session created by another user;
      a non-admin trying the same URL gets 403.
- [ ] Clicking Share copies `[base_url]/chats/[sessionId]?shared=true`. A
      different authenticated user opening the link sees the read-only view.
- [ ] Langfuse traces show one `streamText` and one `streamObject` per
      turn (when env vars are configured).
- [ ] `VERSION` and root `package.json#version` = `1.3.0`. `validate.sh`
      passes.

## 8. Build order (Claude Code session strategy)

Three sessions:

**Session 2a** — Session manager + new chat modal + admin session view

- `session.list` + `session.create` use cases and tRPC procedures.
- `/chats` page with tabs, search, filter.
- New Chat modal pulling `published` flows the user has access to.
- `/admin/sessions` admin view + user badge component.

**Session 2b** — LangGraph adapter + streaming + confidence

- `ISessionAgent` port and Zod confidence schema.
- `FlowSessionGraph` adapter with state graph compiled from flow config.
- `StartSession` and `RunTurn` use cases.
- Streaming route `/api/chat/[sessionId]/stream` with parallel
  `streamText`/`streamObject`.
- Checkpoint persistence and advance logic (including branching).

**Session 2c** — Chat UI + step progress rail + sharing

- Chat page component composition: header, step rail, feed, composer.
- `ConfidenceBar`, `MilestonePill`, `MessageFeed`, `ChatComposer`.
- `useChat` wiring against the streaming endpoint.
- Share button + read-only `?shared=true` mode.

## 9. Risks / open questions

- **Confidence call latency** — `streamObject` resolution can lag the text
  stream. The UI shows "Evaluating…" until the structured result arrives.
  If this is jarring, an Enhancement can use `generateObject` with cached
  context to speed it up.
- **Checkpoint corruption** — if a checkpoint write fails mid-turn (e.g.
  DB outage), the session state can diverge from the message log. Mitigation:
  the turn handler writes message → checkpoint in a single transaction;
  on failure, neither persists and the client sees an error.
- **Large session token usage** — long sessions push token cost up. MVP
  uses the full message history per turn (LLM-context-window-bounded).
  Trimming and summarisation is an Enhancement candidate.
- **Branching with no consensus** — if the AI repeatedly returns
  `branchChoice: null` on a branching node, the session stalls. The UI
  shows a "Pick a branch manually?" affordance (admin-only) after three
  null branches in a row. Open question: do we ship the manual override at
  Phase 2 or defer to Phase 4 polish? Default: defer.

## 10. Validation

`./validate.sh` after Session 2c. Move this file to
`docs/development/implemented/v1.3.0/` and write the implementation summary.
