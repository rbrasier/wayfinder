# PRD — Template Drafting from Examples

- **Status**: Draft
- **Date**: 2026-10-28
- **Author**: rbrasier
- **Target version**: 0.40.4 (bump: PATCH, the maintainer's choice; see the phase doc §1)
- **Issue**: #347 (parent #346, "Wayfinder feedback")

## 1. Problem

Authors setting up a "Generate document" step usually already have filled
copies of the document: last quarter's contracts, completed request forms.
Today they have to open Word and type every `{{ tag }}` by hand before
Wayfinder will accept the file. Teams without a template author get stuck at
this point.

An earlier AI pass that drafted tags (v0.21.3, `eb5e93e`) was removed in
`cdcab7d` because "it anchored to the wrong text, and each fix moved the
failure rather than removing it". That pass asked a single AI call to find
the fields and say where they go. This PRD splits the work into smaller
steps: the AI finds fields and values, app code places the tags, and a
second AI call checks the result. Where the author has more than one
example, comparing the copies provides evidence that does not depend on the
AI.

## 2. Users / Personas

- **Flow author** (procurement officer, HR manager, ops lead). Has a folder
  of filled documents and wants a working template without learning the tag
  syntax first.
- **Template-literate author**. Already writes tags in Word. Wants the
  current flow unchanged.

## 3. Goals

- From a conversational step's config, the author can choose between
  **I have a template with tags** (today's flow) and **Use an existing
  example**.
- On the example path, the author uploads one or more filled `.docx`
  copies of the same document type and gets a drafted template to review,
  preview and save.
- Every drafted tag is placed by app code at text that actually appears in
  the base document. Edits that cannot be placed are shown to the author,
  never silently dropped.
- With two or more examples, wording that is identical in every copy is not
  tagged.
- Filled examples never reach object storage. Only the tagged result is
  saved, through the existing template save route.

## 4. Non-goals

- `.xlsx` examples.
- Packs of different document types that produce several templates.
- A template library, or storing templates outside the step config.
- Drafting section or repeating-group tags (`{{#…}}`, `{{^…}}`).
- Storing examples so a template can be drafted again later.

## 5. Key entities

| Entity | Lives in | New / existing | Notes |
| ------ | -------- | -------------- | ----- |
| `TemplateAnnotationEdit` | `packages/domain/src/ports/document-generator.ts` | existing | `{ find, occurrence, replacement }`, reused unchanged |
| `IDocumentGenerator.annotate()` | same | existing | Places tags in `.docx` runs and reports `unmatched` |
| `TemplateDraftField` | `packages/domain/src/entities/template-draft.ts` | new | `{ label, type, options, multiple, sourceValue, occurrence }`, where `sourceValue` is quoted exactly from the base document |
| `resolveCaptionAnchor` | same | new | Pure function, restored from the removed `resolveAnchor` (`ed73b66`). Moves a tag that landed on a field's caption onto the value the caption introduces, or marks the tag to go after the caption when there is no value. |
| `DraftEvidence` | same | new | `"varies" \| "single-example" \| "checking-pass"`, plus `{ differsIn, of }` for `varies`. Shown on each row in place of an AI confidence score. |
| `variesAcrossExamples` | same | new | Pure function: does a value differ across the example texts? |
| `DraftTemplateFromExamples` | `packages/application/src/use-cases/document/draft-template-from-examples.ts` | new | Extract → filter → place → verify |
| `templateDraftExtractionSchema`, `templateDraftVerificationSchema` | `packages/shared/src/schemas/document.ts` | new | Zod schemas for the two AI calls |
| `AnnotationRow` | `apps/web/src/lib/template-annotation.ts` | existing | Drafted fields become rows whose occurrences point at the literal value. Gains optional `draft: { replacedValue, context, insertAfter, evidence, confirmed }`. `buildAnnotationEdits` writes an insert-after as `caption + " " + tag`, as before `cdcab7d`, so the generators need no change. |

## 6. User stories

1. As a flow author, I click **Upload template** on a conversational step
   and choose between two side-by-side options, so I can start from what I
   actually have.
2. As a flow author, I drop three past contracts and get a draft listing
   the supplier name, contract value and start date, each with the value it
   replaced, so I can check it against the document.
3. As a flow author, I see a list of fields that could not be placed, so I
   know what is missing before I save.
4. As a flow author, I preview the tagged document before saving, so I can
   see where each tag landed.
5. As a flow author, each drafted field shows the text around it and
   whether it differs between my examples, so I can tell which "Smith" was
   tagged and how much evidence supports it.
6. As a template-literate author, I choose **I have a template with tags**
   and the flow is exactly what it is today.

## 7. Pages / surfaces affected

- Flow canvas → conversational node config
  (`node-config-modal-conversational.tsx`). **Upload template** opens a new
  choice modal instead of the file picker.
- `POST /api/flows/[id]/nodes/[nodeId]/template/draft`: new. Takes multipart
  `.docx` examples. Returns rows, unplaced fields and preview text. Persists
  nothing.
- `POST /api/flows/[id]/nodes/[nodeId]/template`: existing, unchanged. Saves
  the base example plus the reviewed rows, runs `annotate()` server-side,
  and rejects the save if any edit is unmatched.

## 8. Database changes

None. The template stays in the step's config and its object-storage key,
as it does today.

## 9. Architectural decisions

- ADR-066 (new): template drafting extracts with the AI and places tags with
  code, with a cross-example comparison filter and a verify-only second
  pass.
- Restores the caption-to-value anchoring from `ed73b66` and the
  modal's copy and layout from `eb5e93e`/`d900b6b`. It does not restore the
  AI's self-reported confidence (see ADR-066 §4).
- Assumes the annotation design from v0.21.3: tag syntax is built
  server-side, and examples are held in the browser and never stored.

## 10. Acceptance criteria

- [ ] The conversational config's **Upload template** opens a choice modal
      with two side-by-side buttons. **I have a template with tags** opens
      the file picker and continues into the existing analyse → review →
      save flow unchanged.
- [ ] **Use an existing example** accepts 1–10 `.docx` files, 10 MB each and
      25 MB in total. Any other file type is rejected per file with a
      reason.
- [ ] The first uploaded file is the base document, and the author can
      choose a different base before drafting.
- [ ] A drafted field whose `sourceValue` does not appear in the base text
      at the stated occurrence is dropped before placement. This is covered
      by a use-case test.
- [ ] With 2+ examples, a value that appears verbatim in every example is
      not tagged. This is covered by a domain unit test for
      `variesAcrossExamples` and a use-case test.
- [ ] With 1 example, no comparison filter runs, and the review step says
      so ("Add more examples to improve accuracy").
- [ ] A drafted `sourceValue` that is the field's own caption ("Employee
      Name") is moved onto the value the caption introduces (the rest of the
      line, or the next table cell) and re-indexed by that value's own
      occurrence. When there is no usable value (blank, prose over 120
      characters, another caption, or text that already has a tag), the tag
      goes after the caption and the caption is kept. Covered by domain unit
      tests carried over from `ed73b66`.
- [ ] Each review row shows: "Replaces '…'" or "Goes after '…'"; up to 200
      characters of surrounding text, taken by code from the base document;
      and an evidence label: **Differs in N of M examples**, **Only one
      example**, or **Added by the checking pass**. No AI confidence score
      is shown.
- [ ] Save stays blocked until the author confirms every **Added by the
      checking pass** row ("Confirm the fields the checking pass added
      before saving."). No other evidence label needs confirmation.
- [ ] A short comma- or slash-separated list in a filled value ("Mobile
      phone, Laptop") drafts as a multi-select. With 2+ examples, the
      choices are the union of the values seen across the examples.
- [ ] The review step opens with a found-fields summary (two columns, type
      in brackets, using "data fields" wording) before the editable grid.
- [ ] The **Use an existing example** button and its confirmation use the
      wording from the earlier design: "Wayfinder uses them as a pattern,
      working out which text changes each time and turning those parts into
      fields", and "The details in these documents (names, amounts, dates)
      will be replaced with fields. Your original files are not changed,
      and they are not saved."
- [ ] The modal footer follows the existing annotation modal: Cancel
      bottom-left, actions bottom-right. The review step offers "Need to add
      more fields? Download…", which reuses the existing download and
      `reupload` step.
- [ ] The verify pass can only add fields. Its additions go through the
      same exact-match check and placement as the extracted fields.
- [ ] Edits that `annotate()` reports as `unmatched` appear in a "Not
      placed" list on the review step.
- [ ] The preview step shows the tagged document text with the tags
      highlighted.
- [ ] Save sends the base example and the reviewed rows to the existing
      `POST …/template`. No other route writes to object storage. Covered by
      a route test asserting the draft route never calls the storage port.
- [ ] If the AI fails, the author sees "Couldn't draft fields", with
      **Retry** and **Tag it myself** (which opens the annotation reference).
- [ ] AI calls use the purposes `template-draft-extract` and
      `template-draft-verify`, and show up in usage tracking.

## 11. Out of scope / future work

- `.xlsx` examples (cell-level comparison is a different algorithm).
- Drafting section and repeating-group tags, for example a table of line
  items that varies in length.
- Packs of different document types → many templates or many steps.
- Templates on the "Generate document" node config (`node-config-modal.tsx`)
  as well as the conversational one.

## 12. Risks / open questions

- **Single-example reliability.** With no comparison, accuracy depends on
  the extraction prompt plus the exact-match check. The "Not placed" list
  and the preview make errors visible but cannot fix them.
- **Values that change formatting across copies.** "$1,200" in one copy and
  "$1,200.00" in another still counts as varying, which is correct. But a
  value that is the same in every copy by coincidence (one supplier for all
  three contracts) will not be tagged. The review step lets the author add
  it back from the base text.
- **Captions taken for values.** This was the main failure of the old pass
  (`ed73b66`). The exact-match check cannot catch it, because the caption is
  in the document, so `resolveCaptionAnchor` is required, not optional.
- **Values Word splits across runs.** This relies on `annotate()`'s existing
  handling of spans split across runs.
- **Token cost.** Ten long examples can be expensive. Only the base text is
  sent to the AI. The other examples are compared in code.
