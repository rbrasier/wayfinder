# Phase — Manual Document Editing in Flows

- **Status**: Awaiting review (`/doc-review`)
- **Target version**: **MINOR** — 1.38.0 → 1.39.0 (new feature; JSONB-shape
  change only, no DDL)
- **PRD**: `docs/development/prd/manual-document-editing.prd.md`
- **ADR**: `docs/development/adr/024-manual-document-field-editing.adr.md`
- **Depends on**: ADR-009 (docxtemplater generation), ADR-018 (approval
  snapshot)

## 1. Goal

Let the session operator correct a generated document's field values in a
form; saving updates the step outputs (what the flow actually consumes),
re-renders the DOCX at a new versioned storage path, and marks the document as
edited — so the corrected document proceeds to approval and downstream steps
with no change to advancement logic.

## 2. Approach

Field-level edit + re-render (ADR-024). New application use-case
`UpdateDocumentFields` over existing ports; a `document` tRPC router; an edit
dialog launched from the document card. Edits are server-side blocked on
non-active sessions, after any approval snapshot, and where the node disables
manual editing. No grading re-run; AI summary refreshed best-effort; audit
event on every edit.

## 3. What is built

Tests are written before each implementation file (tests are the spec).

| Layer | File | Change |
|-------|------|--------|
| domain | `packages/domain/src/entities/session-message.ts` | `SessionDocument` gains optional `editedAt: string \| null`, `editedByUserId: string \| null`. |
| domain | `packages/domain/src/entities/flow-node.ts` | `ConversationalNodeConfig` gains `allowManualEdit?: boolean` (default `true`). |
| domain | `packages/domain/src/entities/template-field.ts` (+ test) | New pure `validateTemplateFieldValue(field, value): Result<string>` — options membership, `maxLength`, `min`/`max`, `yesno`/section values, required-ness. Reuses existing type vocabulary; never throws. |
| domain | `packages/domain/src/ports/session-step-output-repository.ts` | Add `findByMessageId(messageId): Promise<Result<SessionStepOutput \| null>>` and `updateFields(id, fields): Promise<Result<SessionStepOutput>>`. |
| domain | `packages/domain/src/ports/approval-repository.ts` | Add (or reuse if present) a query to detect a recorded snapshot for a session, e.g. `hasRecordedSnapshot(sessionId): Promise<Result<boolean>>`. |
| adapters | `packages/adapters/src/db/repositories/...` (+ tests) | Implement the two new step-output methods and the snapshot query. `updateFields` also bumps `updated_at`. No schema change. |
| application | `packages/application/src/use-cases/document/update-document-fields.ts` (+ test **first**) | Orchestration: load message/session/node → guard (active, no snapshot, `allowManualEdit`) → resolve `TemplateField`s (config else `extractFields`, mirroring `GenerateDocument.resolveFields`) → validate all values (collect per-field errors) → render via `IDocumentGenerator.generate` with section→boolean mapping → `objectStorage.put` at `generated/{sessionId}/{basename}-r{n}.docx` (previous object retained) → `sessionStepOutputs.updateFields` → `sessionMessages.updateDocument` with new path + edited stamps → best-effort summary refresh → audit `document.fields_edited`. Result pattern throughout. |
| application | `packages/application/src/use-cases/document/generate-document.ts` | Extract the shared render-data mapping (section → boolean) to a small exported helper so generate and edit cannot drift; regenerate clears `editedAt`/`editedByUserId`. |
| apps/web | `apps/web/src/server/routers/document.ts` (+ test **first**) | New router: `getFields` (fields + current values + `editable` flag + reason when not editable) and `updateFields` (zod input; returns per-field validation errors or updated `SessionDocument`). Same relaxed participant-access model as the documents API route. Register in the root router. |
| apps/web | `apps/web/src/components/chat/document-edit-dialog.tsx` | Field-edit form: input per `TemplateFieldType` (text, date, currency, number, email, yesno select, options select / multi-options checkboxes, narrative textarea, section include/omit switch). Per-field error display; save / cancel. |
| apps/web | `apps/web/src/components/chat/document-card.tsx` | **Edit** action beside Download/Regenerate (hidden when not editable); "Edited by … on …" marker; warn before Regenerate on an edited document. |
| apps/web | flow designer step config (advanced mode component) | `allowManualEdit` toggle for conversational nodes with document output. |
| repo | `VERSION`, root `package.json` | 1.39.0. |

## 4. Database changes

**None (no DDL).** `app_session_messages.document` JSONB gains two keys;
`app_session_step_outputs.fields`/`updated_at` rows become updatable;
`core_audit_log` gains the `document.fields_edited` event type.

## 5. Implementation order

1. Domain: `validateTemplateFieldValue` test → implementation.
2. Domain: entity/port additions (`SessionDocument` stamps, `allowManualEdit`,
   step-output + approval port methods).
3. Adapters: repository method tests → implementations.
4. Application: `UpdateDocumentFields` test (guards, validation, versioned
   path, stamps, no grading) → implementation; extract shared render-data
   helper; regenerate clears edited stamps.
5. Web: `document` router test → router; edit dialog; document-card wiring;
   designer toggle.
6. Bump `VERSION` + `package.json`; run `./validate.sh`; fix all failures.

## 6. Acceptance criteria

Mirror PRD §10:

- [ ] Edit action appears only on active sessions, nodes allowing manual edit,
      and before any approval snapshot — and the server enforces the same.
- [ ] Form is pre-filled from the step output; inputs are typed per field.
- [ ] Invalid values return per-field errors; nothing persists on failure.
- [ ] Save updates step-output fields, re-renders the DOCX to a new `-r{n}`
      storage path, retains the prior object, and stamps
      `editedAt`/`editedByUserId`.
- [ ] Download serves the edited DOCX; card shows edited marker + refreshed
      summary.
- [ ] A subsequent approval snapshots the edited values.
- [ ] Regenerate still works and clears the edited stamps (after a UI warning).
- [ ] `document.fields_edited` audit event written (message id, editor,
      changed keys).
- [ ] Grading confidence not re-run on edit.
- [ ] `./validate.sh` passes; `VERSION` = `package.json` = `1.39.0`.

## 7. Risks / open questions

Carried from PRD §12: session-level edit lock may be too coarse for
multi-approval flows (revisit when a real flow needs per-step locks);
last-write-wins on concurrent collaborative edits (versioned paths preserve
both renders); re-render uses the template as it exists now (already true of
Regenerate); narrative fields edit as raw text.
