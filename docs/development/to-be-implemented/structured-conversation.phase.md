# Phase — Structured Conversation (Fields Without a Document)

- **Status**: Awaiting review
- **Target version**: 2.9.0  (bump: MINOR — new feature, additive `app_flow_nodes.config` jsonb; no migration)
- **PRD**: `docs/development/prd/structured-conversation.prd.md`
- **ADRs**: ADR-038 (three-value output type, neutral field-set accessor, gate-without-generation, record card, `section` hidden)
- **Depends on**: extraction/grade engine (`packages/application/src/use-cases/document/structured-fields.ts`, `grade-document.ts`), pre-generation gate, manual editing (ADR-024, `update-document-fields.ts`), `output-type.ts`, `template-field-editor.tsx`, session graph (`packages/adapters/src/agents/flow-session-graph.ts`)

## 1. Problem

Structured field capture, the confidence gate, manual editing, and Insights are
all locked behind uploading a `.docx`, even though they run on a format-neutral
`TemplateField[]` / `SessionStepOutput`. Authors who only want to *record*
information have to fabricate a throwaway document. Add a third output type that
captures author-declared fields with no document. See the PRD.

## 2. Goals

- Three output types: **Template** (unchanged), **Structured conversation** (new),
  **Unstructured conversation** (relabelled `conversation_only`).
- Inline field editor for structured: name + type per row, ⋮ overflow for required
  + constraints (maxlen, min/max, options/multi-options) — the `{{ tag }}`
  vocabulary, minus `section`.
- Structured runs the same extraction + pre-generation gate, stores
  `SessionStepOutput.fields`, generates **no** document.
- DoneWhen "all fields captured" is shared wording and the structured default.
- Completion shows a record card (reused manual-edit field view), editable.

## 3. Non-goals

Document output for structured; new field types; `section` in the editor;
migration; batch capture; a net-new live record card (PRD §11).

## 4. Approach

Build bottom-up, test file before implementation (CLAUDE.md). Extend the
`outputType` union in domain and map legacy `conversation_only → unstructured` at
the edge. Introduce a `nodeFieldSet(config)` accessor so `structured-fields.ts`
and the gate read one field set for both Template and Structured. Fork the graph
before generation for `structured`. Reuse `template-field-editor.tsx` and the
manual-edit view. No schema change — everything rides `app_flow_nodes.config`.

## 5. Key entities / files

| Layer | File | Change |
|-------|------|--------|
| domain | `packages/domain/src/entities/flow-node.ts` | extend `ConversationalNodeConfig.outputType` → add `structured` / `unstructured`; add `structuredFields?: TemplateField[]`; add `nodeFieldSet(config)` helper (or in a small module) |
| domain | `packages/domain/src/index.ts` | export helper/types as needed |
| application | `packages/application/src/use-cases/document/structured-fields.ts` | read fields via `nodeFieldSet`; unchanged extraction/grade otherwise |
| application | `packages/application/src/use-cases/document/generate-document.ts` | guard: only `generate_document` reaches generation |
| adapters | `packages/adapters/src/agents/flow-session-graph.ts` | `structured` path: extract → grade → gate → persist output; skip generation |
| web | `apps/web/src/components/canvas/output-type.ts` | three-value `OutputType`; `doneWhenForOutputType` allows the sentinel for `structured`; drop the sentinel for `unstructured` |
| web | `apps/web/src/components/canvas/node-config-modal-conversational.tsx` | three-way selector; render field editor for `structured` |
| web | `apps/web/src/components/canvas/template-field-editor.tsx` | reuse for authored fields; hide `section` type when structured |
| web | `apps/web/src/components/canvas/node-defaults.ts` | defaults for `structured` / `unstructured` |
| web | `apps/web/src/components/chat/message-feed.tsx`, `document-poll-state.ts` | render record card (not document card) for a completed `structured` step |
| web | `apps/web/src/server/routers/flow.ts` | validate/persist `structuredFields`; accept the new `outputType` values |

## 6. Implementation steps (test-first per CLAUDE.md)

1. **Domain — union + accessor.** Extend `outputType`; add `structuredFields`; add
   `nodeFieldSet(config)` returning the template or structured field set. Map
   legacy `conversation_only`. Tests: accessor picks the right set; legacy value
   maps to `unstructured`. Domain stays dependency-free.
2. **Application — shared field read.** Point `structured-fields.ts` at
   `nodeFieldSet`; assert Template behaviour is byte-identical. Guard
   `generate-document.ts` to `generate_document` only.
3. **Adapters — graph fork.** In `flow-session-graph.ts`, route `structured`
   through extract → grade → gate, then persist `SessionStepOutput` and stop.
   Tests: structured reaches the gate, holds/asks below threshold, passes above,
   and never calls generation; `unstructured` never extracts.
4. **Web — output type + doneWhen.** Extend `output-type.ts` and its tests: three
   values; sentinel valid for `structured` and default; reverting to
   `unstructured` drops the sentinel.
5. **Web — editor.** Three-way selector in the conversational modal; reuse
   `template-field-editor.tsx` with `section` filtered out for structured; ⋮
   overflow exposes required + constraints. Tests cover add/edit/remove field and
   the hidden `section`.
6. **Web — record card.** Render the manual-edit field view as a completion card
   for `structured`; wire the existing edit path (no document re-render).
7. **Web — router.** Validate `structuredFields` (reuse field validation) and the
   new `outputType` values; reject `section` in a structured set server-side.
8. **Version + validate.** Bump `VERSION` and `package.json#version` to `2.9.0`.
   Run `./validate.sh`; fix all failures. Move this phase doc to
   `docs/development/implemented/alpha-2/v2.9.0/` with a summary.

## 7. Acceptance criteria

Mirror PRD §10:

- [ ] Editor shows Template / Structured conversation / Unstructured conversation.
- [ ] Structured reveals the inline field editor (name + type + ⋮ constraints).
- [ ] ⋮ menu exposes the `{{ tag }}` constraint vocabulary minus `section`.
- [ ] `section` is not selectable when structured (client and server).
- [ ] Structured runs extraction + the pre-generation gate, stores fields,
      generates no document.
- [ ] DoneWhen defaults to "all fields captured" for structured with shared
      wording.
- [ ] Completion shows an editable record card; edits use the manual-edit path.
- [ ] Structured fields appear in Insights like a document step's.
- [ ] `unstructured` is byte-identical to the old `conversation_only`.
- [ ] Architecture intact (domain dependency-free; Result at boundaries); no
      migration.
- [ ] `VERSION` = `package.json#version` = `2.9.0`; `./validate.sh` passes.

## 8. Risks / open questions

- `structuredFields` vs overloading `documentTemplateFields` — ADR-038 chooses a
  distinct slot; confirm no reader bypasses `nodeFieldSet`.
- Relabelling `conversation_only` must not move any stored data.
- Record card = reuse of the manual-edit view, not a new component — confirm at
  step 6.
- `group` (repeating items) in a structured set is in scope; confirm the editor
  supports adding item sub-fields there.
