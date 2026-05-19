# ADR-009 — Document Generation: docx-js + Markdown Templates (MVP)

- **Status**: Accepted
- **Date**: 2026-05-19

## Context

Wayfinder generates compliance documents (Request for Tender, Evaluation
Report, Contract Management Plan, …) at the end of certain steps. The
constraints:

- Output must be **editable** by procurement officers downstream → DOCX, not
  PDF.
- Generation must happen **server-side** — the AI key never reaches the
  browser.
- A document is a function of `(node.config.document_template_markdown,
  sessionMessages, flowContextDocs)` — pure inputs, no external state.
- Filenames must be predictable for filing in agency document stores.

The template stack already includes Vercel AI SDK and Anthropic. It does
not include a DOCX library.

## Decision

Adopt **`docx`** (npm `docx`, "docx-js") as the DOCX rendering library.

### Pipeline

1. Step completes (confidence ≥ 90 and `readyToAdvance === true`, and the
   node has `output_type = 'generate_document'`).
2. The `DocumentGenerationService` (`packages/adapters/src/documents/docx-generator.ts`)
   calls `ILanguageModel.generateText` with:
   - **system prompt** = `node.config.document_template_markdown`
   - **user content** = compact session transcript + flow context docs
3. The model returns structured Markdown (headings, paragraphs, bullets).
4. The adapter parses the Markdown using a small built-in converter
   (`markdown → docx.Document`) supporting: H1–H3, paragraphs, bullets,
   numbered lists, bold, italic. **Tables are not supported at MVP**; templates
   in Phase 3 avoid them.
5. `Packer.toBuffer(document)` produces a DOCX buffer.
6. The buffer is written to `/tmp/<sessionId>-<nodeId>-<isoDate>.docx`.
7. A row is inserted into `app_documents` with `storage_path`, `filename`,
   and an AI-generated 2-line `summary` for the chat card.
8. The chat UI re-renders to include the document card.

### Filename pattern

```
[FlowName]-[NodeName]-[SessionId]-[YYYY-MM-DD].docx
```

`FlowName` and `NodeName` are kebab-cased; `SessionId` is the full UUID
truncated to its first 8 chars for readability. Example:
`au-gov-procurement-approach-to-market-a1b2c3d4-2026-05-19.docx`.

### Download endpoint

`GET /api/documents/[documentId]` — requires authenticated session; verifies
the requesting user can read the parent session (own session, admin, or shared
viewer); streams the file from `storage_path` with `Content-Disposition`
matching the `filename`. Returns `410 Gone` with `{ error, hint: "regenerate" }`
if the file is missing on disk (server restart wiped `/tmp`).

### Why not store DOCX in Postgres `bytea` or S3 at MVP

- Postgres `bytea`: works but adds row weight to common queries; preferred
  for "small, durable" artefacts only. DOCX files can be 50 KB–500 KB.
- S3 (or any object store): introduces an infrastructure dependency that the
  template does not currently have. Phase 4+ may add a generic
  `IObjectStorage` port and swap from `/tmp`.

For MVP, `/tmp` + documented limitation ("documents are lost on server
restart — regenerate by re-completing the step") is acceptable.

### Markdown parser

A 200-line custom parser, not a full Markdown library. Reasons:

- Most full Markdown → DOCX libraries either bring a heavy CommonMark
  dependency or produce styled output we can't customise.
- We control exactly which Markdown subset our templates use; supporting only
  that subset is cheaper than supporting all of CommonMark.

The parser lives at
`packages/adapters/src/documents/markdown-to-docx.ts` and has its own test
file covering every supported construct.

## Consequences

**Positive**

- No external services. Self-contained on the API process.
- Editable output suits agency review workflows.
- Pure-function pipeline (`input → docx`) is easy to test offline.

**Negative**

- `/tmp` storage is ephemeral. Documented limitation; addressed in Phase 4+.
- No tables in v1 templates. Markdown table support is on the parser's
  roadmap (Phase 4 polish) if real templates need it.
- The custom Markdown parser is one more thing to maintain. Mitigation:
  scope strict (only what templates use), fully tested, single file.

## Tests

- Snapshot test for each seed template: feed a canned session transcript,
  assert the produced DOCX has the expected text content (extracted via
  `docx`'s own reader).
- Parser tests: every Markdown construct in isolation.
- Endpoint tests: own-session 200; another user's session 403; missing file
  410.
