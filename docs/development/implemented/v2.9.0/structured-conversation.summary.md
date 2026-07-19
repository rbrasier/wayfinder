# Implementation Summary — Structured Conversation (v2.9.0)

- **Version**: 2.9.0 (bump: **MINOR** — new feature, additive `app_flow_nodes.config` jsonb; no migration)
- **PRD**: `docs/development/prd/structured-conversation.prd.md`
- **ADR**: `docs/development/adr/038-step-output-types.adr.md`
- **Phase**: `structured-conversation.phase.md` (this folder)

## What was built

A third conversational output type, **Structured conversation**, that captures
author-declared fields with no document — running the same extraction,
pre-generation confidence gate, manual editing, and Insights path as a template
step. `conversation_only` is relabelled **Unstructured conversation**; the stored
value is mapped for back-compat (no data movement). The document type is
unchanged and relabelled **Template**.

- **Three output types** in the conversational node editor: Template /
  Structured conversation / Unstructured conversation.
- **Inline field editor** for a structured step (reuses `TemplateFieldEditor`
  with the same `Label (annotation)` vocabulary); the `section` type is rejected
  client- and server-side.
- **Shared field-set accessor** (`nodeFieldSet`) is the single reader feeding
  extraction and the gate for both Template and Structured, so the two config
  slots (`documentTemplateFields` / `structuredFields`) never diverge.
- **Gate without generation**: a structured step runs extract → grade → the
  pre-generation gate, persists a `SessionStepOutput`, and generates **no**
  document.
- **DoneWhen** "all fields captured" (the `__TEMPLATE_COMPLETE__` sentinel) is
  shared wording and the structured default; its prompt expansion is now neutral.
- **Record card** on completion — the captured field values, editable through the
  reused manual-edit dialog (no document re-render).

## Key decisions / notes

- No schema change — `outputType` and `structuredFields` ride the existing
  `app_flow_nodes.config` jsonb.
- The pre-generation gate (`shouldEvaluateStepReadiness`) now runs for a
  structured step with declared fields (`hasFields`), not just a template step.
- Editing a structured record uses a dedicated `UpdateStructuredStepOutput`
  use-case (validate + rewrite the step output, no docx), routed from the shared
  `document.updateFields` tRPC endpoint; the `document.getFields` query returns
  the record for a structured step that has no document.
- `flow-session-graph` field-format guidance and the readiness gate treat legacy
  `conversation_only` and `unstructured` identically (the "else" branch), so
  unstructured behaviour is byte-identical to the old `conversation_only`.

## Files created

- `packages/domain/src/entities/node-output.ts` (+ `.test.ts`) —
  `OutputType`/`StoredOutputType`, `normaliseOutputType`, `nodeFieldSet`,
  `validateStructuredFieldSet`.
- `packages/application/src/use-cases/document/step-output-fields.ts` (+ test) —
  shared `buildStepOutputFields` helper.
- `packages/application/src/use-cases/document/capture-structured-output.ts`
  (+ test) — `CaptureStructuredStepOutput`.
- `packages/application/src/use-cases/document/update-structured-output.ts`
  (+ test) — `UpdateStructuredStepOutput`.
- `apps/web/src/components/chat/record-card.tsx` — the completion record card.
- `apps/web/src/app/api/chat/[sessionId]/stream/structured-capture.ts` —
  `captureStructuredRecord` advance helper.
- `apps/web/e2e/phase-structured-conversation.spec.ts` — e2e.

## Files modified (selected)

- `packages/domain/src/entities/flow-node.ts` — `outputType: StoredOutputType`;
  add `structuredFields`.
- `packages/application/src/use-cases/session/evaluate-step-readiness.ts` —
  resolve fields via `nodeFieldSet` (structured has no template path).
- `packages/application/src/use-cases/document/generate-document.ts` — reuse
  `buildStepOutputFields`.
- `packages/adapters/src/agents/flow-session-graph.ts` — field-format guidance
  and neutral sentinel wording for structured.
- `apps/web/src/components/canvas/output-type.ts` — three-value union;
  `doneWhenForOutputType` treats structured as field-backed.
- `apps/web/src/app/api/chat/[sessionId]/stream/readiness-gate.ts` — `hasFields`
  signal; run the gate for structured.
- `apps/web/src/app/api/chat/[sessionId]/stream/{execute-turn,turn-helpers}.ts` —
  pass `hasFields`; capture the structured record on advance.
- `apps/web/src/components/canvas/{node-config-modal,node-config-modal-conversational,template-field-editor,node-defaults}.tsx/.ts`
  — three-way selector, structured field editor (hide `section`), defaults.
- `apps/web/src/lib/canvas/rf-adapters.ts`,
  `apps/web/src/app/(user)/flows/[id]/config/_content.tsx` — normalise output
  type; carry `structuredFields`.
- `apps/web/src/server/routers/document.ts` — structured (no-document) branch in
  `getFields`/`updateFields`; `resolveDisplayFields` via `nodeFieldSet`.
- `apps/web/src/server/routers/flow.ts` — reject `section` in a structured set.
- `apps/web/src/components/chat/{message-feed,document-edit-dialog}.tsx` — render
  the record card; optional dialog title.
- `apps/web/src/lib/container.ts` — wire the two new use-cases.
- `apps/web/src/lib/e2e-fixtures.ts` — `seedStructuredSession`.

## Migrations run

None. No schema change (ADR-038 constraint 1).

## Known limitations

- The structured field editor is the line-based `TemplateFieldEditor` reused per
  ADR-038 ("reuse, don't fork"), not a bespoke row-with-dropdown + ⋮ overlay.
  Constraints are expressed through the same `(annotation)` vocabulary; the
  `section` type is rejected. Repeating groups are expressible via the tag
  syntax but a richer group sub-field UI is future work (PRD §11).
- The record card reuses the manual-edit dialog on completion (PRD §11 defers a
  richer always-on live record card).

## e2e tests

`apps/web/e2e/phase-structured-conversation.spec.ts` (driven by the /e2e MCP
skill against a running stack; excluded from the vitest unit run):

- **Config editor** — three output types shown; Structured reveals the field
  editor; a `section` field is rejected and blocks Save.
- **Record card** — a completed structured step (seeded via
  `seedStructuredSession`) renders the captured values with no document, and a
  value is editable through the reused manual-edit dialog.
