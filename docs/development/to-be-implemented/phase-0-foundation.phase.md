# Phase 0 — Wayfinder Foundation

- **Status**: Awaiting Implementation
- **Target version**: `1.1.0`  (bump: MINOR — schema add + new dependencies + new port)
- **PRD**: [`../prd/wayfinder.prd.md`](../prd/wayfinder.prd.md)
- **ADRs**: 005 (route groups), 006 (schema), 010 (INodeExecutor)

## 1. Problem

The template scaffold (v1.0.8) is in place — Next.js 15, tRPC v11, Express
`apps/api`, Better Auth with magic-link + PKI, multi-provider AI via Vercel
AI SDK, LangGraph passthrough, Langfuse, admin dashboard, hexagonal
boundaries enforced by ESLint and `validate.sh`. None of it is
Wayfinder-specific.

Phase 0 adds the foundations Wayfinder needs **without** building any
user-facing feature: the database schema, two new dependencies (React Flow,
docx), the `INodeExecutor` port + mock implementation, and the route-group
shells under which Phase 1 and Phase 2 will hang their pages.

## 2. Goals

- Database schema for flows, sessions, documents in place. `pnpm db:migrate`
  runs cleanly.
- `INodeExecutor` port exists in `packages/domain`. `MockNodeExecutor`
  exists in `packages/adapters`.
- `@xyflow/react` and `docx` installed in `apps/web` and `packages/adapters`
  respectively; type-check and lint pass.
- Route group shells exist:
  - `(user)/chats/page.tsx` — "no sessions yet" empty state.
  - `(user)/chats/[sessionId]/page.tsx` — 404 placeholder (real chat in Phase 2).
  - `(admin)/admin/flows/page.tsx` — "no flows yet" empty state.
  - `(admin)/admin/flows/[id]/page.tsx` — empty canvas placeholder.
- tRPC `flow.*` and `session.*` routers exist with stub procedures that
  return empty arrays. No real logic yet — Phase 1 and Phase 2 fill them in.
- `(admin)` middleware allows admin only; `(user)` middleware requires any
  authenticated user.
- Stub webhook route at `apps/api` `POST /v1/webhooks/n8n/:sessionId`
  returning `501 Not Implemented` after signature validation.

## 3. Non-goals

- No canvas behaviour (drag, connect, modal) — Phase 1.
- No chat UI or AI calls — Phase 2.
- No document generation — Phase 3.
- No seed data beyond admin user — Phase 4.
- No `N8nNodeExecutor` — Phase 5.

## 4. Key entities

| Entity                | Lives in                                                          | Status |
| --------------------- | ----------------------------------------------------------------- | ------ |
| `Flow`                | `packages/domain/src/entities/flow.ts`                            | new    |
| `FlowNode`            | `packages/domain/src/entities/flow-node.ts`                       | new    |
| `FlowEdge`            | `packages/domain/src/entities/flow-edge.ts`                       | new    |
| `FlowPermission`      | `packages/domain/src/entities/flow-permission.ts`                 | new    |
| `Session`             | `packages/domain/src/entities/session.ts`                         | new    |
| `SessionMessage`      | `packages/domain/src/entities/session-message.ts`                 | new    |
| `Document`            | `packages/domain/src/entities/document.ts`                        | new    |
| `INodeExecutor` port  | `packages/domain/src/ports/node-executor.ts`                      | new    |
| `MockNodeExecutor`    | `packages/adapters/src/node-executors/mock-node-executor.ts`      | new    |

Note: `packages/*` is consumed as `@rbrasier/*` npm deps in this repo, so
these new files land in the framework packages and are released together
as `@rbrasier/{domain,adapters} ^1.1.0`. The `apps/*` here pin to those
versions.

## 5. Pages / surfaces

| Path                                       | What ships in Phase 0                       |
| ------------------------------------------ | -------------------------------------------- |
| `(user)/chats/page.tsx`                    | Empty list state with "New Chat" disabled    |
| `(user)/chats/[sessionId]/page.tsx`        | Placeholder: "Session loading…" (no logic)   |
| `(admin)/admin/flows/page.tsx`             | Empty list state with "New Flow" disabled    |
| `(admin)/admin/flows/[id]/page.tsx`        | Empty canvas: React Flow surface rendered, no nodes |
| `apps/api` `POST /v1/webhooks/n8n/:sessionId` | Signature-validated; returns 501 with `{ error: 'n8n integration not enabled at MVP' }` |
| `apps/web` `/api/trpc/flow.*`              | Stub procedures returning `[]` or 404        |
| `apps/web` `/api/trpc/session.*`           | Stub procedures returning `[]` or 404        |

The existing landing page (`/`) continues to redirect authenticated users.
Phase 0 changes the redirect target: authenticated `user` → `/chats`,
authenticated `admin` → `/admin/flows`.

## 6. Database changes

Single Drizzle migration `00NN_app_wayfinder_schema.sql` adds:

| Table                   | Columns                                                                                                                  |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `app_flows`             | `id`, `name`, `description`, `icon`, `owner_user_id` (fk core_users), `status` (`draft`/`published`), `created_at`, `updated_at` |
| `app_flow_nodes`        | `id`, `flow_id` (fk), `type`, `name`, `colour`, `position_x int`, `position_y int`, `config jsonb`, `created_at`, `updated_at`   |
| `app_flow_edges`        | `id`, `flow_id` (fk), `from_node_id` (fk), `to_node_id` (fk), `created_at`                                               |
| `app_flow_context_docs` | `id`, `flow_id` (fk), `filename`, `mime_type`, `size_bytes`, `storage_path`, `created_at`                                |
| `app_flow_permissions`  | `id`, `flow_id` (fk), `user_id` (fk core_users), `permission` (`owner`/`viewer`), `created_at`. Unique `(flow_id, user_id)` |
| `app_sessions`          | `id`, `flow_id` (fk), `user_id` (fk), `status` (`active`/`complete`/`abandoned`), `title`, `current_node_id`, `graph_checkpoint jsonb`, `created_at`, `updated_at` |
| `app_session_messages`  | `id`, `session_id` (fk), `role`, `content`, `confidence smallint`, `step_node_id`, `created_at`. Append-only (no `updated_at`) |
| `app_documents`         | `id`, `session_id` (fk), `node_id` (fk), `filename`, `storage_path`, `summary`, `generated_at`, `created_at`, `updated_at` |

Indexes per ADR-006. Foreign keys `ON DELETE CASCADE` for child rows under
`app_flows` and `app_sessions`.

All names match `^app_[a-z_]+$` per CLAUDE.md.

## 7. Acceptance criteria

- [ ] `pnpm db:migrate` runs the Wayfinder schema migration cleanly on a
      fresh database.
- [ ] `pnpm typecheck` passes — `INodeExecutor` and `MockNodeExecutor` exist
      and the application layer can import the port type.
- [ ] `pnpm test` passes — `MockNodeExecutor` has a unit test asserting the
      stub return shape for at least one `nodeId`.
- [ ] `pnpm dev` runs both `apps/web` and `apps/api`. `apps/api` logs the
      stub webhook route on boot.
- [ ] Logged-in admin visiting `/admin/flows` sees the "no flows yet" empty
      state.
- [ ] Logged-in non-admin visiting `/admin/flows` is redirected (page route)
      or gets 403 (API route).
- [ ] Logged-in user visiting `/chats` sees the "no sessions yet" empty
      state.
- [ ] Unauthenticated visit to `/chats` is redirected to `/admin/login`
      (which already handles magic-link).
- [ ] `apps/web` bundle includes `@xyflow/react`; `apps/web/src/app/(admin)/admin/flows/[id]/page.tsx`
      renders a React Flow surface with `<ReactFlow nodes={[]} edges={[]} />`
      and a dot-grid background.
- [ ] `apps/api` `POST /v1/webhooks/n8n/<uuid>` with a valid HMAC signature
      returns 501; with an invalid or missing signature returns 401.
- [ ] `VERSION` and root `package.json#version` = `1.1.0`. `validate.sh`
      passes.

## 8. Build order (Claude Code session strategy)

Two sessions:

**Session 0a** — Schema + ports + framework packages

- Domain entities, ports, Drizzle schema, migration.
- `MockNodeExecutor` and its tests.
- Publish framework packages internally as `^1.1.0` (or workspace-link if
  the framework is co-developed in this branch).
- Bump `VERSION` and `package.json` to `1.1.0`.

**Session 0b** — Apps wiring + route shells + stub webhook

- Install `@xyflow/react` in `apps/web`, `docx` in `packages/adapters`.
- Create the four route-shell pages.
- Stub tRPC routers `flow.*` and `session.*`.
- Add Express stub at `POST /v1/webhooks/n8n/:sessionId` with signature
  middleware.
- Update `/` redirect to send admin → `/admin/flows`, user → `/chats`.

## 9. Risks / open questions

- The framework packages (`@rbrasier/*`) need a `^1.1.0` publish coordinated
  with the apps. If the framework is published from a separate repo, the
  publish PR is a prerequisite. Open question to the operator: are the
  framework packages co-developed in this branch, or imported as a pinned
  release?
- Adding columns to `core_users` (e.g. surfacing `role` rather than just
  `is_admin`) is **not** part of Phase 0 — we reuse `is_admin` per ADR-005.
  If a future ADR needs a real `role` enum column, that is a separate MINOR
  bump.

## 10. Validation

`./validate.sh` runs after Session 0b and must pass. The Build skill
moves this file to `docs/development/implemented/v1.1.0/` and writes an
implementation summary alongside.
