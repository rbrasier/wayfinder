# Phase — Template Drafting from Examples

- **Status**: Draft (run `/doc-review` before `/build`)
- **Target version**: **PATCH**, 0.40.3 → 0.40.4 on `main`. CLAUDE.md's rule
  would make a new feature MINOR. The maintainer chose PATCH on 2026-10-28
  because this extends the existing template upload flow and changes no
  schema. `/build` applies the bump.
- **Release line**: `alpha-3` (`main`)
- **PRD**: `docs/development/prd/template-drafting-from-examples.prd.md`
- **ADR**: `docs/development/adr/066-template-drafting-is-extract-then-code-anchor.adr.md`
- **Issue**: #347

## 1. Goal

From a conversational step's **Upload template**, an author can draft a
tagged `.docx` template from one or more filled copies of the same document,
then review it, preview it and save it into the step's config. The drafting
is split into AI extraction, placement by code, and AI verification, so the
"tags in the wrong place" failure that got the feature removed in `cdcab7d`
cannot come back.

## 2. Approved change summary (2026-10-28)

This adds a "draft from examples" path to template upload on a
conversational step. A new modal opens with two buttons side by side: **I
have a template with tags** (today's flow, unchanged) and **Use an existing
example**. The example path takes one or more filled `.docx` copies of the
same document type and drafts one template in three stages: the AI lists
field names and values, app code swaps those values for tags using the
existing `annotate()`, then the AI checks for anything missed. With two or
more examples, a value only counts as a field if it differs across the
copies. The author previews and reviews the draft before it is saved into
the step's config, as today. Examples are never stored.

**Business rules**
- 1–N `.docx` examples, all the same document type. The first is the base
  document that gets tagged.
- A drafted field must quote its value exactly from the base text, or it is
  dropped before `annotate()`. An `annotate()` miss is shown as "not
  placed".
- With 2+ examples, a value that is identical in every copy is not tagged
  unless the author restores it. With 1 example, there is no comparison.
- The verify pass can only add fields, through the same exact-match and
  `annotate()` path.
- Nothing is saved until the author confirms the preview. Examples never
  reach object storage.

**UI**: a choice modal, then drop examples → progress (*Reading examples →
Drafting fields → Checking for anything missed*) → review grid (each row
shows the value it replaced, plus "Not placed" and "Same in every example"
lists) → preview → save. Empty and error states: no fields found, a file
that isn't `.docx`, AI failure (Retry, or Tag it myself).

**Amendment, approved 2026-10-28.** This restores parts of the earlier
AI-annotation work deleted in `cdcab7d`: the caption-to-value correction and
insert-after-caption for blank values (`ed73b66`); surrounding text per row;
"Replaces" vs "Goes after"; multi-select detection; the "completed
document" wording and confirmation; the found-fields summary; the footer
layout; and Download / re-upload. The AI's self-reported confidence bar and
its confirm gate are *replaced* by evidence labels (**Differs in N of M
examples**, **Only one example**, **Added by the checking pass**). Only
checking-pass rows need confirmation before saving.

**Amendment, doc-review 2026-10-28.** (1) Tag insertion must preserve the
original document's formatting: a plain text replacement inside existing
runs, via `annotate()`, and never a rebuild. (2) The preview step becomes a
side-by-side comparison of the original and the tagged document.

**Data & types**: `TemplateDraftField`, `resolveCaptionAnchor`, `DraftEvidence`, `countExamplesLacking`,
`DraftTemplateFromExamples`, and the purposes `template-draft-extract` and
`template-draft-verify`.

**DB**: none. **Risks**: single-example reliability; values that are the
same in every copy by coincidence; values Word splits across runs; token
cost. **Out of scope**: `.xlsx`, packs of different document types, a
template library, storing examples, section and group tags.

## 3. Grounding: what already exists

| Piece | Where | Use |
| ----- | ----- | --- |
| `TemplateAnnotationEdit`, `annotate()` | `packages/domain/src/ports/document-generator.ts:47-80`, `packages/adapters/src/documents/docx-generator.ts` | Placement. Its documentation already names "replacing a filled example's literal value with a new placeholder". No adapter change. |
| `extractFullText` | same port | Base text for the AI and for the comparison; preview text after annotation |
| `ILanguageModel.generateObject` with a string `purpose` | `packages/domain/src/ports/language-model.ts` | Both AI calls. Check whether the runtime per-purpose model map needs entries for the two new purposes, or falls back to the default. |
| `AnnotationRow`, `buildAnnotationEdits` | `apps/web/src/lib/template-annotation.ts` | Drafted fields become rows with `occurrences: [{ sourceText: sourceValue, occurrence }]` |
| `POST …/template` | `apps/web/src/app/api/flows/[id]/nodes/[nodeId]/template/route.ts:176` | Save, unchanged. It already re-runs `annotate()` and returns 422 on any unmatched edit. |
| `useTemplateUpload`, `TemplateAnnotationHost` | `apps/web/src/components/canvas/template-upload-controller.tsx` | Gains a "choice" entry state |
| Annotation modal, step model, grid | `template-annotation-modal.tsx`, `template-annotation-model.ts`, `template-field-editor.tsx` | Reused for the review step |
| `SummariseTemplate` | `packages/application/src/use-cases/document/summarise-template.ts` | Pattern for an AI use case with a Zod schema and a purpose |

Removed in `cdcab7d` and **not** restored: `SuggestTemplateFields`, the
`/suggest` route, `classifyTemplateSource`, `rowsFromSuggestions`, the
confidence fields on rows, and the low-confidence gate.

**Restored from history.** Port these; don't re-derive them. The original
design and its review rounds are written up in
`docs/development/implemented/alpha-2/v0.21.3/guided-annotation-upload.md`
and `guided-annotation-upload.summary.md`.

| What | Source | Goes to |
| ---- | ------ | ------- |
| `resolveAnchor`, `valueIntroducedBy`, `isUsableValue`, `CAPTION_SEPARATOR`, `MAX_INFERRED_VALUE_CHARS` | `git show cdcab7d^:packages/application/src/use-cases/document/suggest-template-fields.ts` (around lines 130–260) and its tests | `packages/domain/src/entities/template-draft.ts` as `resolveCaptionAnchor` (pure; no `mode`, because an example is always filled) |
| "Value, not caption" and multi-select prompt rules; the `multiple` and `options` schema fields | the same file's `buildPrompt` and `suggestedTemplateFieldsSchema` | the extraction prompt and schema |
| `insertAfter` → `caption + " " + tag` in `buildAnnotationEdits` | `git show cdcab7d^:apps/web/src/lib/template-annotation.ts` | `apps/web/src/lib/template-annotation.ts` |
| Row meta line ("Replaces" / "Goes after", context truncated with a `title` tooltip) | `git show cdcab7d^:apps/web/src/components/canvas/template-annotation-modal.tsx` (around lines 620–690) | the draft modal's row. Swap `ConfidenceBar` for an evidence badge. |
| `branchFor("filled")` wording and `confirmationBody` | `git show cdcab7d^:apps/web/src/components/canvas/template-annotation-model.ts` | the choice modal's **Use an existing example** button and its confirmation, made plural |
| Found-fields two-column summary | `d900b6b` | the top of the review step. `rowTypeLabel` still exists. |

## 4. What is built

| Layer | File | Change |
| ----- | ---- | ------ |
| domain | `packages/domain/src/entities/template-draft.ts` (+ `.test.ts` first) | `TemplateDraftField` type; `DraftEvidence`; `countExamplesLacking(value, otherTexts): number` (normalises whitespace only); `valueAfterCaption(caption, text)` (shares `valueIntroducedBy` with `resolveCaptionAnchor`); `locateExactOccurrence(paragraphs, value, occurrence): boolean` for the exact-match check. It counts within paragraphs in body → headers → footers order, matching `annotate()`'s counter, so a value spanning paragraphs never matches; `resolveCaptionAnchor(...)`, which returns `{ sourceText, occurrence, insertAfter }`; `contextAround(text, position, maxChars = 200)` |
| shared | `packages/shared/src/schemas/document.ts` | `templateDraftExtractionSchema` and `templateDraftVerificationSchema`: `{ fields: { label, type, options, multiple, sourceValue, occurrence }[] }`, where `type` is limited to the existing template field types |
| application | `packages/application/src/use-cases/document/draft-template-from-examples.ts` (+ `.test.ts` first) | `DraftTemplateFromExamples(languageModel, documentGenerator)`. Input `{ baseBytes, baseText, otherTexts }`. Output `{ fields, sameInEveryExample, unplaced, comparison }`, where `comparison = { original: Paragraph[], tagged: Paragraph[], links: { originalSpan, taggedSpan, fieldKey }[] }`. Runs extract → exact-match check → caption correction → comparison filter → `annotate()` → verify → (the same checks and `annotate()`) once more → `extractFullText` of both documents to build `comparison`. Each field carries `evidence`, `context` and `insertAfter`. With 2+ examples, a multi-select's options are the union of the values seen. Never throws; returns `Result`. |
| apps/web | `apps/web/src/app/api/flows/[id]/nodes/[nodeId]/template/draft/route.ts` | Auth via `authoriseTemplateNode`. Reads 1–10 `.docx` files (10 MB each, 25 MB total) from multipart, extracts text, runs the use case, and maps fields to `AnnotationRow`s. **No storage call.** |
| apps/web | `apps/web/src/lib/container.ts` | Wire `DraftTemplateFromExamples` |
| apps/web | `apps/web/src/lib/template-annotation.ts` | Optional `draft` metadata on `AnnotationRow`; `buildAnnotationEdits` handles `insertAfter` |
| apps/web | `apps/web/src/components/canvas/template-source-choice-modal.tsx` | Step 1: two side-by-side buttons. **Use an existing example** uses the restored "pattern" wording and asks for confirmation before the file picker opens. |
| apps/web | `apps/web/src/components/canvas/template-draft-model.ts` (+ `.test.ts` first) | Step state for the example path: `choose-examples → drafting → review → preview → saving` (plus the existing `reupload`); the choice of base document; restoring a "same in every example" field as a row; `saveBlockedReason` extended to block on an unconfirmed **Added by the checking pass** row |
| apps/web | `apps/web/src/components/canvas/template-draft-modal.tsx` | The example path's UI. Reuses `template-field-editor.tsx` for the review grid. Each row shows "Replaces '…'" or "Goes after '…'", its surrounding text and an evidence badge. The review step opens with the found-fields summary. The footer has Cancel bottom-left and actions bottom-right, plus "Need to add more fields? Download…" leading to the existing re-upload panel. The preview step is a two-pane comparison (`template-draft-compare.tsx`), with the original on the left and the tagged version on the right, aligned by paragraph. Replaced values and tags are highlighted, and hovering one highlights its pair. Below 768 px the panes stack with an Original / Tagged toggle. It shows text, not a rendered Word page. |
| apps/web | `template-upload-controller.tsx`, `node-config-modal-conversational.tsx` | **Upload template** opens the choice modal; **I have a template with tags** triggers the existing file input and flow |

Save: the draft modal posts the base `File` and the reviewed rows to the
existing `POST …/template`, exactly as the annotation modal does today.

## 5. Database changes

None. No migration.

## 6. Implementation order (tests first)

1. `template-draft.test.ts` → `template-draft.ts`. Cases: a value present in
   every example → 0; missing from 2 of 3 → 2; whitespace-only
   differences → 0; formatting differences ("$1,200" vs "$1,200.00") →
   counted as lacking; `valueAfterCaption` on the same-line and next-cell
   layouts, and null when the caption is missing; the exact-match check at occurrence 0, 1 and out of range.
   `resolveCaptionAnchor`, porting the `ed73b66` cases: a caption with its
   value on the same line ("Supplier Name: Acme") moves to "Acme"; a
   caption with its value in the next cell moves to the next line; a blank
   value → `insertAfter`; the next line being another caption or text
   already carrying a tag → `insertAfter`; a value over 120 characters →
   `insertAfter`; the occurrence is re-indexed by the value's own count.
2. Shared Zod schemas.
3. `draft-template-from-examples.test.ts` → use case, with a fake
   `ILanguageModel` and a fake `IDocumentGenerator`. Cases: a field whose
   value is not in the base text is dropped; a field with the same value in
   every example goes to `sameInEveryExample`; with one example, the
   comparison filter is skipped; verify additions are filtered and placed;
   verify cannot remove fields already placed; a caption-anchored field is
   placed on its value; evidence is set correctly for 1 example, 2+
   examples and checking-pass fields; multi-select options are the union of
   `valueAfterCaption` across examples; a restored row carries evidence
   `Restored`; `annotate().unmatched` →
   `unplaced`; AI error → `Result` error; the purposes are exactly
   `template-draft-extract` and `template-draft-verify`.
4. Adapter: `docx-generator.test.ts`, if not already covered. Using a fixture
   with bold, italic, a table, an image, a header and a footer:
   - parts with no edits are byte-identical after annotation;
   - each edited run's `<w:rPr>` is unchanged;
   - a value split across runs is replaced in place;
   - a value spanning two paragraphs comes back as `unmatched`.
5. Draft route plus a route test asserting that the storage port is never
   called, plus rejection by file type, count and size.
6. `template-annotation.test.ts`: an `insertAfter` edit keeps the caption.
   `template-draft-model.test.ts` → model (step transitions, base choice,
   restore, save blocked until checking-pass rows are confirmed).
7. Comparison model test (paragraph alignment, span links) → compare pane.
   Choice modal, draft modal, and the controller and conversational config
   wiring. Component tests for the two-button choice and the unchanged
   tagged-template path.
8. E2E: one spec, `apps/web/e2e/template-drafting-from-examples.spec.ts`,
   only if `docs/guides/e2e-test-policy.md` puts the path from upload to
   save in one of its six groups. Otherwise cover it with component tests.
   Stub the language model; don't use a live AI.
9. `./validate.sh`.

## 7. ADR required

ADR-066 (new). The AI extracts, code places tags, the AI verifies; the
comparison is a domain function; the draft route persists nothing.

## 8. Risks / open questions

- **Single example.** Tell the author that more examples improve accuracy.
  Measure the share of fields that fail the exact-match check during build
  testing on real documents before calling it done.
- **Captions taken for values.** This was the old pass's main failure, and
  the exact-match check can't catch it. `resolveCaptionAnchor` is required,
  not optional.
- **Coincidental sameness.** Restoring a field must be one click from the
  "Same in every example" list.
- **Values Word splits across runs.** Covered by existing `annotate()`
  behaviour, plus the adapter fixture in step 4.
- **Occurrence drift.** `extractFullText` and `annotate()` must count
  occurrences the same way. Counting per paragraph in reading order keeps
  them aligned, and the step-4 fixture checks it.
- **Comparison is text-only.** It shows extracted text, not a rendered
  Word page. A rendered preview is future work.
- **Prompt injection from example content.** Examples are untrusted text.
  The AI output is limited to the schema, and every value must match the
  base text exactly, so the worst case is a wrong or extra tag, which the
  author sees in review.
- **Scope check for `/doc-review`.** Only the conversational node config is
  in scope, per the maintainer. The "Generate document" node config
  (`node-config-modal.tsx`) keeps today's flow.

## 9. Approved build summary (/build, 2026-10-29)

Approved as presented, with two deviations found in the build pre-flight:

1. **Download.** The current annotation modal no longer has a download
   button. The draft route returns the tagged `.docx` as base64, held in the
   browser and never stored. "Need to add more fields? Download…" hands that
   file over, and re-uploading it enters today's tagged-template flow.
2. **Scope correction.** `node-config-modal.tsx` hosts the conversational
   panel, so it is modified. What keeps today's flow is the extraction
   editor's separate template upload (`components/extraction/editor-cards.tsx`).

Noted risk: `template-draft-extract` and `template-draft-verify` resolve to
the **chat** model, because the adapter only maps purposes containing
"document" or "branch" to other models.

Build order: domain → shared + application → adapter tests → web lib + draft
route + container → web models → web UI → e2e spec extension, docs and
version.
