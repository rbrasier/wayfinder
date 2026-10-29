# Implementation Summary — Template Drafting from Examples (v0.28.50)

- **Phase doc**: `template-drafting-from-examples.phase.md` (this folder)
- **PRD**: `docs/development/prd/template-drafting-from-examples.prd.md`
- **ADR**: `docs/development/adr/067-template-drafting-is-extract-then-code-anchor.adr.md`
- **Issue**: #347
- **Version**: PATCH, 0.28.49 → 0.28.50 (the maintainer's choice; no schema change)
- **Branch**: `release/alpha-2`, at the maintainer's request. This
  overrides the "no new features on a release branch" rule; it replaces PR
  #369, which targeted `main`.

## What was built

**Upload Template** (and **Replace**) on a conversational step now opens a
choice between two options:

- **I have a template with tags** opens the file picker into the existing
  guided annotation flow, unchanged.
- **Use an existing example** asks for confirmation using the restored
  "pattern" wording, then opens the drafting modal.

The drafting modal takes 1–10 `.docx` examples and lets the author pick the
base. It drafts in one request:

1. **Extract (AI).** The model returns label, type, options, multiple, an exact
   `sourceValue` and its occurrence. It only ever sees the base example's text.
2. **Place (code).**
   - Exact-match check: the value must be on one line at that occurrence.
   - Caption-to-value correction (ported from `ed73b66`), with insert-after
     when the value is blank.
   - Comparison filter: with 2+ examples, a value present in every example
     goes to "Same in every example".
   - Overlap guard.
   - Multi-select choices are collected from the other examples by code.
3. **Verify (AI).** The model sees the tagged text and may only add fields.
   Its positions are mapped back onto the base text, and anything inside an
   existing placeholder is discarded. A failure here costs only the
   additions.

`annotate()` then writes every placeholder into the base example in one
pass, as plain text replacements inside the existing runs. Untouched parts
come back byte-for-byte.

The **review** step shows:
- the found-fields summary
- one row per field, with "Replaces …" or "Goes after …", the surrounding
  text, and an evidence badge
- **Looks right** confirmation for checking-pass rows (save is blocked until
  each is confirmed)
- the "Not placed" list
- the "Same in every example" list, with one-click Restore
- "Need to add more fields? Download draft"

**Compare** shows the original and tagged text side by side, paragraph by
paragraph. Hovering or focusing a value highlights its placeholder, and back.
Below 768 px the panes stack with an Original / Tagged toggle.

**Save** posts the base example and the reviewed rows to the existing
`POST …/template`, which re-annotates and stores the template exactly as the
tagged-template path does. No example file is ever stored.

## Files created

| Layer | File |
| ----- | ---- |
| domain | `packages/domain/src/entities/template-draft.ts` (+ `.test.ts`) |
| application | `packages/application/src/use-cases/document/draft-template-from-examples.ts` (+ `.test.ts`) |
| apps/web | `src/app/api/flows/[id]/nodes/[nodeId]/template/draft/route.ts` (+ `route.test.ts`) |
| apps/web | `src/lib/template-draft-upload.ts` (+ `.test.ts`), `src/lib/template-draft-limits.ts` |
| apps/web | `src/components/canvas/template-upload-flow-model.ts` (+ `.test.ts`) |
| apps/web | `src/components/canvas/template-draft-model.ts` (+ `.test.ts`) |
| apps/web | `src/components/canvas/template-draft-compare-model.ts` (+ `.test.ts`) |
| apps/web | `src/components/canvas/template-source-choice-modal.tsx`, `template-draft-modal.tsx`, `template-draft-review.tsx`, `template-draft-compare.tsx` |

## Files modified

| Layer | File | Change |
| ----- | ---- | ------ |
| domain | `src/entities/index.ts` | Export `template-draft` |
| shared | `src/schemas/document.ts` | `templateDraftFieldSchema`, extraction and verification schemas |
| application | `src/use-cases/document/index.ts` | Export the use case |
| adapters | `src/documents/docx-generator.test.ts` | Format-preservation tests: untouched parts byte-identical, only the edited characters change, formatting/image/table kept, a value crossing a paragraph break is refused. **No adapter code changed.** |
| apps/web | `src/lib/template-annotation.ts` (+ test) | `AnnotationRow.draft`, `rowsFromDraft`; `buildAnnotationEdits` handles insert-after, and treats a cleared drafted row as a rejection (no edit) |
| apps/web | `src/lib/container-document-use-cases.ts` | Wire `draftTemplateFromExamples` |
| apps/web | `template-upload-controller.tsx` | Reducer-backed controller and host: choice → examples or tagged |
| apps/web | `node-config-modal.tsx`, `node-config-modal-conversational.tsx` | Upload/Replace open the choice (`onStartTemplateUpload`) |
| apps/web | `template-annotation-modal.tsx` | Export `TemplateErrorPanel`, `Working`, `ReuploadPanel` for reuse |
| apps/web | `e2e/enhance-template-annotation.spec.ts` | Three tests for the choice and example paths |
| root | `VERSION`, `package.json` | 0.28.50 |

## Migrations

None. The template stays in the step's config, as before.

## Tests

Each test file was written before its implementation.

| Area | File | Tests |
| ---- | ---- | ----- |
| Domain | `template-draft.test.ts` | 37 |
| Use case | `draft-template-from-examples.test.ts` | 20 |
| Adapter | `docx-generator.test.ts` | 59 (4 new) |
| Web lib | `template-annotation.test.ts` | 22 (7 new) |
| Web lib | `template-draft-upload.test.ts` | 9 |
| Route | `template/draft/route.test.ts` | 7 (asserts the storage port is never called) |
| Model | `template-upload-flow-model.test.ts` | 8 |
| Model | `template-draft-model.test.ts` | 17 |
| Model | `template-draft-compare-model.test.ts` | 4 |

**E2E:** `apps/web/e2e/enhance-template-annotation.spec.ts` was extended,
under policy group 3 (file upload and download). It covers the tagged choice
through the real file chooser, the example path through to save with the
comparison, and the per-file refusal plus the failed-draft Retry / Tag it
myself. The draft and save routes are stubbed with `page.route`, as the spec
already does. The spec was written, not run; CI runs it.

## Deviations from the approved summary

1. **Download** (agreed at approval). The tagged `.docx` comes back from the
   draft route as base64 and is held only in the browser. Re-uploading it
   enters today's tagged-template flow.
2. **Scope correction** (agreed at approval). `node-config-modal.tsx` hosts
   the conversational panel and is modified. The extraction editor's upload
   is what is unchanged.
3. **One extra evidence kind, `blank-in-example`.** An insert-after field has
   no value to compare, so neither "varies" nor "single-example" was true for
   it. Its badge reads "Blank in your example" and needs no confirmation.
4. **Not-found values are listed too.** "Not placed" also lists extracted
   values the exact-match check dropped (`not-in-document`), not only
   `annotate()` misses. A checking-pass suggestion that isn't found is
   dropped silently.
5. **No `.tsx` component tests.** The repo has no component-test setup, so
   the choice and flow logic live in `template-upload-flow-model.ts` and are
   unit-tested there. The rendered behaviour is covered by the e2e spec.
6. **The draft request carries no `userId`.** `authoriseTemplateNode` doesn't
   expose it, so usage is recorded against the flow only.

## Known limitations

- The comparison shows extracted text, not a rendered Word page.
- Only body text is drafted. Headers and footers keep their text, but values
  in them are never proposed, because `extractFullText` reads the body only.
- Text beyond the 32k-character extraction cap is not seen by the model.
- `template-draft-extract` and `template-draft-verify` resolve to the
  **chat** model setting, because the adapter maps only purposes containing
  "document" or "branch" to other models.
- With a single example there is no comparison. Accuracy rests on the
  prompt, the exact-match check and caption correction.
- The drafting progress messages are timed cues. The server does all three
  stages in one request.
