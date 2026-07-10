# Phase — Auto Node Type + n8n Sub-Workflow Integration

- **Status**: To be implemented
- **Target version**: TBD (bump: **MINOR** — new jsonb column on `app_sessions`
  + new behaviour, no breaking domain change. Set the exact version at build
  time and update `VERSION` + root `package.json#version` together.)
- **PRD**: `docs/development/prd/phase-5-auto-node-n8n.prd.md`
- **ADR**: `docs/development/adr/013-auto-node-structured-data.adr.md`
  (amends ADR-010)
- **Depends on**: the docx structured-data primitives (`TemplateField`,
  `buildFieldConstraintsText`, `generateObject`, `StepOutputField`) and the
  session-scoped LangGraph checkpoint (ADR-007).

## 1. Problem

The `auto` node type, the `INodeExecutor` port, `MockNodeExecutor`, and the
stubbed n8n webhook were laid down at Phase 0 but never connected. There is no
type-based dispatch, the executor is wired nowhere, and the webhook returns
`501`. This phase makes an `auto` node run an n8n sub-workflow: send a free-text
instruction plus gathered structured fields, receive structured JSON back,
persist it like any other step output, and advance.

## 2. Goals

- Reuse the docx structured-data primitives for auto-node request/response data
  (no parallel field system).
- Add `auto` dispatch to the session turn logic.
- Implement `N8nNodeExecutor` and wire executor selection in the container.
- Fill in the inbound webhook with best-effort coercion + resume.
- Correlate async callbacks via a jsonb map on `app_sessions`.

## 3. Non-goals

- Approval-gate UI (`pending_approval` stays unused).
- Timeout/retry/dead-letter for auto nodes.
- Per-node n8n credentials beyond the shared `N8N_WEBHOOK_SECRET`.
- Any change to the conversational turn behaviour.

## 4. Approach

Build inward-out, tests first (the CLAUDE.md rule: write the test file before
the implementation file). Each step keeps the working docx path green.

### Step 1 — Domain: `AutoNodeConfig` + port update

- `packages/domain/src/entities/flow-node.ts`: add `AutoNodeConfig`
  (`instruction`, `executor: "n8n" | "mock"`, `webhookUrl`,
  `requestFields?: TemplateField[]`, `responseFields?: TemplateField[]`).
- `packages/domain/src/ports/node-executor.ts`: add `instruction: string`,
  `flowSlug: string`, `sessionTitle: string`; tighten `fields` to
  `Record<string, string>`. Leave `pending_approval` in the output union.
- No new `TemplateField` work — it already exists and is reused verbatim.

### Step 2 — Application: shared `extractStructuredFields`

- Factor the field-extraction block out of
  `packages/application/src/use-cases/document/generate-document.ts` into a
  shared helper (same `document/` folder or a `structured-fields.ts` module):
  `extractStructuredFields(fields, transcript, contextDocs)` →
  `Result<Record<string, string>>`, using `buildFieldConstraintsText` +
  `languageModel.generateObject({ schema: documentDataSchema })`.
- Refactor `GenerateDocument` to call it. **Behaviour-preserving** — the
  existing docx tests must pass unchanged.
- New use case `RunAutoNode` (application): given an `auto` node + session
  transcript, call `extractStructuredFields(requestFields, …)` to build `fields`,
  assemble `NodeExecutionInput` (with `instruction`, `flowSlug`, `sessionTitle`,
  a generated `correlationId`), record the pending entry, and call
  `INodeExecutor.execute(...)`.

### Step 3 — Application: inbound coercion + persist + advance

- New helper `coerceStructuredFields(responseFields, data)` → `StepOutputField[]`:
  best-effort, keep valid matches, blank the rest, never throw/fail.
- New use case `ApplyAutoNodeResult` (application): validate the callback
  against the session's `pending_executions` map (ignore stale/duplicate),
  coerce, persist via `ISessionStepOutputRepository`, clear the pending entry,
  resume the checkpoint, advance to the next node.

### Step 4 — Adapters: `N8nNodeExecutor` + schema column

- `packages/adapters/src/node-executors/n8n-node-executor.ts`: implement
  `INodeExecutor`. Signed POST (`X-N8n-Signature` = HMAC-SHA256 of body with
  `N8N_WEBHOOK_SECRET`) to `input`'s node `webhookUrl`, body
  `{ instruction, fields, correlationId, nodeId, sessionId, flowSlug,
  sessionTitle, userId, userRole }`. Result pattern; never throw across the
  boundary. Returns `pending` semantics via `NodeExecutionOutput` (the real
  result arrives by callback).
- Update `MockNodeExecutor` to the new `NodeExecutionInput` shape.
- `packages/adapters/src/db/schema/wayfinder.ts`: add
  `pending_executions jsonb not null default '{}'` to `app_sessions`.
- `packages/adapters/drizzle/<next>.sql`: migration adding the column.
- Extend the session repository read/write to round-trip `pending_executions`.

### Step 5 — Container wiring + dispatch

- `apps/web` container / `packages/adapters/src/factory.ts`: register
  `INodeExecutor` — `N8nNodeExecutor` when `N8N_WEBHOOK_SECRET` is set, else
  `MockNodeExecutor`.
- Session turn logic (`run-turn` / `flow-session-graph`): add the
  `node.type === "auto"` branch that invokes `RunAutoNode` instead of the
  conversational AI turn.

### Step 6 — Webhook handler

- `apps/api/src/routes/webhooks.ts`: replace the `501` with a call into
  `ApplyAutoNodeResult` (via the container). Keep the existing signature
  verification. Map outcomes to status codes (200 applied, 200/204 ignored for
  stale/duplicate, 401 bad signature, 4xx malformed body).

### Step 7 — Canvas config UI

- Node-config modal gains an `auto`-type variant: instruction textarea,
  request-fields editor, response-fields editor (both reusing the
  `parseTemplateField` annotation syntax + its validation errors), webhook URL
  input. Persists into `app_flow_nodes.config`.

## 5. Key entities / files

| Layer | File | Change |
|-------|------|--------|
| domain | `packages/domain/src/entities/flow-node.ts` | add `AutoNodeConfig` |
| domain | `packages/domain/src/ports/node-executor.ts` | add `instruction`, `flowSlug`, `sessionTitle`; tighten `fields` |
| application | `packages/application/src/use-cases/document/generate-document.ts` | refactor to use shared extractor |
| application | `packages/application/src/use-cases/.../structured-fields.ts` | new `extractStructuredFields` + `coerceStructuredFields` |
| application | `packages/application/src/use-cases/session/run-auto-node.ts` | new `RunAutoNode` |
| application | `packages/application/src/use-cases/session/apply-auto-node-result.ts` | new `ApplyAutoNodeResult` |
| adapters | `packages/adapters/src/node-executors/n8n-node-executor.ts` | new `N8nNodeExecutor` |
| adapters | `packages/adapters/src/node-executors/mock-node-executor.ts` | update to new input shape |
| adapters | `packages/adapters/src/db/schema/wayfinder.ts` | `app_sessions.pending_executions jsonb` |
| adapters | `packages/adapters/drizzle/<next>.sql` | migration |
| adapters | `packages/adapters/src/factory.ts` | executor selection |
| adapters | `packages/adapters/src/agents/flow-session-graph.ts` / run-turn | `auto` dispatch branch |
| api | `apps/api/src/routes/webhooks.ts` | implement handler |
| web | node-config modal component(s) | `auto`-type config UI |

## 6. Test plan (write tests first)

- `extractStructuredFields` — fields → constraints prompt → keyed JSON; reuses
  docx fixtures. Existing `generate-document` tests stay green after refactor.
- `coerceStructuredFields` — matched kept, missing/invalid blanked, never fails;
  options/type/optional honoured.
- `MockNodeExecutor` / `N8nNodeExecutor` — input shape, signed body, Result on
  network error (mock the HTTP client).
- Webhook handler — valid signature + good body advances; invalid signature 401;
  stale/duplicate correlation id ignored (no double-advance); best-effort
  coercion path; two concurrent sessions get their own callbacks.
- Dispatch — `auto` node calls the executor and skips the conversational turn;
  `conversational` node unchanged.

## 7. Acceptance criteria

Inherit PRD §10. Plus: `./validate.sh` passes; `VERSION` and root
`package.json#version` match the chosen target version; the architecture rules
hold (`AutoNodeConfig`/port in domain, `N8nNodeExecutor` in adapters, webhook in
`apps/api`, Result pattern at every boundary).

## 8. Notes for the build

- Confirm `documentDataSchema` (`z.record(z.string())`) is the right shared
  schema for the extractor, or whether a per-field discriminated schema is
  warranted — start with the existing record schema for parity with docx.
- Verify the n8n outbound HTTP client choice against `node_modules` (don't rely
  on training data for the AI SDK / HTTP API shapes).
- Decide the exact version at build time and bump in the same commit as the
  schema migration.
- Run the security review skill before declaring done — flag the flow-owner-
  authored `webhookUrl` egress consideration.
