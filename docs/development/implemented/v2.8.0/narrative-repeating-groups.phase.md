# Phase — Repeating / Structured Groups (Narrative templates, Phase 3)

- **Status**: Implemented in v2.8.0 (see `narrative-repeating-groups.summary.md`)
- **Target version**: v2.8.0 (bump: **MINOR** — new field shape, boundary type
  change, additive step-output field)
- **Depends on**: v1.19.0 (narrative field type + optional sections)
- **ADR**: [`adr/032-repeating-structured-groups.adr.md`](../adr/032-repeating-structured-groups.adr.md)
  — settles the tag-classification rule, extraction schema, item cap, and the
  step-output/reporting decisions this doc left open.
- **Scope**: repeating groups in document templates **only**. External-classifier
  output (n8n auto-node) and a conversational `structured_extraction` output type
  are **deferred** — see ADR-032 *Deferred*.
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

1. **Tag model** — reuse the `{{#name}} … {{/name}}` section syntax; a block
   becomes a *repeating group* when its open tag carries an explicit `(repeat)`
   annotation (`{{#Recommendations (repeat)}} … {{/Recommendations}}`). A
   `section` without `(repeat)` stays a Phase-2 boolean gate with its inner tags
   as top-level fields (v1.19.0 unchanged); a `(repeat)` block becomes a `group`
   whose `itemFields: TemplateField[]` are parsed from the body. New
   `TemplateFieldType` `"group"` plus `itemFields`/`itemCap` on `TemplateField`.
   (The explicit marker replaces the originally-scoped implicit rule, which was
   found during `/build` to regress shipped narrative-in-section — see ADR-032
   §2.)
2. **Parsing** — `docx-generator` already preserves section sigils (v1.19.0). It
   must additionally associate the inner tags between `{{#name}}` and `{{/name}}`
   with the group rather than emitting them as top-level fields. This is the main
   new parsing work — current `collectRawTags` is paragraph-flat.
3. **AI extraction** — `extractStructuredFields` returns a flat
   `Record<string, string>` today. Groups use the widened
   `z.record(z.union([z.string(), z.array(z.record(z.string()))]))` schema
   (ADR-032 §3). The model emits an array capped at `itemCap` (**default 20**,
   overridable per group via `{{#name (max: N)}}`), with each sub-field key
   required per item. Coercion is best-effort (drop invalid items, blank missing
   sub-fields, never fail the turn) plus a **soft completeness note** on an empty
   array or an item missing a required sub-field.
4. **Render binding** — widen `GenerateDocxInput.data` to allow
   `Array<Record<string, string>>` values (already `string | boolean`; add the
   array arm). docxtemplater's `paragraphLoop` already iterates arrays.
5. **Step output + reporting** — **decided (ADR-032 §4)**: persist groups
   **additively** on `StepOutputField` (`items?: Array<Record<string,string>>`
   alongside the untouched `value: string`), and surface only a per-session
   **count** column in `computeFieldReport`. Additive shape → no data migration;
   group data lives in session context and can flow to later steps. Prose/items
   never become spreadsheet columns.

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

## 5. Risks / open questions (resolved in ADR-032)

- **Schema migration** — *resolved*: additive `items?` on `StepOutputField`;
  `value: string` untouched, so no data migration and existing reports keep
  working (ADR-032 §4).
- **Prompt reliability** — *mitigated*: hard item cap (default 20), required
  per-item sub-field keys, best-effort drop-invalid coercion, and a soft
  completeness note on empty/thin arrays (ADR-032 §3, §5). Single-level-only
  (no nesting) is the main reliability lever.
- **Nested sections** — *resolved*: **not supported in v1**; a group inside a
  section (or vice versa) is a validation error raised by the upload dry-run
  (ADR-032 §2). Deferred to a later phase.
- **Reporting semantics** — *resolved*: **count-only** per-session column; no
  per-item columns, no per-sub-field aggregates, no cross-item comparison in v1
  (ADR-032 §4).
- **Explicit `(repeat)` marker** — *resolved*: groups are declared explicitly, so
  adding an inner tag to a boolean gate no longer reclassifies it. Cost is
  discoverability (authors must add `(repeat)`); the shipped narrative-in-section
  pattern is preserved (ADR-032 §2).

## 6. Acceptance criteria (draft)

- [ ] A `{{#group (repeat)}} … {{/group}}` block parses into a `group` field
      with `itemFields`, and a plain `{{#section}}` (with or without inner tags)
      still parses as a boolean gate with top-level inner fields.
- [ ] The AI emits an array capped at `itemCap` (default 20, overridable via
      `{{#name (repeat) (max: N)}}`); the document renders one block per item with
      template-controlled layout.
- [ ] An empty array or an item missing a required sub-field surfaces a soft
      completeness note; coercion never fails the turn.
- [ ] A group nested in a section (or a section/group nested in a group) is
      rejected by the upload dry-run with a clear message.
- [ ] Reporting shows at most a per-session count for a group — never per-item
      columns and never prose.
- [ ] `StepOutputField` change is additive (`items?` added; `value` untouched);
      existing reports keep working with no data migration.
- [ ] `./validate.sh` passes; `VERSION` and `package.json#version` match at v2.8.0.
- [ ] ADR-032 records the tag-classification rule, the extraction schema, the
      item cap, and the reporting/step-output decision. ✔ (written)
