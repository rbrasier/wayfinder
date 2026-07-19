# PRD — Spreadsheet (xlsx) Templates

- **Status**: Draft
- **Date**: 2026-07-19
- **Author**: rbrasier
- **Target version**: 2.10.0  (bump: MINOR — new feature, additive `app_flow_nodes.config` jsonb; no migration. See `docs/guides/versioning.md`.)

## 1. Problem

The Template output type only accepts `.docx`. Many document-heavy processes'
natural artefact is a spreadsheet — asset registers, trackers, calculators,
simple data-collection sheets — not a Word document. An author who already owns
an `.xlsx` cannot anchor a flow on it and must rebuild the artefact as a Word doc
purely to unlock field capture and generation.

## 2. Users / Personas

- **Flow owner / business analyst** — owns an `.xlsx` they already produce and
  wants to upload it as a template, the same way they upload a `.docx`.
- **Operator** — completes the guided conversation and downloads a filled `.xlsx`.
- **Auditor / reporting consumer** — reads captured fields through Insights,
  unchanged, regardless of the template's file format.

## 3. Goals

- `.xlsx` is a valid upload for the **Template** output type, alongside `.docx`.
- **Two authoring conventions**, auto-detected at upload:
  - **Tag mode** — if the workbook contains `{{ tags }}` in **any** cell (any
    sheet, anywhere — not restricted to a row), parse them exactly like a `.docx`
    template via `parseTemplateFields`. **Tag mode takes precedence** whenever any
    tag is present.
  - **Header-row mode** — if **no** tags are present, the **header row's column
    headings** become the fields (one record). A file with no usable header row is
    rejected at upload.
- Output is a filled `.xlsx`:
  - Tag mode fills each `{{ tag }}` cell **in place** with the captured value.
  - Header-row mode writes **one data row** immediately beneath the headings.
- **Upload-time validation** mirrors `.docx`: malformed/invalid tags are rejected
  with a clear message; header-row mode with no headings is rejected.
- **Single record only** — one session produces one filled sheet.

## 4. Non-goals

- **Multi-row / batch execution** (run the flow once per existing row). Real use
  cases exist (bulk onboarding, mail-merge, per-row enrichment) but it is a
  different execution model and is captured as a separate future phase (§11).
- Mixing tag mode and header-row mode in one file — if any tag exists, tag mode
  wins and headings are ignored.
- Preserving/recalculating spreadsheet **formulas or charts** beyond writing cell
  values into the uploaded workbook.
- PDF output.
- Reference-row lookups from a sheet — already served by external-sourced field
  values (lookup sources).

## 5. Key entities

| Entity | Lives in | New / existing | Notes |
| ------ | -------- | -------------- | ----- |
| `ConversationalNodeConfig.documentTemplateFormat?` | `packages/domain/src/entities/flow-node.ts` | existing (add field) | `docx` \| `xlsx`; absent = `docx` (back-compat). |
| `ConversationalNodeConfig.spreadsheetTemplateMode?` | `packages/domain/src/entities/flow-node.ts` | existing (add field) | `tags` \| `header`; set at upload for xlsx. |
| `TemplateField` | `packages/domain/src/entities/template-field.ts` | existing (reuse) | tag parsing unchanged; header cells derive fields via `deriveFieldKey`. |
| `ISpreadsheetParser` | `packages/domain/src/ports/spreadsheet-parser.ts` | existing (reuse/extend) | already returns `columns` + `rows`; add a cell scan for `{{ tags }}`. |
| `IDocumentGenerator` | `packages/domain/src/ports/document-generator.ts` | existing (extend) | route to an xlsx renderer by format. |

## 6. User stories

1. As a **flow owner**, I can upload an `.xlsx` on a Template step and have its
   `{{ tags }}` become fields exactly like a `.docx`.
2. As a **flow owner**, I can upload an `.xlsx` that has only a header row and have
   the column headings become the fields.
3. As a **flow owner**, if my `.xlsx` has both tags and headings, the tags win and
   I am told so.
4. As an **operator**, I download a filled `.xlsx` — tags filled in place, or one
   data row written under the headings.
5. As a **flow owner**, an `.xlsx` with malformed tags or no header row is rejected
   at upload with a clear message, not mid-session.

## 7. Pages / surfaces affected

- Template upload/validation in the `flow` tRPC router and the conversational node
  config modal — accept `.xlsx`, detect mode, validate.
- `apps/web/src/components/canvas/node-config-modal-conversational.tsx` — accept
  `.xlsx` in the template picker; show detected mode.
- `packages/application/src/use-cases/document/generate-document.ts` — select the
  renderer by `documentTemplateFormat`.
- `packages/adapters/src/documents/docx-generator.ts` + new
  `packages/adapters/src/documents/xlsx-generator.ts` — the xlsx render path.
- Document extraction/summarise path — read tags/headings from an `.xlsx` at
  upload.

## 8. Database changes

None. `documentTemplateFormat` and `spreadsheetTemplateMode` ride the existing
`app_flow_nodes.config` jsonb; generated files use existing document storage.

| Table | Change | Prefix valid? |
| ----- | ------ | ------------- |
| `app_flow_nodes` | none (jsonb `config` gains format + mode) | n/a |

## 9. Architectural decisions

- **New:** ADR-039 — xlsx as a template format: tag-mode precedence, header-row
  fallback, and in-place fill vs single-row append.
- **Assumes:** ADR-009 (document generation), the `.docx` tag parser and
  upload-time validation, `ISpreadsheetParser` (already used by HR datasets).

## 10. Acceptance criteria

- [ ] A Template step accepts an `.xlsx` upload alongside `.docx`.
- [ ] An `.xlsx` containing any `{{ tag }}` parses in tag mode; headings ignored.
- [ ] An `.xlsx` with no tags derives fields from the header row (header mode).
- [ ] An `.xlsx` with neither tags nor a usable header row is rejected at upload.
- [ ] Malformed tags in an `.xlsx` are rejected at upload with a clear message.
- [ ] Generated output is a valid `.xlsx`: tags filled in place; header mode writes
      one data row under the headings.
- [ ] `documentTemplateFormat` absent is treated as `docx` (existing flows
      unchanged).
- [ ] Captured fields appear in Insights identically to a `.docx` step.
- [ ] `VERSION` = `package.json#version` = `2.10.0`; `./validate.sh` passes.

## 11. Out of scope / future work

- **Batch runs** — run a flow once per row of an uploaded dataset (bulk
  onboarding, mail-merge, per-row enrichment). Separate execution model, separate
  future phase; not part of this PRD.
- Formula/chart preservation guarantees; multi-sheet output layouts.

## 12. Risks / open questions

- Tag-scan cost on large workbooks — bound the scan (all cells, all sheets) and
  fail clearly if a workbook is implausibly large.
- Header-row detection: assume the first non-empty row is the header; confirm
  behaviour for merged cells and leading blank rows.
- xlsx renderer library choice and whether it round-trips styling on in-place fill
  (decide in ADR-039 / at build against `node_modules`).
