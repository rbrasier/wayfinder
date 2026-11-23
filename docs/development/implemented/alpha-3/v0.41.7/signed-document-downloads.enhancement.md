# Enhancement — Signed document downloads (v0.41.7)

- **Source**: maintainer request on PR #390 (issue #386)
- **Base**: `release/alpha-3`, on `claude/issue-386-triage-9qb2ii`
- **Version**: PATCH 0.41.6 → 0.41.7

## Approved change summary

The Signatures panel loses its CSV and JSON buttons, so only the list of
signatures and Re-check remain. On a document card that has a PDF, the PDF is
the main (left, wide) download and the original file is a smaller "↓ DOCX"
button beside it. Cards without a PDF keep their single "↓ Download" button.

### Business rules
- **Download order:** when a document has a current PDF (not superseded, not
  failed), the primary download is the PDF and the secondary is the original
  file, labelled by its extension. Without a PDF the original is the only
  download, labelled "↓ Download".
- **Signature export:** not offered in the Signatures panel.

## Implementation

- `apps/web/src/components/chat/document-card-state.ts`: `downloadOptions`
  decides which download buttons show and in which order.
- `apps/web/src/components/chat/document-card.tsx`: renders those buttons; the
  original file's button is `document-download-original`.
- `apps/web/src/components/signatures/signatures-panel.tsx`: CSV/JSON buttons
  and their client code removed.
- `apps/web/src/server/routers/signatures.ts`: `exportMetadata` kept, with a
  note on why.
- `docs/guides/document-signatures.md` updated.

## Tests

- **Unit:** `document-card-state.test.ts` — PDF first for frozen and rendered
  PDFs, original alone without one, no PDF when failed or superseded.
- **E2E:** `document-signatures.spec.ts` (policy group 3, file download) now
  also checks the "↓ DOCX" button beside the PDF download. Runs in CI.

## Deviations

- The server-side signature export (`signatures.exportMetadata`, its use case
  and CSV writer) is kept although nothing in the UI calls it, against the
  "no dead code" rule: the PRD lists it as an audit feature. Approved in the
  change summary.
- No separate phase doc or `/doc-review` pass: a two-component UI change made
  on the PR branch, recorded here instead.
