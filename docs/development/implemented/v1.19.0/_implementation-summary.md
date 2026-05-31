# Implementation Summary — v1.19.0

**Phase**: Narrative Fields + Optional Sections (Narrative templates, Phases 1 & 2)
**Phase doc**: `narrative-and-optional-sections.phase.md` (this folder)
**Deferred**: the repeating-groups (Phase 3) spec under `docs/development/to-be-implemented/`
**Version bump**: **MINOR** — `1.18.0` → `1.19.0` (two new field types + widened
render binding; no breaking domain change, no schema migration).

## What was built

Document templates can now carry narrative, open-ended content alongside the
existing data-driven tags:

- **Narrative fields** — `{{ Background (narrative: "Summarise the rationale") }}`.
  The AI composes prose against a brief instead of extracting a value. The value
  is still a single string; it is rendered into the document but **excluded from
  reporting**.
- **Optional sections** — `{{#Risk Section}} … {{/Risk Section}}`. A Yes/No gate
  the AI decides from the conversation; if "No", the whole block is omitted. The
  gate is a **reportable** boolean.

Both behaviours extend the existing `TemplateField` rather than adding a parallel
system. The only boundary change is widening the docx render data to
`Record<string, string | boolean>` so a gate can be a real boolean (docxtemplater
treats every non-empty string as truthy). Step outputs keep the "Yes"/"No"
string, so the field report is unaffected.

## Files created

- `docs/development/implemented/v1.19.0/narrative-and-optional-sections.phase.md`
- `docs/development/implemented/v1.19.0/_implementation-summary.md` (this file)
- the repeating-groups (Phase 3) spec under `docs/development/to-be-implemented/`

## Files modified

- **domain**: `entities/template-field.ts` (+ test) — `"narrative"` / `"section"`
  types, `instruction` field, `(narrative)` annotation parsing, section-sigil
  parsing, AI-facing descriptions; `entities/analytics.ts` (+ test) —
  `computeFieldReport` excludes narrative columns/values; `ports/document-generator.ts`
  — `GenerateDocxInput.data` widened to `string | boolean`.
- **adapters**: `documents/docx-generator.ts` (+ test) — `normalizeTagName`
  preserves section sigils so blocks render.
- **application**: `document/structured-fields.ts` (+ test) — compose/decide prompt
  guidance, section → Yes/No coercion; `document/generate-document.ts` (+ test) —
  section "Yes"/"No" → boolean only at the render boundary.
- **web**: `components/canvas/template-tags-help-dialog.tsx` — documents narrative
  and optional-section syntax; `components/admin/field-report-section.tsx` —
  section gates filter like `yesno`.
- `VERSION`, root `package.json` — `1.18.0` → `1.19.0`.

## Migrations run

None. `StepOutputField` is unchanged — section gates persist as the existing
`value: string`.

## Known limitations

- **No repeating/structured groups** — a section is a boolean gate only; an
  iterated list of structured records is Phase 3, documented under
  `to-be-implemented/` and deliberately not built.
- **Narrative briefs cannot contain brackets** — the `( … )` annotation grammar
  has no nesting.
- **All `{{#…}}` tags are boolean gates** — a loop over an array renders once
  (truthy) rather than iterating; arrays arrive in Phase 3.
- **Section gates are not offered in the manual field-line editor** — they arise
  only from `.docx` section tags.
