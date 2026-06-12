# ADR-024 — Manual Document Editing via Field-Level Edit + Re-Render

- **Status**: Proposed (scoped by `manual-document-editing.prd.md`)
- **Date**: 2026-06-12

## Context

`manual-document-editing.prd.md` lets a session operator correct a generated
document so the corrected version proceeds down the flow. The decisive
architectural fact is that **downstream steps never read the DOCX**: they
consume the structured field values in `app_session_step_outputs` (plus
conversation history), and approval snapshots capture those same values
(ADR-018). The DOCX is a *render* — docxtemplater output of a template plus
field values (ADR-009, `GenerateDocument` in
`packages/application/src/use-cases/document/generate-document.ts`).

So "the edited document proceeds down the flow" actually means "the edited
**field values** proceed down the flow, and the DOCX is re-rendered to match."
Any design that edits the DOCX binary directly leaves the step outputs — the
thing the flow runs on — stale.

Constraints:

1. **Hexagonal boundary (ADR-001).** Editing logic is an application use-case
   over existing ports (`IDocumentGenerator`, `IObjectStorage`,
   `ISessionMessageRepository`, `ISessionStepOutputRepository`); no new
   framework dependencies in domain/application.
2. **Governance.** Wayfinder's positioning is governed workflows: edits must be
   attributable, auditable, and impossible after an approval snapshot.
3. **End-user operator.** The editor is a procurement officer or HR manager,
   not someone who should learn a new document editor.
4. **No editor dependency exists.** `apps/web` has no rich-text/DOCX editing
   library today.

## Decision

### Edit the fields, re-render the document

Manual editing is a **form over the node's `TemplateField`s**, not a document
editor:

1. The web app fetches the document message's template fields and current
   values (from the step output row linked by `message_id`) via a new
   `document` tRPC router.
2. The operator edits values in typed inputs (text, date, currency, number,
   email, yesno, options / multi-options, narrative textarea, section
   include/omit toggle) — the same `TemplateFieldType` vocabulary that drives
   generation.
3. A new `UpdateDocumentFields` use-case validates the submitted values against
   the `TemplateField` constraints (pure domain helper — options membership,
   `maxLength`, `min`/`max`, required-ness), then:
   - updates the step output row's `fields`,
   - re-renders the DOCX from the node's template with the same render-data
     mapping `GenerateDocument` uses (sections → boolean),
   - stores the render at a **new versioned storage key**,
   - stamps `SessionDocument` with `editedAt` / `editedByUserId` and the new
     `storagePath`,
   - appends a `DocumentEdit` entry to `SessionDocument.editHistory` —
     `{ editedAt, editedByUserId, storagePath, changes: [{ key, previousValue,
     newValue }] }` — the durable record of the manual edit,
   - refreshes the two-sentence AI summary (best-effort),
   - writes a `document.fields_edited` event to `core_audit_log`.
4. Document-grading confidence is **not** re-run — the human edit is
   authoritative. Advancement logic is untouched; the session advances on
   confidence/approval exactly as today, simply over corrected values.

Field extraction at edit time reuses `GenerateDocument.resolveFields` semantics:
config `documentTemplateFields` if present, else `IDocumentGenerator.extractFields`
on the template.

### Versioning in metadata — `editHistory` + retained objects, no version table

Storage keys gain a revision suffix:
`generated/{sessionId}/{basename}-r{n}.docx`. The previous object is **not**
deleted; `SessionDocument.storagePath` always points at the current revision.
Each manual edit appends a `DocumentEdit` entry to
`SessionDocument.editHistory` (JSONB), capturing who edited, when, the render
produced, and per-field before/after values. Together these give a complete,
recoverable history without an `app_session_document_versions` table, which is
deferred until someone needs to *browse* history rather than merely retain it.

### Governance gates

`UpdateDocumentFields` rejects (server-side) when:

- the session is not `active`;
- any approval snapshot has been recorded for the session
  (`app_session_approvals` row with a `recordSnapshot`) — after approval, the
  snapshot is the governed record;
- the node's `ConversationalNodeConfig.allowManualEdit` is `false`
  (new optional flag, default `true`).

### Interaction with Regenerate

The existing regenerate path (POST `/api/documents/{messageId}`) re-extracts
values from the conversation and **overrides manual edits by design** — it is
a rewrite. The UI warns before regenerating an edited document. Regenerate
clears the *current* `editedAt` / `editedByUserId` stamps but **never touches
`editHistory`**: the record of what was manually changed, by whom, survives
the override and remains auditable.

## Alternatives considered

- **Download → edit in Word → upload-replace.** Handles free-form changes, but
  the uploaded DOCX is opaque: step outputs feeding later steps go stale unless
  the file is AI-parsed back into fields (brittle), the audit trail degrades to
  "a new file appeared", and template integrity is lost. Deferred, not
  rejected — it could later coexist as an explicit "user-supplied version" with
  re-extraction.
- **In-browser DOCX editor (OnlyOffice / Collabora).** Heavy infrastructure
  and licensing for a problem the template/field model doesn't have; same
  staleness problem as upload-replace.
- **Full version-history table in v1.** More schema and UI for a need
  (browsing revisions) no persona currently has; retained storage objects keep
  the door open.

## Consequences

**Positive**

- Document and step outputs cannot diverge — the document is always a render of
  the outputs, so downstream steps and approval snapshots are correct by
  construction.
- Edits are discrete, attributable field changes — a natural audit surface that
  fits confidence-tracking and staged governance.
- No new heavyweight dependency; the build is a use-case, a router, a dialog,
  and a domain validator, reusing the generation pipeline.
- Template formatting and branding stay intact because only docxtemplater
  renders documents.

**Negative**

- Operators can only change content *inside* template fields; wording outside
  placeholders requires a template change or the deferred upload-replace path.
  Narrative fields (free prose) cover most in-field rewording.
- Re-rendering uses the template as it exists *now*; if the template was
  re-uploaded since generation, layout may shift (already true of Regenerate).
- Last-write-wins on concurrent edits in collaborative sessions; versioned
  storage keys preserve both renders but only one is current.
