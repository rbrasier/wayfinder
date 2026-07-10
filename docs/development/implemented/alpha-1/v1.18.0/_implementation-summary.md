# Implementation Summary — v1.18.0

**Phase**: Auto Node Type + n8n Sub-Workflow Integration
**Phase doc**: `phase-5-auto-node-n8n.md` (this folder)
**PRD**: `docs/development/prd/phase-5-auto-node-n8n.prd.md`
**ADR**: `docs/development/adr/013-auto-node-structured-data.adr.md`
**Version bump**: **MINOR** — `1.16.2` → `1.18.0` (new jsonb column + new behaviour, no
breaking domain change).

## What was built

An `auto` node now runs an n8n sub-workflow: when a session advances into an auto
node, Wayfinder gathers the node's request fields from the conversation, signs and
POSTs them to the node's n8n webhook, and records a pending execution. When n8n
calls back, the response is best-effort coerced against the declared response
fields, persisted as a step output, and the session advances. Auto-node structured
data reuses the existing docx primitives (`TemplateField`, the
`generateObject` gather-into-JSON path, `StepOutputField`).

The whole feature is gated behind the **`auto_node` feature flag** (seeded
**disabled** by the migration). An admin enables it from the feature-flag admin
surface to use and test auto nodes before the feature is fully released. While the
flag is off, sessions never dispatch the auto path and the canvas does not offer
the auto step type.

## Feature flag (per the build request)

Migration `0013_mighty_groot.sql` seeds `core_feature_flag` with
`auto_node` (`enabled = false`, `ON CONFLICT (key) DO NOTHING`). Gating:

- **Dispatch** — the session stream route only runs the auto path when
  `isAutoNodeEnabled(container)` (flag enabled) is true; otherwise an advanced-into
  auto node falls back to the normal initial-message behaviour.
- **Authoring** — the canvas node-config modal only shows the "Automated (n8n)"
  step type when `featureFlag.isEnabled({ key: "auto_node" })` is true.

## Files created

- `packages/application/src/use-cases/document/structured-fields.ts` (+ test) —
  shared `extractStructuredFields` / `coerceStructuredFields`, `buildContextDocsSection`.
- `packages/application/src/use-cases/session/run-auto-node.ts` (+ test) — `RunAutoNode`.
- `packages/application/src/use-cases/session/apply-auto-node-result.ts` (+ test) — `ApplyAutoNodeResult`.
- `packages/adapters/src/node-executors/n8n-node-executor.ts` (+ test) — `N8nNodeExecutor` (signed POST).
- `packages/adapters/drizzle/0013_mighty_groot.sql` — adds the `pending_executions` column and seeds the `auto_node` feature flag (disabled).
- `apps/api/src/routes/webhooks.test.ts` — webhook handler tests.
- `apps/web/src/components/canvas/auto-node.tsx` — auto node canvas rendering.
- `apps/web/src/components/canvas/template-field-editor.tsx` (+ test) — field editor reusing `parseTemplateField`.

## Files modified

- **domain**: `entities/flow-node.ts` (`AutoNodeConfig`, `NodeExecutorKind`),
  `ports/node-executor.ts` (added `instruction`, `flowSlug`, `sessionTitle`,
  `correlationId`, `webhookUrl`; `fields: Record<string,string>`; `pending` status),
  `entities/session.ts` (`PendingExecution(s)`), `ports/session-repository.ts`,
  `ports/flow-node-repository.ts` (`type?` on update).
- **application**: `use-cases/document/generate-document.ts` refactored to use the
  shared extractor (behaviour-preserving); session/document index exports.
- **adapters**: `db/schema/wayfinder.ts` (`app_sessions.pending_executions`),
  `repositories/drizzle-session-repository.ts` (round-trip),
  `repositories/drizzle-flow-node-repository.ts` (type update),
  `node-executors/mock-node-executor.ts` (+ test) new input shape,
  `node-executors/index.ts` (`createNodeExecutor` selector).
- **api**: `routes/webhooks.ts` (implemented; was 501), `container.ts`
  (wired `ApplyAutoNodeResult` + repos), `app.ts`.
- **web**: `lib/container.ts` (`RunAutoNode`, `createNodeExecutor`), `lib/env.ts`
  (`N8N_WEBHOOK_SECRET`), stream `route.ts` + `turn-helpers.ts` (flag-gated auto
  dispatch), `server/routers/flow.ts` (node `type` in/out),
  `server/routers/feature-flag.ts` (`isEnabled`),
  `components/canvas/node-config-modal.tsx` (auto variant),
  `app/(user)/flows/[id]/config/_content.tsx` (auto node wiring).

## Migrations run

`0013_mighty_groot.sql`:
1. `ALTER TABLE app_sessions ADD COLUMN pending_executions jsonb NOT NULL DEFAULT '{}'`.
2. `INSERT` the `auto_node` feature flag (disabled) with `ON CONFLICT DO NOTHING`.

## Known limitations

- **Approval gate** (`pending_approval`) remains unused — deferred (PRD §4).
- **No timeout/retry/dead-letter** for auto nodes; a stuck execution is only
  observable via `pending_executions.sentAt`.
- **Branch after an auto node**: a callback cannot make an AI branch choice, so a
  fork (multiple outgoing edges) is left at the current node rather than guessed.
- **Mock executor** completes synchronously (echoes fields) but the current dispatch
  path treats it like n8n (pending); full mock auto-advance is not wired this phase.
- **Chat input** is not specially suppressed for an in-flight auto step; completion
  surfaces via the existing system-message mechanism.
- **Webhook egress**: the flow-owner-authored `webhookUrl` is an egress concern; the
  signature proves the body, not the destination (flagged in ADR-013 / PRD §12).
