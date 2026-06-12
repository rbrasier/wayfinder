# PRD — Manual Document Editing in Flows

- **Status**: Draft
- **Date**: 2026-06-12
- **Author**: Richy Brasier
- **Target version**: 1.39.0 (bump: MINOR — new feature, JSONB-shape change only, no DDL)

## 1. Problem

When a conversational step generates a document, the AI-extracted field values
are sometimes wrong or incomplete — a misspelt supplier name, an outdated
amount, a date the conversation never pinned down. Today the operator's only
remedies are to keep talking to the AI until regeneration gets it right, or to
download the DOCX and fix it outside Wayfinder — at which point the corrected
document is invisible to the rest of the flow: approvals snapshot the stale
values and downstream steps consume them.

## 2. Users / Personas

- **Session operator** (procurement officer, HR manager, ops lead) — needs to
  correct specific values in a generated document quickly, without prompt
  wrangling, so the corrected document is what proceeds to approval and later
  steps.
- **Approver** — needs confidence that the document they approved is the
  document of record; their approval snapshot must not be silently editable
  afterwards.
- **Flow designer** — needs to control whether a given step permits manual
  edits at all.

## 3. Goals

- The operator can open a generated document's fields in a form, pre-filled
  with the current values, edit them, and save.
- Saving updates the step output record, re-renders the DOCX from the same
  template, and replaces the downloadable document — document and structured
  data can never diverge.
- The edited values are what approval snapshots capture and what downstream
  steps consume; no change to advancement logic is required.
- Edited documents are visibly marked (who edited, when) in the session UI.
- Edits are blocked once an approval snapshot has been recorded for the
  session, and on non-active sessions.
- Every edit writes an audit event.

## 4. Non-goals

- **No free-form DOCX editing.** Upload-replace of an externally edited file
  and in-browser DOCX editing (OnlyOffice et al.) are explicitly deferred —
  see ADR-024.
- **No version-history table.** v1 keeps minimal versioning (retained prior
  files in object storage + edited-by metadata); a browsable revision history
  is future work.
- **No re-grading.** A manual edit does not re-run document-grading
  confidence; the human edit is authoritative. The AI summary is refreshed.
- **No reopening completed sessions.** Session immutability after completion
  is unchanged.

## 5. Key entities

| Entity | Lives in | New / existing | Notes |
| ------ | -------- | -------------- | ----- |
| `SessionDocument` | `packages/domain/src/entities/session-message.ts` | existing | Gains optional `editedAt: string \| null`, `editedByUserId: string \| null`. JSONB on `app_session_messages.document` — no migration. |
| `SessionStepOutput` / `StepOutputField` | `packages/domain/src/entities/session-step-output.ts` | existing | Field values become updatable; they are what flows downstream. |
| `TemplateField` | `packages/domain/src/entities/template-field.ts` | existing | Drives the edit form (type, options, maxLength, min/max, optional). Gains a pure value-validation helper. |
| `ConversationalNodeConfig` | `packages/domain/src/entities/flow-node.ts` | existing | Gains optional `allowManualEdit?: boolean` (default `true`); flow designers can disable editing per step. |
| `UpdateDocumentFields` | `packages/application/src/use-cases/document/update-document-fields.ts` | new | Validate → re-render DOCX → versioned put → update document metadata + step output → refresh summary → audit. |

## 6. User stories

1. As a session operator, I can click **Edit** on a generated document card
   and see every template field with its current value, so that I can correct
   mistakes without re-prompting the AI.
2. As a session operator, I can save my edits and immediately download a DOCX
   that reflects them, so that the corrected document is the one that proceeds
   down the flow.
3. As an approver, I see edited values (and an "edited" marker) when I review,
   and I know the document cannot be edited after I approve, so that my
   approval stays meaningful.
4. As a flow designer, I can turn manual editing off for a step where the
   document must be purely AI-derived.
5. As an auditor, I can see in the audit log who edited which document and
   when.

## 7. Pages / surfaces affected

- Session chat — `apps/web/src/components/chat/document-card.tsx`: new
  **Edit** action (alongside Download / Regenerate), an "Edited by X on Y"
  marker, and a new field-edit dialog component.
- tRPC: new `document` router (`apps/web/src/server/routers/document.ts`):
  - `document.getFields` — fields + current values + `editable` flag for a
    document message.
  - `document.updateFields` — submit edited values; returns per-field
    validation errors or the updated document metadata.
- Flow designer step config (advanced mode): `allowManualEdit` toggle on
  conversational nodes with document output.
- `apps/web/src/app/api/documents/[documentId]/route.ts` — unchanged
  behaviour; GET serves whatever `storagePath` currently points at, POST
  (regenerate) overwrites edits by design (it re-extracts from the
  conversation) and clears the edited marker.

## 8. Database changes

| Table | Change | Prefix valid? |
| ----- | ------ | ------------- |
| `app_session_messages` | JSONB shape only: `document` gains `editedAt` / `editedByUserId` keys | yes (app_) — no DDL |
| `app_session_step_outputs` | rows become updatable (`fields`, `updated_at`); no schema change | yes (app_) — no DDL |
| `core_audit_log` | new event type `document.fields_edited` | n/a — no DDL |

No new tables, no migrations.

## 9. Architectural decisions

- **ADR-024 — Manual document field editing (edit fields + regenerate)** (new,
  introduced by this PRD): why field-level editing was chosen over
  upload-replace and in-browser DOCX editing, and the minimal-versioning
  storage scheme.
- Assumes ADR-009 (document generation via docxtemplater), ADR-018 (approval
  node + snapshot).

## 10. Acceptance criteria

- [ ] A generated document card on an active session shows an **Edit** action
      when the node's config allows manual edit and no approval snapshot
      exists for the session.
- [ ] The edit form renders one input per template field, typed by
      `TemplateFieldType` (text, date, currency, number, email, yesno,
      options/multi-options, narrative, section include/omit), pre-filled from
      the step output.
- [ ] Invalid values (options mismatch, maxlen/min/max breach, missing
      required field) are rejected with per-field messages; nothing is
      persisted on validation failure.
- [ ] Saving updates `app_session_step_outputs.fields`, re-renders the DOCX
      from the node's template, and stores it at a **new** storage path; the
      previous object is retained in MinIO.
- [ ] After saving, GET `/api/documents/{messageId}` downloads the edited
      DOCX, and the document card shows the edited marker and refreshed AI
      summary.
- [ ] An approval requested after the edit snapshots the **edited** values.
- [ ] Editing is blocked (server-side, not just UI) when: the session is not
      `active`, an approval snapshot has been recorded for the session, or the
      node config has `allowManualEdit: false`.
- [ ] Regenerate (POST) still works and clears `editedAt` / `editedByUserId`.
- [ ] A `document.fields_edited` audit event is written with the message id,
      editor user id, and changed field keys.
- [ ] Document-grading confidence is **not** re-run on edit.
- [ ] `./validate.sh` passes; `VERSION` and root `package.json` read `1.39.0`.

## 11. Out of scope / future work

- Upload-replace of an externally edited DOCX (with AI re-extraction of field
  values) — revisit if field-level editing proves insufficient for free-form
  changes.
- In-browser DOCX editing (OnlyOffice / Collabora).
- A browsable `app_session_document_versions` history with diff view; v1 only
  retains prior objects in storage.
- Approver-initiated edits during review (v1 is operator-only; approvers use
  "changes_requested").
- Before/after field values in the audit payload (v1 records changed keys
  only).

## 12. Risks / open questions

- **Edit-lock granularity.** v1 locks edits once *any* approval snapshot
  exists for the session. Multi-approval flows might reasonably want
  "documents from steps after the approved one stay editable" — deferred until
  a real flow needs it.
- **Concurrent edits.** Collaborative sessions mean two participants could
  edit simultaneously; last-write-wins in v1 (consistent with the existing
  relaxed participant-write model). The versioned storage paths preserve both
  renders.
- **Stale template.** If the flow's template was re-uploaded after generation,
  re-rendering uses the current template, so layout may differ from the
  original render. Acceptable: the same is already true of Regenerate.
- **Narrative fields.** Long AI-composed prose is editable as a textarea —
  usable, but the operator is editing raw text without formatting. Acceptable
  for v1.
