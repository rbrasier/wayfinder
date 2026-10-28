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
   `TemplateDraftField[] = { label, type, sourceValue, occurrence }`. The
   AI never writes `{{ … }}`. The server builds the annotation line from
   `label` and `type`, as v0.21.3 did.
2. **Place (code).** Each field must pass two checks, in order:
   - **Exact-match check.** `sourceValue` must appear in the base text at
     `occurrence`. Fields that fail are dropped.
   - **Comparison filter** (only with 2+ examples).
     `variesAcrossExamples(sourceValue, otherExampleTexts)` must be true:
     the value is missing from at least one other example. Fields that fail
     are dropped and listed as "same in every example", so the author can
     restore them.

   The surviving fields become `TemplateAnnotationEdit`s and run through
   the existing `annotate()`. `annotate().unmatched` becomes the "Not
   placed" list.
3. **Verify (AI).** `generateObject` on the tagged text, purpose
   `template-draft-verify`. Its only output is *additional*
   `TemplateDraftField[]` for literal values that still look
   instance-specific. These go through stage 2 again, once. The verify pass
   cannot rename, remove or move a field that has already been placed.

### 2. The comparison is a pure domain function

`variesAcrossExamples(value: string, otherTexts: string[]): boolean` lives
in `packages/domain`. It normalises whitespace only, so formatting
differences count as variation. It has no AI or I/O, and its unit tests are
the spec. The AI only sees the base example. The other examples are used
only by this comparison, which keeps token cost proportional to one
document.

### 3. The draft route persists nothing

`POST …/template/draft` returns `AnnotationRow`s whose occurrences point at
the literal values, along with the unplaced fields and the preview text
(`extractFullText` of the in-memory `annotate()` output). Save uses the
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
- **Sending every example to the AI.** Rejected. It costs N× the tokens,
  and the comparison is more reliable done in code.

## Consequences

- Placement errors can now only come from wrong *values*, not wrong
  *positions*, and the exact-match check catches wrong values before
  anything is written.
- A value that is the same in every example by coincidence is not tagged.
  The review UI has to make restoring it a single click.
- Section and repeating-group tags are still written by hand.
