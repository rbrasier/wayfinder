# PRD — Structured Conversation (Fields Without a Document)

- **Status**: Draft
- **Date**: 2026-07-19
- **Author**: rbrasier
- **Target version**: 2.9.0  (bump: MINOR — new feature, additive `app_flow_nodes.config` jsonb; no migration. See `docs/guides/versioning.md`.)

## 1. Problem

A conversational step can only capture typed, graded fields when the author
uploads a `.docx` template. Processes whose outcome is a decision, a record, or a
checklist — not a document — cannot use Wayfinder's structured field capture,
pre-generation confidence gate, manual field editing, or Insights, even though
the engine already runs on a format-neutral `TemplateField[]` and stores results
in `SessionStepOutput` independently of any file. Today an author who only wants
to *record* information has to fabricate a throwaway Word document to unlock the
structured machinery.

## 2. Users / Personas

- **Flow owner / business analyst** — wants to model an information-capture or
  checklist step (intake, triage, attestation) without owning or maintaining a
  document template.
- **Operator** (procurement officer, HR manager) — answers the same guided,
  confidence-checked conversation and sees a clear record of what was captured,
  with no document to download.
- **Auditor / reporting consumer** — reads the captured fields back through
  Insights exactly as they would for a document step.

## 3. Goals

- A conversational node offers **three** output types in the editor:
  - **Template** — unchanged label and behaviour (upload a document, generate it).
  - **Structured conversation** — new; author declares fields directly, no document.
  - **Unstructured conversation** — the existing `conversation_only` behaviour,
    relabelled.
- In a **structured conversation**, the author adds fields inline as a list; each
  row has a **field name** and a **type** selector, plus a right-aligned vertical
  three-dot (⋮) overflow control opening a mini editor for **required** and any
  type-specific constraints — min/max characters, min/max value, and the options
  list — i.e. the **same vocabulary** available on `{{ tag }}` annotations.
- A structured conversation runs the **identical** extraction, pre-generation
  confidence gate, manual field editing, and Insights path as a template step —
  it simply does not render or store a document.
- The **`section`** field type is **not** offered in the structured editor (it is
  a document-rendering "include/omit this part of the doc" concept with no meaning
  when no document exists).
- The **"template complete"** completion condition generalises to a shared
  "all required fields captured to confidence" mode, and is the **default**
  DoneWhen for a structured conversation.
- On completion, a structured step surfaces a **record card** (the captured field
  values, reusing the existing manual-edit field view) in place of a document
  card, so the operator has a visible, editable outcome.

## 4. Non-goals

- No document or file output for a structured conversation (that is the Template
  type).
- No new field types beyond the existing `TemplateField` vocabulary.
- No `section` type in the structured editor.
- No database migration — config rides the existing `app_flow_nodes.config` jsonb.
- No batch / multi-record capture.
- No net-new elaborate "live record" UI beyond reusing the manual-edit field view
  (a richer live card is future work — see §11).

## 5. Key entities

| Entity | Lives in | New / existing | Notes |
| ------ | -------- | -------------- | ----- |
| `ConversationalNodeConfig.outputType` | `packages/domain/src/entities/flow-node.ts` | existing (extend) | add a third value (e.g. `structured`) to the union. |
| `ConversationalNodeConfig.structuredFields?` | `packages/domain/src/entities/flow-node.ts` | existing (add field) | author-declared `TemplateField[]` used when `outputType === "structured"`; keeps `documentTemplateFields` for the template case. |
| `TemplateField` | `packages/domain/src/entities/template-field.ts` | existing (reuse) | same type; editor hides `section`. |
| `OutputType` / `doneWhenForOutputType` | `apps/web/src/components/canvas/output-type.ts` | existing (extend) | three-way union; template-complete sentinel becomes valid for `structured` too. |
| `SessionStepOutput` | `packages/domain/src/entities/session-step-output.ts` | existing (unchanged) | already the format-neutral record every consumer reads. |

## 6. User stories

1. As a **flow owner**, I can pick "Structured conversation" on a conversational
   node and add fields (name + type) without uploading a document.
2. As a **flow owner**, I can open the ⋮ menu on a field to mark it required and
   set constraints (maxlen, min/max, options), the same as a `{{ tag }}`.
3. As an **operator**, I complete a structured step through the same guided,
   confidence-gated conversation, and see a record card of the captured values
   instead of a document.
4. As an **operator**, I can correct a captured value through the existing manual
   edit form, with no document re-render.
5. As a **reporting consumer**, I see a structured step's fields in Insights
   identically to a document step's fields.

## 7. Pages / surfaces affected

- `apps/web/src/components/canvas/node-config-modal-conversational.tsx` — three-way
  output-type selector; render the field editor for `structured`.
- `apps/web/src/components/canvas/output-type.ts` — extend the union and
  `doneWhenForOutputType`; allow `TEMPLATE_COMPLETE_SENTINEL` for `structured`.
- `apps/web/src/components/canvas/template-field-editor.tsx` — reuse for authored
  fields; hide the `section` type when the source is a structured conversation.
- `apps/web/src/components/canvas/node-defaults.ts` — defaults for the new type.
- `packages/adapters/src/agents/flow-session-graph.ts` — for `structured`, run
  extraction + grade (the pre-generation gate) but skip document generation.
- `apps/web/src/components/chat/message-feed.tsx`,
  `apps/web/src/components/chat/document-poll-state.ts` — render a record card,
  not a document card, on completion of a structured step.
- tRPC `flow` router (`apps/web/src/server/routers/flow.ts`) — persist/validate
  the structured field set.

## 8. Database changes

None. `outputType` and `structuredFields` live in the existing
`app_flow_nodes.config` jsonb.

| Table | Change | Prefix valid? |
| ----- | ------ | ------------- |
| `app_flow_nodes` | none (jsonb `config` gains `outputType` value + `structuredFields`) | n/a |

## 9. Architectural decisions

- **New:** ADR-038 — Step output types (`template` / `structured` /
  `unstructured`) and the neutral field-set accessor that feeds the shared
  extraction path.
- **Assumes:** ADR-024 (manual document field editing — reused for record
  editing), the pre-generation evaluation gate, ADR-032 (repeating groups).

## 10. Acceptance criteria

- [ ] Conversational node editor shows three output types with the exact labels
      Template / Structured conversation / Unstructured conversation.
- [ ] Selecting Structured conversation reveals the inline field editor (name +
      type per row, ⋮ overflow for required + constraints).
- [ ] The ⋮ menu exposes the same constraint vocabulary as `{{ tag }}`
      annotations (required, maxlen, min/max, options/multi-options), minus
      `section`.
- [ ] `section` is not selectable in the structured editor.
- [ ] A structured step runs extraction + the pre-generation confidence gate and
      stores `SessionStepOutput.fields`, generating **no** document.
- [ ] DoneWhen defaults to "all fields captured" for a structured conversation
      and reads naturally (shared wording with the template case).
- [ ] On completion the chat shows a record card of captured values, editable via
      the existing manual-edit form (no document re-render).
- [ ] A structured step's fields appear in Insights like a document step's.
- [ ] Unstructured conversation behaves exactly as the old `conversation_only`.
- [ ] `VERSION` = `package.json#version` = `2.9.0`; `./validate.sh` passes.

## 11. Out of scope / future work

- A richer always-on **live record card** that fills in during the conversation
  (this PRD reuses the manual-edit view on completion only).
- A **reusable schema library** so authored field sets can be shared across flows.
- Emitting a structured record to an external system (covered by the existing
  `auto` node; not part of this PRD).

## 12. Risks / open questions

- Config slot: `structuredFields` vs overloading `documentTemplateFields`. Leaning
  to a distinct `structuredFields` to avoid document-named config carrying
  non-document data (ADR-038 decides).
- Migrating an existing `conversation_only` node to the relabelled "Unstructured"
  must be a pure label change (no data movement).
- Confirm the record card is a straight reuse of the manual-edit field view rather
  than a new component, to keep scope tight.
