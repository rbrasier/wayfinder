# ADR-039 — Spreadsheet (xlsx) Template Format

- **Status**: Proposed (scoped by `spreadsheet-templates.prd.md`)
- **Date**: 2026-07-19

## Context

The Template output type only accepts `.docx`. `spreadsheet-templates.prd.md` adds
`.xlsx` as a valid template so a flow can anchor on a spreadsheet the author
already owns. Two facts shape the design:

1. The `.docx` template pipeline already reduces a file to a `TemplateField[]` via
   `parseTemplateFields` and validates it at upload — none of that is Word-specific
   once tags are extracted.
2. `ISpreadsheetParser` (`packages/domain/src/ports/spreadsheet-parser.ts`) already
   parses `.xlsx` into `columns` + `rows` for HR datasets.

But a spreadsheet admits **two** natural authoring conventions, and they conflict:
tags can appear in arbitrary cells (like a Word doc), *or* the sheet can be a plain
table whose header row names the fields. A single file could contain both, so
precedence must be defined.

Constraints: additive/no migration (format + mode ride `app_flow_nodes.config`
jsonb); reuse the tag parser and upload-time validation; single record only
(multi-row batch is explicitly deferred).

## Decision

### 1. Detect mode at upload; tags take precedence

On upload of an `.xlsx`, scan **every cell of every sheet** for `{{ … }}` tags:

- **Any tag present → tag mode.** Extract the raw tags and run the *same*
  `parseTemplateFields` + validation as `.docx`. Header cells are ignored.
- **No tags → header-row mode.** Take the first non-empty row as the header; each
  heading becomes a field via `deriveFieldKey`/`deriveField` (default type `text`,
  no annotations). A file with no usable header row is rejected at upload.

Precedence is **tags win**, recorded as `spreadsheetTemplateMode: "tags" | "header"`
on the node config so runtime never re-guesses. `documentTemplateFormat: "docx" |
"xlsx"` (absent ⇒ `docx`) selects the pipeline.

### 2. Fill semantics per mode

- **Tag mode:** fill each `{{ tag }}` cell **in place** with its captured value,
  preserving the surrounding workbook. Tags may sit anywhere, so generation walks
  cells, not a fixed region.
- **Header-row mode:** write **one data row** immediately beneath the header row,
  one column per field in header order.

Both produce a valid `.xlsx` stored via the existing document storage; the
generator is selected by `documentTemplateFormat` in `generate-document.ts`.

### 3. Reuse the extractor and parser; add one renderer

- Upload-time tag extraction and header reading extend the existing
  extraction/summarise path and `ISpreadsheetParser` (add a cell-level tag scan).
- Generation adds one adapter, `xlsx-generator.ts`, beside `docx-generator.ts`,
  behind the existing `IDocumentGenerator` port. The xlsx library is chosen at
  build time by verifying the API in `node_modules` (CLAUDE.md), and must at least
  preserve cell values it does not touch.

### 4. Single record only

One session fills one sheet. Running a flow once per pre-existing row (batch) is a
different execution model and is deferred (`spreadsheet-templates.prd.md` §11);
reference-row lookups against a sheet remain the province of external-sourced
field values, not this feature.

## Alternatives considered

- **Header-row mode only (no tags in xlsx).** Simpler, but loses the "fill my
  existing calculator/register in place" case and breaks parity with `.docx`
  authoring. Rejected.
- **Tag mode only.** Forces authors to tag a plain data sheet they'd rather leave
  as a header table. Rejected — header mode is the low-effort on-ramp.
- **Let both modes coexist in one file (union the fields).** Ambiguous fill
  semantics (is a heading also a value cell?) and confusing validation. Rejected in
  favour of a clear precedence: any tag ⇒ tag mode, headings ignored.
- **Convert xlsx to docx internally.** Throws away the spreadsheet's structure and
  the whole point of an xlsx deliverable. Rejected.

## Consequences

**Positive**

- `.xlsx` reaches feature parity with `.docx` (tag parsing, upload validation,
  field capture, Insights) with one new renderer and a cell scan.
- Format + mode are explicit config, so runtime is deterministic and previewable.
- Additive, migration-free; existing `.docx` flows unchanged (`format` absent ⇒
  `docx`).

**Negative**

- A full-workbook cell scan adds upload cost; large workbooks need a bound and a
  clear error.
- Header detection is heuristic (first non-empty row); merged cells and leading
  blank rows need defined behaviour and tests.
- Style round-tripping on in-place fill depends on the chosen library; values are
  guaranteed, styling is best-effort.
