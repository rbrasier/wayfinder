# Implementation Summary — Spreadsheet (xlsx) Templates (v2.11.0)

- **Version bump**: MINOR (2.10.0 → 2.11.0). New feature; additive
  `app_flow_nodes.config` jsonb fields; **no migration**.
- **PRD**: `docs/development/prd/spreadsheet-templates.prd.md`
- **ADR**: ADR-039 — `docs/development/adr/039-xlsx-template-format.adr.md`
- **Phase doc**: `spreadsheet-templates.phase.md` (this folder)

## What was built

A Template step now accepts an `.xlsx` upload alongside `.docx`, with two
auto-detected authoring conventions (ADR-039):

- **Tag mode** — any `{{ tag }}` in any cell of any sheet ⇒ the tags become the
  fields (parsed by the existing `parseTemplateFields` + upload validation).
  Tags take precedence; headings are ignored.
- **Header-row mode** — no tags ⇒ the first non-empty row's headings become the
  fields (one record). A file with neither tags nor a usable header row is
  rejected at upload.

Generation fills a real `.xlsx`: tag mode replaces each `{{ tag }}` cell in
place (untouched cells and the shared-strings table are preserved byte-for-byte;
styling is best-effort via the retained `s=""` reference); header mode writes one
data row immediately beneath the headings, shifting any rows below it down. The
generated file rides the same storage + document-card path as `.docx`, and
captured fields reach Insights identically.

Detection is recorded on the node config at upload
(`documentTemplateFormat: "docx" | "xlsx"`, `spreadsheetTemplateMode: "tags" |
"header"`), so runtime never re-guesses. `documentTemplateFormat` absent is
treated as `docx`, leaving every existing flow unchanged.

## Files created

- `packages/adapters/src/documents/xlsx-generator.ts` — `XlsxGenerator`
  implementing `IDocumentGenerator` (all-cell tag scan, header read, in-place
  tag fill, single-row append) + `detectMode`. PizZip-based, mirroring the HR
  `SpreadsheetParser` (no SheetJS-style dependency added).
- `packages/adapters/src/documents/xlsx-generator.test.ts` — 17 tests.
- `packages/adapters/src/documents/document-generator-router.ts` —
  `DocumentGeneratorRouter`, a composite `IDocumentGenerator` that dispatches
  each call to the docx or xlsx renderer by sniffing the template bytes.
- `packages/adapters/src/documents/document-generator-router.test.ts` — 4 tests.
- `packages/application/src/use-cases/document/document-format.ts` — format →
  MIME/extension mapping shared by the generate and update use cases.
- `apps/web/e2e/phase-spreadsheet-templates.spec.ts` — e2e: header-mode chip on
  upload + a rejected upload surfacing its error.

## Files modified

- `packages/domain/src/entities/flow-node.ts` — added `documentTemplateFormat`
  and `spreadsheetTemplateMode` to `ConversationalNodeConfig`.
- `packages/domain/src/ports/document-generator.ts` — renamed the port's
  `GenerateDocx{Input,Output}` → `Generate{Input,Output}` and the output field
  `docxBytes` → `bytes` (an xlsx renderer behind the port must not return a
  docx-named field). Updated `DocxGenerator` and all consumers/tests.
- `packages/application/src/use-cases/document/generate-document.ts` &
  `update-document-fields.ts` — select the stored MIME type and file extension
  by `documentTemplateFormat`; revision paths preserve the existing extension.
- `apps/web/src/app/api/flows/[id]/nodes/[nodeId]/template/route.ts` — accept
  `.xlsx`, branch extraction/validation by format, persist format + mode, store
  with the format's MIME type; DELETE clears the new fields.
- `apps/web/src/lib/container.ts` — wired `DocumentGeneratorRouter` into the
  document use cases and `EvaluateStepReadiness` (context-doc extraction stays
  on `DocxGenerator`).
- `apps/web/src/components/canvas/node-config-modal.tsx`,
  `node-config-modal-conversational.tsx`,
  `apps/web/src/app/(user)/flows/[id]/config/_content.tsx` — accept `.xlsx` in
  the picker, show the detected mode, and round-trip format + mode through
  upload/save.
- Existing e2e specs updated for the widened file `accept` attribute.

## Deviation from the phase plan

The phase's step 1 proposed extending `ISpreadsheetParser` with the tag scan +
header read. That port serves HR datasets (columns/rows); adding template-tag
concerns there would be unused surface and mix responsibilities. ADR-039 §3 also
places extraction "behind the existing `IDocumentGenerator` port". The all-cell
tag scan and header read were therefore implemented inside `XlsxGenerator`
(full `IDocumentGenerator` parity with `DocxGenerator`), and `ISpreadsheetParser`
was left untouched.

## Migrations run

None. Format + mode ride the existing `app_flow_nodes.config` jsonb; generated
files use existing document storage.

## Tests

- Adapter unit tests: `xlsx-generator` (17), `document-generator-router` (4).
- Application unit tests: added xlsx cases to `generate-document` and
  `update-document-fields` (filename extension + MIME type).
- The port rename (`docxBytes` → `bytes`) was propagated through all existing
  docx/generation tests.
- e2e (`phase-spreadsheet-templates.spec.ts`): header-mode detection hint and a
  rejected upload. The e2e suite runs in CI (Playwright + Postgres/Redis/MinIO
  are provisioned there); it is not runnable in the code sandbox, so it was
  authored to mirror the existing, passing template-upload specs.

## Known limitations

- Multi-row / batch execution is out of scope (PRD §11) — one session fills one
  sheet.
- Formula/chart recalculation is not guaranteed; only cell values are written.
- Styling on in-place fill is best-effort (the cell's style reference is kept;
  the value is rewritten as an inline string).
- The all-workbook tag scan is bounded at `MAX_TEMPLATE_CELLS` (200,000);
  larger workbooks are rejected with a clear message.
