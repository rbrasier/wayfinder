# ADR-066 — Template Drafting: the AI Extracts, Code Places Tags, the AI Verifies

- **Status**: Proposed (scoped by `template-drafting-from-examples.prd.md`)
- **Date**: 2026-10-28
- **Assumes**:
  - The v0.21.3 annotation design (`eb5e93e`): `IDocumentGenerator.annotate()`,
    tag syntax built server-side, filled examples never stored
- **Revisits**: `cdcab7d`, which removed AI annotation as unreliable

## Context

`SuggestTemplateFields` (removed in `cdcab7d`) asked one AI call to find
the fields in a filled document and say where each placeholder belonged.
On real documents it "anchored to the wrong text, and each fix moved the
failure rather than removing it". In that design the AI was responsible
for both what a field is and where it sits in the document, and nothing
outside the AI could check either answer.

Issue #347 asks for drafting from a collection of filled documents of the
same type. That gives a signal the AI does not provide: text that changes
between copies is almost certainly a field.

## Decision

### 1. Three stages, and only one of them edits the document

1. **Extract (AI).** `generateObject` on the base example's text, purpose
   `template-draft-extract`. It returns
   `TemplateDraftField[] = { label, type, options, multiple, sourceValue, occurrence }`.
   The prompt carries the rule from `ed73b66`: `sourceValue` is the answer,
   never the question, and Word extracts one table cell per line. A short
   comma- or slash-separated list in a value is a fixed set (`multiple`).
   The AI never writes `{{ … }}`. The server builds the annotation line from
   `label` and `type`, as v0.21.3 did.
2. **Place (code).** Each field goes through three steps, in order:
   - **Exact-match check.** `sourceValue` must appear in the base text at
     `occurrence`. Fields that fail are dropped.
   - **Caption correction.** `resolveCaptionAnchor` (restored from the
     removed `resolveAnchor`). When `deriveFieldKey(sourceValue)` equals the
     field's own key, the AI pointed at the caption. The anchor moves to the
     value the caption introduces (the rest of the line after `:`, `|` or a
     dash, otherwise the next non-blank line, which is the next table cell)
     and is re-indexed by that value's own occurrence. If that value is
     blank, longer than 120 characters, ends in `:`, already has a tag, or
     is another field's caption, the tag is placed *after* the caption
     instead (`insertAfter`). The exact-match check alone cannot catch this
     error, because the caption really is in the document.
   - **Comparison filter** (only with 2+ examples).
     `countExamplesLacking(sourceValue, otherExampleTexts)` must be greater than 0:
     the value is missing from at least one other example. Fields that fail
     are dropped and listed as "same in every example", so the author can
     restore them.

   The surviving fields become `TemplateAnnotationEdit`s and run through
   the existing `annotate()`. `annotate().unmatched` becomes the "Not
   placed" list.

   **Format preservation is a requirement, not a side effect.** Placement
   is a plain text replacement: `annotate()` swaps the matched characters
   inside the existing runs for the tag text, and the tag keeps the first
   run's `<w:rPr>`. Parts with no edits are written back byte for byte.
   Nothing in this pipeline rebuilds a document from extracted text, and
   the AI only ever handles plain text. Because `annotate()` matches within
   a paragraph, the exact-match check counts occurrences paragraph by
   paragraph in reading order (body, then headers and footers). A value
   that crosses a paragraph break is therefore never addressable, which
   prevents its occurrence index from drifting from what `annotate()`
   counts.
3. **Verify (AI).** `generateObject` on the tagged text, purpose
   `template-draft-verify`. Its only output is *additional*
   `TemplateDraftField[]` for literal values that still look
   instance-specific. These go through stage 2 again, once. The verify pass
   cannot rename, remove or move a field that has already been placed.

### 2. Evidence, not self-reported confidence

The removed design showed the AI's own 0–100 confidence and made the author
confirm low scores before saving. That score was a guess with nothing
behind it. Each row now shows evidence that code can check:

| Label | When | Confirm before save? |
| ----- | ---- | -------------------- |
| Differs in N of M examples | 2+ examples, value missing from at least one | No |
| Only one example | 1 example; no comparison was possible | No |
| Added by the checking pass | Came from stage 3 | **Yes**, because it had the least scrutiny |
| Restored | The author restored it from "Same in every example" | No; the author chose it |

Each row also shows up to 200 characters of surrounding text, which code
takes from the base document at the resolved anchor, and "Replaces '…'" or
"Goes after '…'".

### 3. The comparison is a pure domain function

`countExamplesLacking(value: string, otherTexts: string[]): number` lives
in `packages/domain`. A result greater than 0 means the value varies, and
the count gives "Differs in N of M examples". `valueAfterCaption(caption,
text)` reuses the caption-to-value logic from §1 to read the same field's
value in another example. It is only used to collect multi-select choices,
never to place a tag. It normalises whitespace only, so formatting
differences count as variation. It has no AI or I/O, and its unit tests are
the spec. The AI only sees the base example. The other examples are used
only by this comparison, which keeps token cost proportional to one
document.

### 4. The draft route persists nothing

`POST …/template/draft` returns `AnnotationRow`s whose occurrences point at
the literal values, along with the unplaced fields and both texts for the
side-by-side comparison: the base example's paragraphs and the paragraphs of
the in-memory `annotate()` output, each with the character spans of every
replacement so the two panes can be aligned and linked. Save uses the
existing `POST …/template` with the base example and the reviewed rows, so
the save-time `annotate()` and its "refuse if anything is unmatched" rule
apply unchanged. Examples live in the browser between steps, as before.

## Alternatives considered

- **Bring back `SuggestTemplateFields` with better prompts.** Rejected. It
  is the design that failed, and the commit history shows prompt fixes
  shifted the failure rather than removing it.
- **Pure diff with no AI.** Rejected as the only signal. It cannot name
  fields or pick types, and it does nothing for a single example. It is
  kept as a filter.
- **Letting the AI return a rewritten document.** Rejected. That is the
  failure mode the issue thread describes ("trouble reconstructing the
  document").
- **Restoring the AI confidence bar and its confirm gate.** Rejected. The
  score is self-reported and was part of the design that failed. Evidence
  labels (§2) replace it. The `ConfidenceBar` component stays where chat
  uses it.
- **Letting the AI or code rebuild the document from text.** Rejected.
  It loses formatting, and it is the reconstruction failure from the issue
  thread.
- **Sending every example to the AI.** Rejected. It costs N× the tokens,
  and the comparison is more reliable done in code.

## Consequences

- Placement errors can now only come from wrong *values*, not wrong
  *positions*. The exact-match check catches values that are not in the
  document, and caption correction catches the one wrong value that is
  (the field's own caption).
- A value that is the same in every example by coincidence is not tagged.
  The review UI has to make restoring it a single click.
- Section and repeating-group tags are still written by hand.
