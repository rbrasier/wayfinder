# Phase — Narrative Fields + Optional Sections (Narrative templates, Phases 1 & 2)

- **Status**: Implemented in v1.19.0
- **Version bump**: **MINOR** — two new `TemplateFieldType`s and a widened render
  binding; no breaking domain change.
- **Origin**: design discussion on supporting narrative-driven documents
  (committee papers, business cases) alongside the existing data-driven tags.
- **Phase 3 (repeating groups)**: deliberately *not* built — see the
  repeating-groups spec under `docs/development/to-be-implemented/`.

## 1. Goal

Let a document template carry **narrative, open-ended content** — prose the AI
composes, and sections that may or may not appear — without disturbing the
existing typed-tag/reporting model.

Two capabilities:

1. **Narrative field** — `{{ Background (narrative: "…") }}`. Still a single
   string, but the AI *composes* prose against a brief rather than *extracting* a
   value. Excluded from the field report.
2. **Optional section** — `{{#Risk Section}} … {{/Risk Section}}`. A Yes/No gate
   the AI decides; if "No", the whole block is omitted. The decision is a
   reportable boolean.

## 2. Design

The two new behaviours map onto the existing `TemplateField` shape rather than a
parallel system:

- `TemplateFieldType` gains `"narrative"` and `"section"`.
- `TemplateField` gains an optional `instruction` (the narrative brief).
- A narrative value stays a `string`, so no boundary type change is needed for it.
- A section gate is the only widening: docxtemplater treats every non-empty
  string as truthy, so the gate's "Yes"/"No" must become a real boolean at the
  render boundary. `GenerateDocxInput.data` widened from `Record<string, string>`
  to `Record<string, string | boolean>`. The persisted step-output value stays
  the "Yes"/"No" string, so reporting is unaffected.

Principle: **separate reportable signals from rendered content.** Narrative prose
is rendered only; section gates emit a reportable Yes/No; nothing prose-shaped
ever becomes a report column.

## 3. What was built

- **Parsing** (`packages/domain/src/entities/template-field.ts`):
  - `(narrative)` and `(narrative: "brief")` annotations; the brief is
    quote-stripped and cannot contain brackets (annotation grammar limitation).
  - `{{#name}}` / `{{^name}}` / `{{/name}}` section sigils parse into a single
    `section` gate; the close tag dedupes against the open by key.
  - Guard rails: narrative cannot combine with a scalar type or with options.
  - `describeTemplateFieldFormat` emits compose/decide guidance for the AI and
    omits numeric/optionality noise for section gates.
- **Reporting** (`packages/domain/src/entities/analytics.ts`):
  `computeFieldReport` skips `narrative` fields entirely (no column, no value);
  `section` gates flow through as ordinary Yes/No columns.
- **Rendering** (`packages/adapters/src/documents/docx-generator.ts` +
  `ports/document-generator.ts`): `normalizeTagName` preserves the section sigil
  through tag normalisation so blocks still render; `data` accepts booleans.
- **Generation** (`packages/application/src/use-cases/document/`):
  `structured-fields.ts` adds compose/decide prompt guidance and coerces a
  section value via the Yes/No path; `generate-document.ts` converts section
  "Yes"/"No" → boolean only at the render boundary, while step outputs keep the
  string.
- **Web** (`apps/web`): the template-tags help dialog documents narrative and
  optional-section syntax; the field-report filter treats `section` like `yesno`.

## 4. Files modified

- `packages/domain/src/entities/template-field.ts` (+ test)
- `packages/domain/src/entities/analytics.ts` (+ test)
- `packages/domain/src/ports/document-generator.ts`
- `packages/adapters/src/documents/docx-generator.ts` (+ test)
- `packages/application/src/use-cases/document/structured-fields.ts` (+ test)
- `packages/application/src/use-cases/document/generate-document.ts` (+ test)
- `apps/web/src/components/canvas/template-tags-help-dialog.tsx`
- `apps/web/src/components/admin/field-report-section.tsx`

## 5. Migrations run

None. No schema change — `StepOutputField` is unchanged (section gates persist as
the existing `value: string`).

## 6. Known limitations

- **No repeating/structured groups** — a section is a boolean gate only; an
  iterated list of records is Phase 3 (deferred).
- **Narrative briefs cannot contain brackets** — the `( … )` annotation grammar
  has no nesting; a brief with parentheses would be misparsed.
- **All `{{#…}}` tags are boolean gates** — a docxtemplater loop over an array
  would render once (truthy) rather than iterate; arrays arrive in Phase 3.
- **Narrative quality is graded, not extracted** — the existing document-grading
  hook applies, but there is no narrative-specific evaluation (length, structure)
  beyond the field brief.
- **Section gates are not surfaced in the manual field-line editor** — they only
  arise from `.docx` section tags, not from `Label (type)` lines.
