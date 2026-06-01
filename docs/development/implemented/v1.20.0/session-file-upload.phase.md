# Phase — Session File Upload (end-user mid-flow context)

- **Status**: Implemented in v1.20.0
- **Version bump**: **MINOR** — one new table (`app_session_uploads`), one new
  domain entity + port, new use case and route. No breaking domain change.
- **Origin**: users want to give the AI a file as context *during a flow run*
  (not just type everything), to build confidence and improve output quality.

## 1. Goal

Let the end user running a flow session upload a file mid-conversation. The
file's extracted text becomes **session-scoped context** injected into the AI
system prompt on **every subsequent turn** of that session — the same mechanism
as the existing flow-level `contextDocs`, but scoped to the session rather than
the flow.

Concretely:

1. A **paperclip** icon on the chat composer lets the user pick a file.
2. The file is stored (MinIO blob) and its text extracted (PDF/DOCX/TXT/MD) the
   moment it is attached; a removable chip shows it is ready.
3. From then on, the extracted text rides in the system prompt of every turn in
   that session, labelled distinctly from flow-author context docs.

Out of scope: images/vision, per-turn-only context, OCR of scanned PDFs.

## 2. Design

The existing flow context-doc feature is the template. It splits storage:
lightweight metadata in `app_flows.context_docs` (JSONB) and heavy
content/extraction in `kb_context_doc_content`. Sessions have no natural JSONB
metadata column, so session uploads collapse into a **single dedicated table**
holding both metadata and extracted text.

Principle: **session context mirrors flow context, scoped one level down.** The
prompt-building path already accepts a list of docs (`buildDocsBlock`); session
uploads become a second, distinctly-labelled list passed alongside.

### Storage

- **Blob**: MinIO via the existing `IObjectStorage` port, key
  `session/{sessionId}/{timestamp}-{safeFilename}`.
- **Metadata + extracted text**: new table `app_session_uploads`.

### Why a separate prompt block

Flow context docs are authored by the flow designer ("trusted reference
material"); session uploads come from the end user mid-run. Keeping them in a
separate `<session_uploads>` block (framed as "documents the user uploaded
during this conversation") preserves that provenance distinction for the model
and avoids the two budgets interfering.

### Budget & admin-configurable limits

Per-session character budget enforced at upload time (sum of existing session
uploads' extracted text + the new one), mirroring the flow `CONTEXT_DOCS_*`
budget check.

Two limits — **max file size** and **total budget chars** — are
**admin-configurable** with built-in defaults, following the existing structured
config pattern (AI provider / object storage):

- A `SessionUploadConfig` (`{ maxFileSizeBytes, totalBudgetChars }`) is stored
  under a dedicated `session_upload_config` setting key.
- `RuntimeConfigStore` parses it with defaults and caches it, exposing
  `getSessionUploadConfig()` + `invalidateSessionUpload()`.
- Defaults live as `SESSION_UPLOADS_DEFAULT_*` constants in `@rbrasier/shared`;
  if no admin value is stored, the defaults apply.
- The admin edits them via a **Session Uploads** card + modal on
  `/admin/settings` (matching the AI / Storage cards), saved through new
  `settings.getSessionUploadConfig` / `setSessionUploadConfig` tRPC procedures.
- The upload route reads limits from `runtimeConfig.getSessionUploadConfig()`,
  not from hard-coded constants.

Allowed MIME types stay a fixed constant (`SESSION_UPLOADS_ALLOWED_MIME_TYPES`),
bounded by what `IDocumentExtractor` supports — not admin-editable.

## 3. What will be built

- **Domain** (`packages/domain`):
  - `entities/session-upload.ts` — `SessionUpload` interface
    (`id`, `sessionId`, `messageId | null`, `filename`, `mimeType`, `sizeBytes`,
    `storagePath`, `extractedText | null`, `extractionStatus`, timestamps),
    reusing the existing `ExtractionStatus` type.
  - `ports/session-upload-repository.ts` — `ISessionUploadRepository`:
    `create(upload)`, `listBySession(sessionId)`.
  - `ports/session-agent.ts` — `BuildSystemPromptInput` gains
    `sessionUploads?: SessionUpload[]`.
- **Adapters** (`packages/adapters`):
  - `db/schema/wayfinder.ts` — `app_session_uploads` table + index.
  - `repositories/drizzle-session-upload-repository.ts` — implements the port.
  - `agents/flow-session-graph.ts` — render a `<session_uploads>` block when
    `sessionUploads` is non-empty (generalised from `buildDocsBlock`).
  - Drizzle migration for the new table.
- **Application** (`packages/application`):
  - `use-cases/session/add-session-upload.ts` — thin persist use case
    (mirrors `AddContextDoc`); storage + extraction orchestration stays in the
    route, consistent with the flow context-doc route.
- **Shared** (`packages/shared`):
  - `SESSION_UPLOADS_ALLOWED_MIME_TYPES` (fixed),
    `SESSION_UPLOADS_DEFAULT_MAX_FILE_SIZE_BYTES`,
    `SESSION_UPLOADS_DEFAULT_TOTAL_BUDGET_CHARS` (defaults for the configurable limits).
- **Domain** (config):
  - `SessionUploadConfig` type (`maxFileSizeBytes`, `totalBudgetChars`) and
    `SESSION_UPLOAD_CONFIG_SETTING_KEY` constant.
- **Adapters** (config):
  - `RuntimeConfigStore` gains `getSessionUploadConfig()` (parse-with-defaults +
    cache) and `invalidateSessionUpload()`.
- **Web** (`apps/web`):
  - `app/api/chat/[sessionId]/uploads/route.ts` — POST: auth → read limits via
    `runtimeConfig.getSessionUploadConfig()` → validate size/mime → extract →
    budget check → `objectStorage.put` → persist via `addSessionUpload`.
    Mirrors the flow context-doc route.
  - `app/api/chat/[sessionId]/stream/route.ts` — load session uploads and pass
    `sessionUploads` into `buildSystemPrompt`.
  - `server/routers/settings.ts` — `getSessionUploadConfig` /
    `setSessionUploadConfig` admin procedures.
  - `app/(admin)/admin/settings/page.tsx` — **Session Uploads** card + edit
    modal (max file size in MB, total budget chars).
  - `components/chat/chat-composer.tsx` — paperclip button, hidden file input,
    pending-upload chips with remove.
  - `lib/container.ts` — wire the repo + use case.
- **API parity** (`apps/api`): register the repo + use case in its container so
  DI stays symmetrical (validate.sh container check).

## 4. Files to add / modify

Add:
- `packages/domain/src/entities/session-upload.ts` (+ test)
- `packages/domain/src/ports/session-upload-repository.ts`
- `packages/adapters/src/repositories/drizzle-session-upload-repository.ts` (+ test)
- `packages/application/src/use-cases/session/add-session-upload.ts` (+ test)
- `apps/web/src/app/api/chat/[sessionId]/uploads/route.ts`

Modify:
- `packages/domain/src/ports/session-agent.ts`
- `packages/domain/src/index.ts` (exports + `SessionUploadConfig`, setting key)
- `packages/adapters/src/db/schema/wayfinder.ts`
- `packages/adapters/src/agents/flow-session-graph.ts` (+ test)
- `packages/adapters/src/config/runtime-config-store.ts` (+ test) — session-upload config
- `packages/application/src/index.ts` (exports)
- `packages/shared/src/...` (constants + index)
- `apps/web/src/app/api/chat/[sessionId]/stream/route.ts`
- `apps/web/src/server/routers/settings.ts`
- `apps/web/src/app/(admin)/admin/settings/page.tsx`
- `apps/web/src/components/chat/chat-composer.tsx`
- `apps/web/src/lib/container.ts`
- `apps/api/src/container.ts`

## 5. Migrations

- One Drizzle migration creating `app_session_uploads` (columns per §3),
  FK `session_id → app_sessions(id) ON DELETE CASCADE`, unique `storage_path`,
  index on `session_id`.

## 6. Acceptance criteria

1. A user in an active session sees a paperclip icon on the composer; selecting
   a PDF/DOCX/TXT/MD file uploads it and shows a removable chip.
2. After upload, the next AI turn's system prompt contains the file's extracted
   text inside a `<session_uploads>` block (verified by a `buildSystemPrompt`
   unit test asserting the block renders when `sessionUploads` is non-empty and
   is absent when empty).
3. A file over the configured max size, or of an unsupported MIME type, is
   rejected with a clear error and not stored.
4. Uploading a file whose extracted text would push the session over the
   configured total-budget-chars limit is rejected with a budget error.
5. The extracted text persists in `app_session_uploads` and is injected on
   **every** subsequent turn of the same session, not just the turn it was
   attached to.
6. An admin can open the **Session Uploads** card on `/admin/settings`, edit max
   file size and total budget chars, save, and the upload route enforces the new
   values on the next request; with no stored value, the documented defaults apply.
7. `./validate.sh` passes (architecture boundaries, version match, lint, tests).

## 7. Risks / notes

- **Provenance**: end-user uploads are untrusted input; the separate prompt
  block frames them as user-supplied, not authoritative reference material.
- **Budget interaction**: session-upload text adds to prompt size on every turn;
  the per-session char budget caps it. Flow `contextDocs` budget is unaffected.
- **`messageId`** is nullable and informational (which user turn the file rode
  with); context injection is purely session-scoped, so association is optional.
- **Cleanup**: `ON DELETE CASCADE` removes rows when a session is deleted; MinIO
  blobs are not garbage-collected here (same as flow context docs today).
