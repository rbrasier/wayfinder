# Phase — Repeating / Structured Groups (Narrative templates, Phase 3)

- **Status**: Sketched (awaiting `/doc-review`)
- **Target version**: TBD (bump: **MINOR** — new field shape, boundary type
  change, step-output schema change)
- **Depends on**: v1.19.0 (narrative field type + optional sections)
- **Deferred deliberately**: this is the one piece of narrative-template support
  that breaks the current `Record<string, string>` data binding. Do **not** build
  it speculatively — wait until a real template needs an iterated, structured list.

## 1. Goal

Support a template block that repeats over a **list of structured records** — a
recommendations table, an action list with owners and due dates, an options
appraisal where each option has the same internal fields. The template defines
the layout of **one** item; the engine repeats that layout per element.

```
{{#recommendations}}
  ### Recommendation {{ number }}
  {{ text }}
  Owner: {{ owner }} — Due: {{ deadline }}
{{/recommendations}}
```

renders from:

```jsonc
{ "recommendations": [
  { "number": 1, "text": "…", "owner": "Finance", "deadline": "30-06-2026" },
  { "number": 2, "text": "…", "owner": "Ops",     "deadline": "15-07-2026" }
]}
```

## 2. Why this is a separate phase (the actual difference from Phase 1)

A **narrative** field (Phase 1) is a single `string` that may contain N
paragraphs — the count and structure are opaque prose the system never inspects.
A **repeating group** is an `Array<Record<…>>`: the item count is data
(`array.length`), each item has its own sub-fields, the *template* (not the AI)
controls per-item layout, and the group is addressable and countable.

That distinction forces changes Phase 1 and 2 specifically avoided:

| Concern | Phases 1–2 (shipped) | Phase 3 (this doc) |
|---------|----------------------|--------------------|
| Render value type | `string \| boolean` | adds `Array<Record<string, string>>` |
| `StepOutputField.value` | `string` | needs an array/JSON shape |
| AI return schema | `z.record(z.string())` | nested arrays of objects |
| Reporting | column per field | only a derived **count** is reportable |

## 3. Approach (sketch — to be hardened in `/doc-review` + an ADR)

1. **Tag model** — reuse the `{{#name}} … {{/name}}` section syntax but classify
   a group as *repeating* when its body contains its own `{{sub-field}}` tags. A
   `section` with no inner tags stays a Phase-2 boolean gate; a `section` whose
   body has inner tags becomes a `group` whose `itemFields: TemplateField[]` are
   parsed from the body. Likely a new `TemplateFieldType` `"group"` plus an
   `itemFields` property on `TemplateField`.
2. **Parsing** — `docx-generator` already preserves section sigils (v1.19.0). It
   must additionally associate the inner tags between `{{#name}}` and `{{/name}}`
   with the group rather than emitting them as top-level fields. This is the main
   new parsing work — current `collectRawTags` is paragraph-flat.
3. **AI extraction** — `extractStructuredFields` returns a flat
   `Record<string, string>` today. Groups need a nested object schema
   (`z.record(z.union([z.string(), z.array(z.record(z.string()))]))` or a
   purpose-built schema). The model must emit an array; cap item count.
4. **Render binding** — widen `GenerateDocxInput.data` to allow
   `Array<Record<string, string>>` values (already `string | boolean`; add the
   array arm). docxtemplater's `paragraphLoop` already iterates arrays.
5. **Step output + reporting** — either (a) persist groups in a separate field
   shape and surface only a per-session **count** column in `computeFieldReport`,
   or (b) keep groups entirely out of step outputs and derive counts at write
   time. Decide in the ADR. Prose/items never become spreadsheet columns.

## 4. Key entities / files

| Layer | File | Change |
|-------|------|--------|
| domain | `entities/template-field.ts` | `"group"` type + `itemFields`; parse a section body into item fields. |
| domain | `entities/session-step-output.ts` | richer `StepOutputField.value` (or a parallel group shape). |
| domain | `ports/document-generator.ts` | widen `GenerateDocxInput.data` value to include `Array<Record<string,string>>`. |
| domain | `entities/analytics.ts` | derive a count column for groups; never emit per-item columns. |
| application | `document/structured-fields.ts` | nested extraction schema + per-item constraints in the prompt. |
| application | `document/generate-document.ts` | build nested render data; persist group counts. |
| shared | `schemas/document.ts` | extend `documentDataSchema` beyond `z.record(z.string())`. |
| adapters | `documents/docx-generator.ts` | scope inner tags to their enclosing section; render arrays. |
| apps/web | `template-tags-help-dialog.tsx` | document repeating-group syntax. |
| apps/web | `admin/field-report-section.tsx` | render/filter a count column. |

## 5. Risks / open questions

- **Schema migration** for `StepOutputField` if groups are persisted inline —
  existing rows are `value: string`. Prefer an additive shape over a breaking one.
- **Prompt reliability** — models are less reliable emitting nested arrays with
  consistent sub-field keys; needs per-item constraints and a hard item cap.
- **Nested sections** — a group inside an optional section (and vice versa);
  decide whether to support nesting in v1.
- **Reporting semantics** — agree exactly what is reportable (count only?
  per-sub-field aggregates are out of scope).

## 6. Acceptance criteria (draft)

- [ ] A `{{#group}} … {{/group}}` block with inner tags parses into a `group`
      field with `itemFields`, and a plain `{{#section}}` still parses as a
      boolean gate.
- [ ] The AI emits a capped array of records; the document renders one block per
      item with template-controlled layout.
- [ ] Reporting shows at most a per-session count for a group — never per-item
      columns and never prose.
- [ ] `StepOutputField` change is additive; existing reports keep working.
- [ ] `./validate.sh` passes; `VERSION` and `package.json#version` match.
- [ ] An ADR records the tag-classification rule, the extraction schema, and the
      reporting/step-output decision.
