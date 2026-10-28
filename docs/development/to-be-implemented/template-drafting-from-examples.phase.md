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

**Data & types**: `TemplateDraftField`, `variesAcrossExamples`,
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
`/suggest` route, `classifyTemplateSource`, `rowsFromSuggestions`.

## 4. What is built

| Layer | File | Change |
| ----- | ---- | ------ |
| domain | `packages/domain/src/entities/template-draft.ts` (+ `.test.ts` first) | `TemplateDraftField` type; `variesAcrossExamples(value, otherTexts)` (normalises whitespace only); `locateExactOccurrence(text, value, occurrence): boolean` for the exact-match check |
| shared | `packages/shared/src/schemas/document.ts` | `templateDraftExtractionSchema` and `templateDraftVerificationSchema`: `{ fields: { label, type, sourceValue, occurrence }[] }`, where `type` is limited to the existing template field types |
| application | `packages/application/src/use-cases/document/draft-template-from-examples.ts` (+ `.test.ts` first) | `DraftTemplateFromExamples(languageModel, documentGenerator)`. Input `{ baseBytes, baseText, otherTexts }`. Output `{ fields, sameInEveryExample, unplaced, previewText }`. Runs extract → exact-match check → comparison filter → `annotate()` → verify → (exact-match check, comparison filter, `annotate()`) once more → `extractFullText` for the preview. Never throws; returns `Result`. |
| apps/web | `apps/web/src/app/api/flows/[id]/nodes/[nodeId]/template/draft/route.ts` | Auth via `authoriseTemplateNode`. Reads 1–10 `.docx` files (10 MB each, 25 MB total) from multipart, extracts text, runs the use case, and maps fields to `AnnotationRow`s. **No storage call.** |
| apps/web | `apps/web/src/lib/container.ts` | Wire `DraftTemplateFromExamples` |
| apps/web | `apps/web/src/components/canvas/template-source-choice-modal.tsx` | Step 1: two side-by-side buttons |
| apps/web | `apps/web/src/components/canvas/template-draft-model.ts` (+ `.test.ts` first) | Step state for the example path: `choose-examples → drafting → review → preview → saving`; the choice of base document; restoring a "same in every example" field as a row |
| apps/web | `apps/web/src/components/canvas/template-draft-modal.tsx` | The example path's UI. Reuses `template-field-editor.tsx` for the review grid; each row shows its replaced value. The preview highlights `{{ … }}` in `previewText`. |
| apps/web | `template-upload-controller.tsx`, `node-config-modal-conversational.tsx` | **Upload template** opens the choice modal; **I have a template with tags** triggers the existing file input and flow |

Save: the draft modal posts the base `File` and the reviewed rows to the
existing `POST …/template`, exactly as the annotation modal does today.

## 5. Database changes

None. No migration.

## 6. Implementation order (tests first)

1. `template-draft.test.ts` → `template-draft.ts`. Cases: a value present in
   every example → false; missing from one → true; whitespace-only
   differences → false; formatting differences ("$1,200" vs "$1,200.00") →
   true; the exact-match check at occurrence 0, 1 and out of range.
2. Shared Zod schemas.
3. `draft-template-from-examples.test.ts` → use case, with a fake
   `ILanguageModel` and a fake `IDocumentGenerator`. Cases: a field whose
   value is not in the base text is dropped; a field with the same value in
   every example goes to `sameInEveryExample`; with one example, the
   comparison filter is skipped; verify additions are filtered and placed;
   verify cannot remove fields already placed; `annotate().unmatched` →
   `unplaced`; AI error → `Result` error; the purposes are exactly
   `template-draft-extract` and `template-draft-verify`.
4. Draft route plus a route test asserting that the storage port is never
   called, plus rejection by file type, count and size.
5. `template-draft-model.test.ts` → model (step transitions, base choice,
   restore).
6. Choice modal, draft modal, and the controller and conversational config
   wiring. Component tests for the two-button choice and the unchanged
   tagged-template path.
7. E2E: one spec, `apps/web/e2e/template-drafting-from-examples.spec.ts`,
   only if `docs/guides/e2e-test-policy.md` puts the path from upload to
   save in one of its six groups. Otherwise cover it with component tests.
   Stub the language model; don't use a live AI.
8. `./validate.sh`.

## 7. ADR required

ADR-066 (new). The AI extracts, code places tags, the AI verifies; the
comparison is a domain function; the draft route persists nothing.

## 8. Risks / open questions

- **Single example.** Tell the author that more examples improve accuracy.
  Measure the share of fields that fail the exact-match check during build
  testing on real documents before calling it done.
- **Coincidental sameness.** Restoring a field must be one click from the
  "Same in every example" list.
- **Values Word splits across runs.** Covered by existing `annotate()`
  behaviour; add one docx adapter fixture with a value split across runs if
  none exists.
- **Prompt injection from example content.** Examples are untrusted text.
  The AI output is limited to the schema, and every value must match the
  base text exactly, so the worst case is a wrong or extra tag, which the
  author sees in review.
- **Scope check for `/doc-review`.** Only the conversational node config is
  in scope, per the maintainer. The "Generate document" node config
  (`node-config-modal.tsx`) keeps today's flow.
