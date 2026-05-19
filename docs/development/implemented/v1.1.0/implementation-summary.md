# v1.1.0 — Phase 0: Wayfinder Foundation

**Version bump**: `1.0.8` → `1.1.0` (MINOR — schema addition + new port + new dependencies)
**Date**: 2026-05-19

## What was built

Phase 0 lays the Wayfinder-specific foundations without building any user-facing
feature logic. Every item below is a stub or empty state — Phase 1 and Phase 2
fill in the real behaviour.

### Workspace packages restored to local co-development

`packages/` was re-introduced as a local pnpm workspace alongside `apps/`.
The framework packages (`@rbrasier/domain`, `@rbrasier/adapters`,
`@rbrasier/application`, `@rbrasier/shared`) are now at `1.1.0` and live
locally, overriding the previously pinned npm versions.

### Database schema (5 tables, consolidated from original 8)

ADR-006 was revised to embed permissions, context docs, and generated document
metadata as `jsonb` columns rather than separate tables. The resulting schema:

| Table                  | Purpose |
| ---------------------- | ------- |
| `app_flows`            | Flow definitions; includes `permissions jsonb` and `context_docs jsonb` |
| `app_flow_nodes`       | Canvas nodes per flow |
| `app_flow_edges`       | Directed edges between nodes |
| `app_sessions`         | User runs of a flow |
| `app_session_messages` | Append-only chat history; includes `document jsonb` for generated DOCX metadata |

Migration: `packages/adapters/drizzle/0004_app_wayfinder_schema.sql`

### Domain layer (`packages/domain`)

New entities:
- `Flow`, `FlowPermission` (embedded), `FlowContextDoc` (embedded) — `entities/flow.ts`
- `FlowNode` — `entities/flow-node.ts`
- `FlowEdge` — `entities/flow-edge.ts`
- `Session` — `entities/session.ts`
- `SessionMessage`, `SessionDocument` (embedded) — `entities/session-message.ts`

New port:
- `INodeExecutor` — `ports/node-executor.ts`

### Adapter layer (`packages/adapters`)

New adapters:
- `MockNodeExecutor` — `src/node-executors/mock-node-executor.ts`
  (5 unit tests; returns `status: 'completed'` for any input)
- Wayfinder Drizzle schema — `src/db/schema/wayfinder.ts`

New dependency: `docx ^9.6.1` (used by Phase 3 document generation)

### Web app (`apps/web`)

New dependency: `@xyflow/react ^12.x`

New route shells:
- `(user)/chats/page.tsx` — "no sessions yet" empty state, "New Chat" disabled
- `(user)/chats/[sessionId]/page.tsx` — "Session loading…" placeholder
- `(admin)/admin/flows/page.tsx` — "no flows yet" empty state, "New Flow" disabled
- `(admin)/admin/flows/[id]/page.tsx` — React Flow canvas surface with dot-grid background

Updated pages:
- `(user)/page.tsx` — now resolves the session and redirects:
  - admin → `/admin/flows`
  - authenticated user → `/chats`
  - unauthenticated → `/admin/login`

Updated middleware:
- `src/middleware.ts` — `/chats` and `/chats/*` now guarded (redirects to login if no session cookie)

New tRPC stub routers:
- `flow.list`, `flow.get` — admin-only, return `[]` / `null`
- `session.list`, `session.get` — authenticated, return `[]` / `null`

### API app (`apps/api`)

New env var: `N8N_WEBHOOK_SECRET` (optional; required for real n8n integration in Phase 5)

New webhook route: `POST /v1/webhooks/n8n/:sessionId`
- Validates `X-N8n-Signature` HMAC-SHA256 against `N8N_WEBHOOK_SECRET`
- Missing/invalid secret or signature → 401
- Valid signature → 501 `{ error: 'n8n integration not enabled at MVP' }`

API tsconfig switched from `NodeNext` to `Bundler` module resolution to support
source-first workspace package resolution.

## Files created / modified

### Created
- `packages/domain/` — full workspace package (entities, ports, result, errors)
- `packages/adapters/` — full workspace package (existing adapters + wayfinder schema + MockNodeExecutor)
- `packages/application/` — full workspace package (existing use cases)
- `packages/shared/` — full workspace package (existing Zod schemas)
- `packages/adapters/drizzle/0004_app_wayfinder_schema.sql`
- `apps/web/src/app/(user)/chats/page.tsx`
- `apps/web/src/app/(user)/chats/[sessionId]/page.tsx`
- `apps/web/src/app/(admin)/admin/flows/page.tsx`
- `apps/web/src/app/(admin)/admin/flows/[id]/page.tsx`
- `apps/web/src/server/routers/flow.ts`
- `apps/web/src/server/routers/session.ts`
- `apps/api/src/routes/webhooks.ts`

### Modified
- `pnpm-workspace.yaml` — added `packages/*`
- `apps/web/package.json` — workspace deps, added `@xyflow/react`
- `apps/api/package.json` — workspace deps, added `N8N_WEBHOOK_SECRET` env
- `apps/api/tsconfig.json` — switched to Bundler module resolution
- `apps/web/src/app/(user)/page.tsx` — role-based redirect
- `apps/web/src/middleware.ts` — guards `/chats` routes
- `apps/web/src/server/router.ts` — added `flow` and `session` routers
- `apps/api/src/app.ts` — wired `/v1/webhooks` router
- `apps/api/src/env.ts` — added `N8N_WEBHOOK_SECRET`
- `docs/development/adr/006-wayfinder-flow-and-session-schema.adr.md` — revised to 5-table design
- `docs/development/prd/wayfinder.prd.md` — updated schema section

## Migrations run

None yet — `DATABASE_URL` not set in this environment. Run `pnpm db:migrate`
once the database is up.

## Known limitations

- `@xyflow/react` canvas stylesheet is imported via `"use client"` page — the
  CSS import works in Next.js but requires the page to be a client component.
- `document` jsonb on `app_session_messages` is append-only by design. A
  regenerated document produces a new assistant message rather than updating
  the existing one.
- `N8N_WEBHOOK_SECRET` is optional; if unset, the webhook endpoint returns 401
  immediately (cannot validate unsigned requests).
