# Phase — Spreadsheet (xlsx) Templates

- **Status**: Awaiting review
- **Target version**: 2.10.0  (bump: MINOR — new feature, additive `app_flow_nodes.config` jsonb; no migration)
- **PRD**: `docs/development/prd/spreadsheet-templates.prd.md`
- **ADRs**: ADR-039 (tag-mode precedence, header-row fallback, in-place fill vs single-row append, one new renderer)
- **Depends on**: `.docx` tag parser + upload validation (`packages/domain/src/entities/template-field.ts`), `ISpreadsheetParser` (`packages/domain/src/ports/spreadsheet-parser.ts`), document generation (ADR-009, `generate-document.ts`, `packages/adapters/src/documents/docx-generator.ts`), extraction/summarise path

## 1. Problem

The Template output type only accepts `.docx`. Many processes' natural artefact is
a spreadsheet, and authors who own an `.xlsx` cannot anchor a flow on it. Accept
`.xlsx` as a template with two authoring conventions — `{{ tags }}` anywhere
(precedence) or a header row (single record). See the PRD.

## 2. Goals

- `.xlsx` accepted on Template steps alongside `.docx`.
- **Tag mode** if any `{{ tag }}` exists in any cell (parse via `parseTemplateFields`,
  validate at upload); **header-row mode** otherwise (first non-empty row →
  fields). Tags win.
- Output is a filled `.xlsx`: tags filled in place; header mode writes one data row
  under the headings.
- Upload rejects malformed tags or a missing header row.
- Single record only.

## 3. Non-goals

Multi-row/batch execution (future stub, PRD §11); mixing modes in one file (tags
win); formula/chart preservation guarantees; PDF; sheet-as-lookup (that is
external-sourced field values).

## 4. Approach

Bottom-up, test-first. At upload, scan all cells of all sheets for tags; branch to
tag mode or header mode and record `documentTemplateFormat` + `spreadsheetTemplateMode`
on the node config. Reuse the tag parser and validation unchanged. Add one adapter,
`xlsx-generator.ts`, behind `IDocumentGenerator`; `generate-document.ts` selects it
by format. No schema change.

## 5. Key entities / files

| Layer | File | Change |
|-------|------|--------|
| domain | `packages/domain/src/entities/flow-node.ts` | add `ConversationalNodeConfig.documentTemplateFormat?: "docx" \| "xlsx"` (absent ⇒ docx) and `spreadsheetTemplateMode?: "tags" \| "header"` |
| domain | `packages/domain/src/ports/spreadsheet-parser.ts` | add a cell-level tag scan (return raw tags + a header/first-row read) alongside the existing `columns`/`rows` |
| application | `packages/application/src/use-cases/document/generate-document.ts` | select renderer by `documentTemplateFormat` |
| application | template summarise/extract path | read tags/headings from `.xlsx` at upload; validate |
| adapters | `packages/adapters/src/documents/xlsx-generator.ts` | new — fill tags in place (tag mode) or write one data row under the header (header mode); verify the xlsx lib API in `node_modules` |
| adapters | `packages/adapters/src/documents/docx-generator.ts` | unchanged; kept as the `docx` renderer |
| web | `apps/web/src/components/canvas/node-config-modal-conversational.tsx` | accept `.xlsx` in the template picker; show detected mode |
| web | `apps/web/src/server/routers/flow.ts` | accept `.xlsx` upload; run detection + validation; persist format + mode |

## 6. Implementation steps (test-first per CLAUDE.md)

1. **Domain — config + parser scan.** Add `documentTemplateFormat` /
   `spreadsheetTemplateMode`; extend `ISpreadsheetParser` with a tag scan + header
   read. Tests: tag present anywhere → tags returned; no tag → header row parsed;
   no header → error.
2. **Application — detection + validation.** At upload, decide mode: any tag ⇒ tag
   mode (run `parseTemplateFields` + existing validation); else header mode
   (headings → fields via `deriveFieldKey`). Tests: precedence (both present ⇒
   tags), malformed tag rejected, missing header rejected.
3. **Adapters — xlsx renderer.** Implement `xlsx-generator.ts`: tag mode fills each
   tag cell in place; header mode appends one data row. Tests: values land in the
   right cells; untouched cells preserved; output opens as valid `.xlsx`.
4. **Application — renderer selection.** `generate-document.ts` routes by format;
   `docx` unchanged. Tests: xlsx step calls the xlsx renderer, docx step the docx
   renderer.
5. **Web — upload + config.** Accept `.xlsx` in the conversational modal and the
   `flow` router; show detected mode; persist format + mode. Router tests cover
   both modes and rejection paths.
6. **Version + validate.** Bump `VERSION` and `package.json#version` to `2.10.0`.
   Run `./validate.sh`; fix all failures. Move this phase doc to
   `docs/development/implemented/alpha-2/v2.10.0/` with a summary.

## 7. Acceptance criteria

Mirror PRD §10:

- [ ] Template step accepts `.xlsx` alongside `.docx`.
- [ ] Any `{{ tag }}` ⇒ tag mode; headings ignored.
- [ ] No tags ⇒ header-row fields.
- [ ] No tags and no usable header row ⇒ rejected at upload.
- [ ] Malformed tags ⇒ rejected at upload with a clear message.
- [ ] Output `.xlsx` valid: tags filled in place; header mode writes one data row.
- [ ] `documentTemplateFormat` absent ⇒ treated as `docx`; existing flows unchanged.
- [ ] Captured fields appear in Insights like a `.docx` step.
- [ ] Architecture intact; no migration.
- [ ] `VERSION` = `package.json#version` = `2.10.0`; `./validate.sh` passes.

## 8. Risks / open questions

- Bound the all-cell tag scan; clear error on implausibly large workbooks.
- Header detection (first non-empty row): define behaviour for merged cells and
  leading blank rows; cover with tests.
- xlsx library choice and styling round-trip on in-place fill — decide at build
  against `node_modules`; values guaranteed, styling best-effort.
- Confirm generated `.xlsx` flows through the same storage + document-card path as
  `.docx` (download card in chat).
