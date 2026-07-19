# ADR-038 — Step Output Types: Template / Structured / Unstructured

- **Status**: Proposed (scoped by `structured-conversation.prd.md`)
- **Date**: 2026-07-19

## Context

A conversational node today has a binary `outputType`:
`"conversation_only" | "generate_document"`
(`packages/domain/src/entities/flow-node.ts`). Only `generate_document` unlocks
structured field capture — because the field set (`TemplateField[]`) is derived by
parsing an uploaded `.docx`. Yet the machinery downstream of that parse is already
document-agnostic:

- extraction + grading runs over a `TemplateField[]`
  (`packages/application/src/use-cases/document/structured-fields.ts`),
- results are stored in `SessionStepOutput.fields` — a format-neutral record,
- manual editing (ADR-024) re-reads and re-writes that record, and
- Insights read the record without touching the `.docx`.

So the document is one *consumer* of the record, not its source of truth. A step
that only needs to *record* typed information must nonetheless fabricate a Word
document to reach any of this. `structured-conversation.prd.md` adds a third
output type that captures fields directly, with no document.

Constraints:

1. **Additive, no migration.** `outputType` and any field set must ride the
   existing `app_flow_nodes.config` jsonb.
2. **Reuse, don't fork.** A structured step must run the *same* extraction and
   pre-generation confidence gate as a template step — no parallel capture path.
3. **`conversation_only` unchanged.** Relabelling it must be a pure UI change.
4. **Hexagonal boundary (ADR-001).** The output-type decision is domain data; the
   graph/use-cases branch on it without framework code crossing inward.

## Decision

### 1. A three-value output type

Extend the union to `"generate_document" | "structured" | "unstructured"`, with
`"unstructured"` as the new name for `conversation_only`. The domain keeps the
existing string for back-compat where a stored value is read, mapping
`conversation_only → unstructured` at the edge; the editor presents the three
labels **Template**, **Structured conversation**, **Unstructured conversation**.

### 2. A neutral field-set accessor

The field set feeding extraction is read through a single accessor on the node
config rather than from a document-named slot:

- `documentTemplateFields` — the parsed template fields (Template type), unchanged.
- `structuredFields?: TemplateField[]` — author-declared fields (Structured type).

A helper `nodeFieldSet(config)` returns whichever applies. `structured-fields.ts`
and the pre-generation gate consume the accessor, so they are identical for both
types. We deliberately do **not** overload `documentTemplateFields` to hold
structured data — a document-named slot carrying non-document fields is a trap for
the next reader.

### 3. Structured runs the gate, skips generation

In `flow-session-graph.ts`, `structured` follows the same node path as
`generate_document` up to and including the pre-generation evaluation gate
(extract → grade → hold-and-ask-or-pass), then **stops**: it persists
`SessionStepOutput.fields` and does not call document generation or storage. The
completion signal reuses the `TEMPLATE_COMPLETE_SENTINEL` "all fields captured"
condition (`output-type.ts`), which becomes valid for `structured` and is its
default DoneWhen.

### 4. The record card reuses the manual-edit view

On completion the chat renders a **record card** listing captured field values,
built from the existing manual-edit field view (ADR-024) rather than a new
component, with the same edit affordance. `message-feed.tsx` /
`document-poll-state.ts` select the record card for `structured` and the document
card for `generate_document`.

### 5. `section` hidden from the structured editor

The `section` field type means "include or omit this part of the *document*". With
no document it has no meaning, so the structured field editor
(`template-field-editor.tsx`) filters it out of the type selector. Parsing and
validation of `section` are untouched for the template path.

## Alternatives considered

- **Overload `documentTemplateFields` for structured fields.** Zero new config
  key, but a document-named field silently holding non-document data misleads
  every future reader and blurs the template/structured distinction. Rejected in
  favour of a distinct `structuredFields`.
- **A separate node *type* (not an output type).** A new `FlowNodeType` would
  duplicate the whole conversational node (instructions, doneWhen, confidence,
  confirmation) just to drop the document. An output-type value reuses all of it.
  Rejected.
- **Generate a hidden throwaway document to reuse the existing path verbatim.**
  Produces junk files, storage cost, and a phantom document card. Rejected — the
  path already forks cleanly before generation.
- **Keep `conversation_only` as the label.** "Unstructured conversation" pairs
  naturally with "Structured conversation" and makes the three-way choice legible;
  the stored value is mapped for back-compat regardless.

## Consequences

**Positive**

- Field capture, the confidence gate, manual editing, and Insights all work with
  no document, via one shared path — the record was always the anchor.
- Additive and migration-free; existing flows read unchanged (`conversation_only`
  maps to `unstructured`).
- Sets up later work (live record card, reusable schema library, emit-to-system)
  on a clean output-type seam.

**Negative**

- A third branch in the graph and the editor to keep in step; tests must assert
  `unstructured` is byte-identical to the old `conversation_only` behaviour.
- Two field-set slots on the config; the `nodeFieldSet` accessor must be the only
  reader so the two never diverge.
- The record card shares chat-footer real estate with document/approval cards;
  their mutual exclusivity per node keeps them from colliding but must be checked.
