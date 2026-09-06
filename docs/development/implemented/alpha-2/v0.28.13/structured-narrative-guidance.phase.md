# Phase — Narrative fields with author guidance in structured steps

- **Status**: Implemented
- **Target version**: 0.28.13  (bump: **PATCH** — exposes an already-supported
  domain type in one editor and adds prompt guidance; no schema change, no migration)
- **Base branch**: `release/alpha-2`
- **Branch**: `claude/structured-fields-narrative-guidance-32n3ru`
- **ADRs**: ADR-038 (step output types — §2 `nodeFieldSet`, §5 the `section`
  exclusion this phase corrects the scope of); ADR-043 (signature stays
  document-only)
- **Depends on**: template-field parser and serialiser
  (`packages/domain/src/entities/template-field.ts`), the shared row editor
  (`apps/web/src/components/canvas/field-row-model.ts`, `field-row.tsx`),
  conversational prompt assembly
  (`packages/adapters/src/agents/flow-session-graph.ts`)

## 1. Problem

A `.docx` template author can write `{{ Scope (narrative: "…") }}` and give the
AI a brief describing what the prose should cover. An author building a
**structured** step gets no equivalent. The type dropdown in the structured
field editor offers `Text` … `Multi-select` and stops, so:

- there is no long-form option at all — a "Scope" or "Background" field is a
  single-line `Text` box; and
- there is nowhere to say what the field is *for*, so the AI asks the operator
  for "Scope" with no idea what belongs in it, and the operator has no idea
  either.

The editor's own help is a third face of the same gap. The "?" beside **Fields
to capture** opens `TemplateTagsHelpDialog`, titled *"Template tags &
validation"*, which opens: "Your `.docx` template must contain at least one
`{{ tag }}` placeholder." A structured step has no `.docx` and no tags. It then
documents `(approval)`, `{{#Section}}` and `{{#Name (repeat)}}` — all three
rejected or meaningless in a structured step — while every example is written in
tag syntax the author never types here.

The gap is only in the editor's option list. Everything downstream already
handles `narrative` in a structured step:

- `validateStructuredFieldSet` (`packages/domain/src/entities/node-output.ts`)
  rejects `section` and `signature` and **permits** `narrative`;
- `buildGenerationGuidance` (`packages/application/src/use-cases/document/structured-fields.ts`)
  already emits the "compose the prose yourself" directive for any field set
  containing one;
- the record card renders through `DocumentEditDialog`
  (`apps/web/src/components/chat/document-edit-dialog.tsx`), which already gives
  a `narrative` field a 4-row textarea; and
- `packages/domain/src/entities/analytics.ts` already keeps narrative values out
  of reporting.

The omission is a stale comment, not a decision. `field-row-model.ts` states:

```ts
// ADR-038 §5: a structured conversation has no document, so `narrative` (prose
// the AI writes into a document) has no meaning there.
export const STRUCTURED_TYPE_OPTIONS: FieldRowTypeOption[] = BASE_TYPE_OPTIONS;
```

ADR-038 §5 is titled "`section` hidden from the structured editor" and reasons
only about `section` — "include or omit this part of the *document*". It says
nothing about `narrative`. The premise is also wrong on its own terms: a
narrative value is prose the AI composes into **the record**, and the record is
the anchor in a structured step (ADR-038 Consequences), document or not.

## 2. Goals

- `Narrative` appears in the structured field editor's type dropdown.
- Its cog carries a guidance brief — what the field is for, and what should go
  into it.
- That brief steers the conversation: the AI explains to the operator what the
  field needs and gathers the missing parts, rather than asking for a bare label.
- Behaviour is identical to the `.docx` `(narrative: "…")` path, so the concept
  is learned once and the same parser round-trips both.
- The "?" beside **Fields to capture** explains the field types actually
  available in a structured step, without `.docx` framing.

## 3. Non-goals

- Guidance on non-narrative field types. `(narrative: "…")` is the only
  annotation carrying a brief today; adding one to every type is a change to the
  shared parser that also governs `.docx` uploads — too wide for a patch.
- Restructuring `TemplateTagsHelpDialog` beyond making it context-aware. Its
  template variant stays byte-identical; the structured variant reuses the same
  rows and table, filtered.
- Any change to how narrative values are excluded from reporting.
- A separate "long text, captured verbatim" type. `narrative` means "the AI
  composes the prose"; that meaning is kept, not forked.

## 4. Approach

Three seams, all narrow, built tests-first per CLAUDE.md:

1. **Editor** — split the narrative option out of the two literal option lists so
   template and structured share one definition, and add it to
   `STRUCTURED_TYPE_OPTIONS`. `signature` stays template-only (ADR-043 §2). No
   new type, no new model field: `FieldModel.instruction` and
   `TemplateField.instruction` already exist and already round-trip through
   `lineToModel` / `modelToLine` / `withType`.
2. **Prompt** — `buildFieldFormatsBlock` in `flow-session-graph.ts` currently
   tells the model only how to *reformat* values. Add a narrative clause, emitted
   only when the gathered set contains a narrative field, telling it to use each
   brief to explain to the operator what the field needs, gather that material,
   then compose the prose — and never to read the brief back verbatim.

3. **Help** — `TemplateTagsHelpDialog` gains a `variant: "template" |
   "structured"` prop, following the `N8nExtractionInfoDialog` / `infoVariant`
   precedent already in `node-config-modal.tsx`. `onOpenHelpDialog` becomes
   `(variant) => void` so the two "?" buttons say which context they came from.
   The `template` variant renders exactly what it renders today. The
   `structured` variant retitles to "Field types & validation", replaces the
   `.docx` opening paragraph, keeps **Type keywords**, **Options / enum**,
   **Constraints** and **Narrative**, and drops **Signatures**, **Optional
   sections** and **Repeating groups** — each rejected by
   `validateStructuredFieldSet` or meaningless without a document. Its examples
   drop the `{{ }}` tag syntax, since the author types a name and picks a type.

The prompt clause is deliberately placed on the shared block rather than a
structured-only branch: the extraction prompt already gives the equivalent
instruction for both paths, so a template step receiving it too is reinforcement,
not contradiction.

## 5. Key entities / files

| Layer | File | Change |
|-------|------|--------|
| adapters | `packages/adapters/src/agents/flow-session-graph.ts` | `buildFieldFormatsBlock` gains a narrative clause, conditional on the gathered set containing a `narrative` field |
| adapters | `packages/adapters/src/agents/flow-session-graph.test.ts` | tests: clause + brief present for a structured narrative step; absent without one |
| apps/web | `apps/web/src/components/canvas/field-row-model.ts` | extract `NARRATIVE_TYPE_OPTION`; `STRUCTURED_TYPE_OPTIONS` = base + narrative; replace the stale ADR-038 §5 comment |
| apps/web | `apps/web/src/components/canvas/field-row-model.test.ts` | tests: narrative offered to structured and not `signature`; `withType` carries a brief; `modelToLine` round-trips |
| apps/web | `apps/web/src/components/canvas/field-row.tsx` | cog copy: "What this field is for", helper text, placeholder that reads for both paths |
| apps/web | `apps/web/src/components/canvas/template-tags-help-dialog.ts(x)` | `variant` prop; row/section selection extracted to a pure `helpDialogContent(variant)` so it is unit-testable |
| apps/web | `apps/web/src/components/canvas/template-tags-help-dialog.test.ts` | new — the structured variant offers no signature, section or group rows; the template variant keeps all of them |
| apps/web | `apps/web/src/components/canvas/node-config-modal.tsx`, `node-config-modal-conversational.tsx` | `onOpenHelpDialog` carries the variant; `helpVariant` state alongside `helpDialogOpen` |

No `domain` or `application` change — both already support this.

## 6. Database & migration impact

None. A structured field set rides the existing `app_flow_nodes.config` jsonb
(ADR-038 §1). No table, no column, no generated migration, so no
`-- data-impact:` line.

## 7. Tests

Written before each implementation file:

- `field-row-model.test.ts` — `STRUCTURED_TYPE_OPTIONS` contains `narrative` and
  not `signature`; `TEMPLATE_TYPE_OPTIONS` still contains both; `withType`
  preserves an existing brief when switching to narrative and drops it when
  switching away; `modelToLine` emits `Scope (narrative: "…")` and `lineToModel`
  reads it back.
- `flow-session-graph.test.ts` — a `structured` step whose `structuredFields`
  include a narrative field gets the clause and the brief itself; a structured
  step with only scalar fields does not.
- `template-tags-help-dialog.test.ts` — `helpDialogContent("structured")` offers
  narrative but no `(approval)`, `{{#Section}}` or `(repeat)` row and no `.docx`
  wording; `helpDialogContent("template")` still offers every section it does
  today.

**No e2e.** None of the six groups in `docs/guides/e2e-test-policy.md` applies —
this is a `<select>` option, dialog copy, and prompt-string assembly, all owned
by the unit layer above. Coverage belongs there and is written there.

## 8. Risks

- The narrative clause is additive text inside `<field_formats>`, which template
  steps also receive. It restates what the extraction prompt already says, so it
  reinforces rather than contradicts — but it is a live prompt change to the
  `.docx` path, not only the structured one.
- `FieldConfigModal` is shared verbatim between the structured editor and the
  template annotation editor, so the relabelled cog copy changes both. Intended:
  the wording is currently document-specific in a component used by both.
- `onOpenHelpDialog` gains a required argument, so every call site must pass a
  variant. There are two, both in this change; TypeScript fails the build if one
  is missed.

## 9. Acceptance

- An author adding a structured step can select `Narrative`, set a brief, and see
  the cog accent blue.
- The step's stored line is `Scope (narrative: "…")`, parsed by the same domain
  parser as a `.docx` tag.
- The conversational system prompt for that step contains the brief and the
  directive to explain it to the operator.
- The "?" beside **Fields to capture** opens help with no `.docx`, `(approval)`,
  section or repeating-group content; the same "?" on a Template step is
  unchanged.
- `./validate.sh` passes.
