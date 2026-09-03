# Implementation Summary — Narrative fields with author guidance in structured steps

- **Version**: 0.28.13 (bump: **PATCH** — exposes an already-supported domain
  type in one editor and adds prompt guidance; no schema change, no migration)
- **Base branch**: `release/alpha-2`
- **Type**: `/enhance`
- **Phase doc**: [`structured-narrative-guidance.phase.md`](./structured-narrative-guidance.phase.md)

## What changed

An author building a **structured** step can now pick **Narrative** for a
long-form field and give it a brief — what the field is for and what should go
into it. The AI uses that brief to tell the operator what the field needs, ask
for anything missing, and write the answer up. Previously the type dropdown
stopped at `Multi-select`, so a "Scope" or "Background" field was a single-line
`Text` box with no way to say what belonged in it.

The gap was only ever in the editor's option list. `validateStructuredFieldSet`
already permitted `narrative` in a structured step, `buildGenerationGuidance`
already emitted the compose-the-prose directive for it, `DocumentEditDialog`
already rendered it as a textarea on the record card, and `analytics.ts` already
kept it out of reporting. The dropdown withheld it behind a comment citing
"ADR-038 §5" — a section titled *"`section` hidden from the structured editor"*
that reasons only about `section` and never mentions narrative.

## Changes by layer

### `packages/adapters`

- `src/agents/flow-session-graph.ts` — new `buildNarrativeDirective`, emitted
  inside `<field_formats>` only when the gathered set contains a narrative
  field. The brief already reached the prompt through
  `buildFieldConstraintsText`; what was missing was any direction to *use* it in
  conversation, so the model asked for the bare field name and composed from a
  one-line answer. The directive tells it to explain what the brief covers in
  its own words, ask for what is missing, never read the brief out verbatim, and
  compose the prose rather than paste the answer back.

### `apps/web`

- `src/components/canvas/field-row-model.ts` — `NARRATIVE_TYPE_OPTION` extracted
  so both editors share one definition; `STRUCTURED_TYPE_OPTIONS` is now base +
  narrative and `TEMPLATE_TYPE_OPTIONS` builds on it by adding `signature`, so
  the two lists cannot drift. The stale ADR-038 §5 comment is replaced with one
  stating what the ADR actually decided.
- `src/components/canvas/field-row.tsx` — the cog's guidance box is relabelled
  from "What the AI should write" to **"What this field is for"**, with a
  placeholder and helper text that read correctly for both a document template
  and a structured step.
- `src/components/canvas/template-tags-help-content.ts` — **new.** The help
  content as data, keyed by variant, so what each editor is told it can author
  is asserted in a unit test rather than read off rendered markup.
- `src/components/canvas/template-tags-help-dialog.tsx` — renders from that
  content and takes a `variant` prop. The `structured` variant retitles to
  "Field types & validation", drops the `.docx`/`{{ tag }}` framing, and
  withholds the **Signatures**, **Optional sections** and **Repeating groups**
  sections — each rejected by `validateStructuredFieldSet` or a render-time
  construct, so documenting them described a field the author could not save.
- `src/components/canvas/node-config-modal.tsx`,
  `node-config-modal-conversational.tsx` — `onOpenHelpDialog` carries the
  variant, following the existing `infoVariant` precedent.

No `domain` or `application` change was needed — both already supported this.

## Tests

Written before each implementation file, per CLAUDE.md.

- `apps/web/src/components/canvas/field-row-model.test.ts` — narrative offered
  to a structured step and `signature` withheld; both offered to a template
  step; no duplicates; the two lists agree on every non-signature type; the
  brief round-trips through `modelToLine` / `lineToModel` as
  `Scope (narrative: "…")`; `withType` carries a brief onto a narrative switch
  and drops it on the way out.
- `apps/web/src/components/canvas/template-tags-help-dialog.test.ts` — **new.**
  The structured variant offers no `(approval)`, `{{#Section Name}}` or
  `(repeat)` row and no `.docx` or tag framing; the template variant keeps all
  seven sections.
- `packages/adapters/src/agents/flow-session-graph.test.ts` — a structured step
  with a narrative field gets both the brief and the directive; one with only
  scalar fields gets neither.

**No e2e test.** None of the six groups in `docs/guides/e2e-test-policy.md`
applies — this is a `<select>` option, dialog copy, and prompt-string assembly,
all owned by the unit layer, where the coverage above sits.

`./validate.sh`: **24 passed, 0 failed** (314 test files across all packages).

## Deviations from the approved summary

One, added at the doc-review confirmation step and folded into the phase doc
before any code was written: **`TemplateTagsHelpDialog` was in scope after all.**
The approved summary listed it as out of scope; the user asked for it to be
fixed, because the structured editor's "?" opened a dialog headed "Template tags
& validation" that opened with "Your `.docx` template must contain at least one
`{{ tag }}` placeholder" and then documented three constructs a structured step
cannot save. It is now context-aware; the template variant renders what it
rendered before.

## Known limitations

- The narrative directive sits on the shared `<field_formats>` block, so a
  **document** step with narrative fields now receives it too. That is
  deliberate: it restates what the extraction prompt already tells the model for
  both paths, so it reinforces rather than contradicts. It is still a live
  prompt change to the `.docx` path, not only the structured one.
- `FieldConfigModal` is shared verbatim between the two editors, so the
  relabelled cog copy changes both — intended, since the old wording was
  document-specific in a component used by both.
- `structured-conversation.prd.md` §3 describes the per-field control as a
  vertical three-dot (⋮) overflow; the shipped control is a cog. Pre-existing
  drift, noted at doc review and left untouched here.
