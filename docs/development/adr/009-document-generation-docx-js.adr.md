# ADR-009 — Document Generation: docxtemplater + Uploaded DOCX Templates

- **Status**: Accepted
- **Date**: 2026-05-19

## Context

Wayfinder generates compliance documents at the end of certain steps. The
constraints:

- Output must be **editable** by users downstream → DOCX, not PDF.
- Generation must happen **server-side** — the AI key never reaches the
  browser.
- A document is a function of `(uploadedTemplate, sessionMessages,
  flowContextDocs)` — pure inputs, no external state.
- Filenames must be predictable for filing in agency document stores.
- **Templates must preserve agency branding** — letterhead, headers/footers,
  table structure, styles, and fonts. A Markdown-to-DOCX converter cannot
  replicate an agency's existing template layout.

The template stack already includes Vercel AI SDK and Anthropic. It does
not include a DOCX templating library.

## Decision

Adopt **`docxtemplater`** (+ **`pizzip`** peer dependency) as the DOCX
template engine.

Flow owners upload a real `.docx` file as the document template for each
document-generating node. The template uses `{{variable_name}}` mustache-style
placeholder tags wherever the AI should fill in content. `docxtemplater`
substitutes those tags at generation time, preserving all surrounding DOCX
formatting, styles, and structure.

### Template authoring

- Template authors create a `.docx` in Word or LibreOffice.
- Placeholders are written as `{{variable_name}}` — they work anywhere Word
  accepts text: body paragraphs, table cells, headers, footers, text boxes.
- `docxtemplater` loop syntax (`{#items}...{/items}`) is available for
  repeated sections such as evaluation criteria rows.
- Template variables and their descriptions are documented by the flow owner
  in the node's AI instructions so the model knows what to populate.
- Use `snake_case` names: `{{project_name}}`, `{{evaluation_criteria}}`.
  Keep names short and descriptive — the AI receives them as JSON keys.
- A template with zero `{{}}` markers is valid; the document is returned
  unchanged (useful for cover-page templates that need no AI-filled content).

### Pipeline

1. A node with `output_type = 'generate_document'` is configured. The admin
   uploads a `.docx` template file via the node config modal (Phase 3). The
   template is stored via `IObjectStorage` (MinIO in Phase 4; local filesystem
   under `DOCUMENT_STORAGE_PATH` in Phase 3 with a documented restart-loss
   limitation). The storage path and original filename are written to the
   node's `config` jsonb as `document_template_path` and
   `document_template_filename`.
2. Step completes (confidence ≥ 90, `readyToAdvance === true`).
3. `DocumentGenerationService`
   (`packages/adapters/src/documents/docx-generator.ts`) loads the template
   bytes from `IObjectStorage`.
4. Extracts the list of `{{variable_name}}` tags from the template using
   `docxtemplater`'s dry-run inspection.
5. Calls `ILanguageModel.generateText` (not stream) with:
   - **system prompt** = `node.config.ai_instruction` (the document-generation
     instruction, which includes variable descriptions)
   - **user content** = compact session transcript + flow context docs +
     "Return a JSON object with exactly these keys: `[variable_name, ...]`"
6. The model returns structured JSON: `{ [variableName: string]: string }`.
7. `docxtemplater` fills the template with the JSON data, producing a DOCX
   buffer that exactly matches the template's formatting.
8. The buffer is written to `IObjectStorage` under
   `generated/<sessionId>/<filename>`.
9. A row is inserted into `app_documents` with `storage_path`, `filename`,
   and an AI-generated 2-line `summary` for the chat card.
10. The chat UI re-renders to include the document card.

Document generation runs **after** the milestone pill is committed, so a
generation failure does not block session advance.

### Filename pattern

```
[FlowName]-[NodeName]-[SessionId8]-[YYYY-MM-DD].docx
```

`FlowName` and `NodeName` are kebab-cased. `SessionId8` is the first 8 chars
of the UUID.

### Download endpoint

`GET /api/documents/[documentId]` — requires authenticated session; verifies
the requesting user can read the parent session (own session, admin, or shared
viewer); streams the file from `IObjectStorage` with `Content-Disposition`
matching the `filename`. Returns `410 Gone` with `{ error, hint: "regenerate" }`
if the object is missing (e.g. storage was wiped).

### Library choice: `docxtemplater` + `pizzip`

- `docxtemplater` handles template parsing and placeholder substitution.
- `pizzip` (required peer) handles the underlying DOCX ZIP manipulation.
- No custom parser to write or maintain.
- Supports all DOCX features natively: tables, headers, footers, lists,
  images (via the image module if needed later).

### Storage: `IObjectStorage` port

Introduced in Phase 4. The port (in `packages/domain`) abstracts over object
storage backends. Phase 4 ships a `MinioStorageAdapter` in
`packages/adapters/src/storage/` backed by a MinIO service in
`docker-compose.yml`. Production deployments swap MinIO for AWS S3 or
equivalent via a single env-var change.

In Phase 3 (before Phase 4), templates are stored at
`DOCUMENT_STORAGE_PATH/templates/<nodeId>/` (local filesystem, env-var
configurable, defaults to `./data/`). Generated documents are stored at
`DOCUMENT_STORAGE_PATH/generated/<sessionId>/`. This directory should be
volume-mounted in any persistent deployment; the documented limitation
("documents lost if volume unmounted") is resolved in Phase 4 with MinIO.

### Why not a Markdown-to-DOCX converter

- Agency procurement templates have fixed letterhead, headers/footers, table
  layouts, and styles. A Markdown-to-DOCX converter cannot replicate these.
- Template authors work in Word or LibreOffice; they should not need to learn
  a custom Markdown subset.
- A custom Markdown parser is one more internal surface to maintain and test.
  `docxtemplater` is a mature library (5 M weekly downloads) with its own
  test suite.

## Consequences

**Positive**

- Generated DOCX exactly matches the uploaded template's branding, styles,
  tables, and structure. No visual gap between template and output.
- No custom Markdown parser. Template maintenance is in Word/LibreOffice, not
  code.
- `docxtemplater` supports tables, headers/footers, and loops out of the box —
  no deferred "Phase 4 table support" limitation.
- Editable output suits agency review workflows.
- Pure-function pipeline (`template bytes + JSON data → docx`) is easy to
  test offline.

**Negative**

- Template authors must learn the `{{variable_name}}` syntax (minor;
  one-paragraph documentation is sufficient).
- Malformed tags in an uploaded template cause a `docxtemplater` parse error
  at generation time — mitigated by a dry-run validation on upload that
  returns a user-friendly error before saving the template.
- Phase 3 uses local filesystem storage; `/data/` directory must be
  volume-mounted for persistence. Fully resolved in Phase 4 with MinIO.

## Tests

- Unit tests for `DocxGenerator`: feed a test `.docx` template with known
  `{{variable}}` tags and a JSON payload; assert the output DOCX contains
  the substituted values (extracted via `docxtemplater`'s reader or
  `mammoth`).
- Template validation test: a template with a malformed tag (`{{unclosed`)
  returns a structured error and does not write to storage.
- Endpoint tests: own-session 200; another user's session 403; missing object
  410.
- Round-trip test: generated buffer opens cleanly — no XML errors (verified
  by `docxtemplater`'s own parser).
