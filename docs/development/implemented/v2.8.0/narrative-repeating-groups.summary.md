# Implementation Summary — Repeating / Structured Groups (v2.8.0)

- **Version bump**: **MINOR** — 2.7.0 → 2.8.0. New `TemplateFieldType`, a widened
  extraction schema and render boundary, and an additive `StepOutputField.items`.
  No breaking domain change; no data migration.
- **Governed by**: [`adr/032-repeating-structured-groups.adr.md`](../../adr/032-repeating-structured-groups.adr.md)
- **Builds on**: v1.19.0 (narrative fields + optional sections)

## What was built

A template can now carry a **repeating group** — a block that renders once per
item in a list of structured records (a recommendations table, an options
appraisal, a set of suppliers/findings). The author marks the block explicitly:

```
{{#Recommendations (repeat)}}
  {{ Owner }}: {{ Action }} — due {{ Deadline (date) }}
{{/Recommendations}}
```

The AI extracts a capped list of records (from the conversation **and uploaded
context documents**, which already flow into extraction as `contextDocs`), the
document renders one block per item with template-controlled layout, and the
group's **item count** — never its prose — becomes a reportable signal.

### Key decisions realised (ADR-032)

1. **Explicit `(repeat)` marker** (revised from the originally-scoped *implicit*
   rule during `/build`). Implicit classification collided with the shipped
   v1.19.0 narrative-in-section pattern (`{{#Risk Section}}{{Risk Narrative
   (narrative)}}{{/Risk Section}}` must stay a boolean gate). `(repeat)` on the
   open tag declares a group; without it a `{{#…}}` block is unchanged. Zero
   regression — the collision is eliminated, not merely mitigated.
2. **Single level only.** A group nested in a section, a section/group nested in
   a group, or an empty group is a validation error raised by the upload dry-run
   (`parseTemplateFields`).
3. **Item cap** default **20**, overridable via `{{#Name (repeat) (max: N)}}`.
4. **Best-effort coercion** — non-arrays → `[]`; items past the cap dropped;
   non-object and all-blank items dropped; each sub-field coerced (blanked when
   missing/invalid). Coercion never fails the turn.
5. **Soft completeness note** — an empty list or an item missing a required
   sub-field surfaces via the readiness gate's `missingInformation` channel
   (the intake-completeness signal the procurement review asked for).
6. **Additive persistence** — `StepOutputField.items?` alongside an untouched
   `value: string`; group data lives in session context and can flow to later
   steps. No data migration. Reporting is **count-only**.

## Files created / modified

**Domain (`packages/domain`)**
- `entities/template-field.ts` — `"group"` type; `itemFields?`, `itemCap?`,
  `DEFAULT_ITEM_CAP`; `(repeat)`/`(max: N)` open-tag parsing; group-aware
  `parseTemplateFields` with nesting/empty-group errors; group format description. (+ tests)
- `entities/group-fields.ts` **(new)** — `computeGroupCompletenessNotes` (pure). (+ tests)
- `entities/session-step-output.ts` — additive `items?`.
- `entities/analytics.ts` — `computeFieldReport` emits a per-session count column
  for a group; never per-item columns. (+ tests)
- `ports/document-generator.ts` — `GenerateDocxInput.data` admits the array arm.

**Shared (`packages/shared`)**
- `schemas/document.ts` — `documentDataSchema` widened to
  `z.record(z.union([z.string(), z.array(z.record(z.string()))]))`; `GroupItem(s)`
  and `DocumentData` exported.

**Application (`packages/application`)**
- `use-cases/document/structured-fields.ts` — extraction returns `DocumentData`;
  group prompt guidance + per-item constraints; `scalarValues`, `coerceGroupItems`. (+ tests)
- `use-cases/document/render-data.ts` — binds a group to its item array. (+ tests)
- `use-cases/document/generate-document.ts` — threads `DocumentData`, persists
  `items`, grades on scalar values only.
- `use-cases/document/update-document-fields.ts` — **preserves a group's items on
  a manual scalar-field edit** (a group is not manually editable in v1; without
  this the re-render would blank it). (+ test)
- `use-cases/session/evaluate-step-readiness.ts` — extracts groups, surfaces
  completeness notes via `missingInformation`, threads the array to generation. (+ test)
- `services/resolve-field-values.ts` — scalar-only resolver guards against arrays.

**Adapters (`packages/adapters`)**
- `documents/docx-generator.ts` — no code change needed (the `(repeat)`/`(max:N)`
  annotations are stripped by the existing `normalizeTagName`, so the rendered
  tag is a plain `{{#name}}` docxtemplater loop). (+ render/extract tests proving
  a group renders one block per array item and inner tags don't leak top-level.)

**Web (`apps/web`)**
- `components/canvas/template-tags-help-dialog.tsx` — documents the `(repeat)`
  marker, `(max: N)`, and the no-nesting rule.
- `app/api/chat/[sessionId]/stream/turn-helpers.ts` — `precomputedDocument`
  field-values typing widened to `DocumentData`.

## Migrations run

**None.** `StepOutputField` is stored as `jsonb`; `items?` is additive. Existing
rows, readers, and reports are unchanged.

## e2e tests added

`tests/e2e/phase-narrative-repeating-groups.spec.ts`:
- **Happy path** — the tags help dialog documents the `(repeat)` group marker.
- **Error path** — a group nested inside a section is rejected on upload and the
  validation message is shown to the author.

(The Playwright suite runs against the full stack in CI; it was not executed in
the build sandbox, which has no app server / Postgres / Redis / MinIO. All unit
and integration suites — domain, application, adapters, web — pass, and the docx
integration test proves a group renders end-to-end.)

## Known limitations (deferred — ADR-032 *Deferred*)

- **No nested groups/sections** — single level only in v1.
- **Count-only reporting** — no per-item columns or side-by-side item comparison;
  a group is not offered as a numeric filter in the field report (display-only).
- ~~**Groups are not manually editable** — items are preserved on edit but the
  manual field editor does not surface group items (as with section gates).~~
  **Resolved in the same 2.8.0 release** — the "Show data" modal renders a group
  as a table and the edit dialog offers a full add/remove/edit item editor. See
  [`./enhance-repeating-group-editing.summary.md`](./enhance-repeating-group-editing.summary.md).
- **External classification (n8n auto-node) and a conversational
  `structured_extraction` output** remain deferred; both consume this same
  `Array<Record<string,string>>` primitive as a small additive follow-on.
