# Phase: Re-index All Documents

**Version bump:** 1.26.0 → 1.26.1 (PATCH — no DB schema change)

## Problem

Changing the embedding provider in `/admin/settings` ("Edit embedding provider")
re-points new uploads at a different model, but every previously-indexed chunk in
`kb_document_chunks` keeps the vector produced by the old model. Mixed-provider
vectors are not comparable, so retrieval silently degrades until each document is
re-uploaded one at a time. The existing dialog even warns the admin that documents
"will not match queries until each document is re-uploaded or re-indexed" — but
there is no way to actually re-index.

We need a single admin action that re-indexes **all** indexed documents with the
**currently selected** embedding provider.

## Solution

Add a "Re-index all documents" button beside the existing "Edit" control in the
`RagEmbeddings` card on `/admin/settings`.

Re-indexing reuses the text already extracted and stored in the database — it does
**not** re-read files from object storage or re-run extractors. For every indexed
document we feed its stored extracted text back through the existing
`DocumentIndexingService.indexDocument(...)`, which already deletes prior chunks by
`storage_path` and re-chunks + re-embeds using the live provider (resolved at call
time via `RuntimeConfigStore.getEmbeddingsConfig()`, already invalidated when the
provider is saved).

Source of stored text per chunk source type:

| `source_type`      | Table / column |
| ------------------ | -------------- |
| `flow_context_doc` | `kb_context_doc_content.extracted_text` (filename from `app_flows.context_docs`) |
| `template`         | `app_flow_nodes.config.documentTemplateContent` (path/filename from same config) |
| `session_upload`   | `app_session_uploads.extracted_text` |

The run is **asynchronous**: the request kicks off the work without awaiting it and
returns immediately. Live progress is held in an in-memory singleton on
`globalThis` (the same pattern as the container). The durable last-run health is
recorded in the existing `job_registry` table under the job name
`reindex-all-documents`. The UI polls a status endpoint every 5 seconds while a run
is in progress and shows a "Completed" badge afterwards.

### Decisions

1. **Reuse stored extracted text** — no object-storage reads, no extractor re-runs.
   The chunker still strips `{{ placeholders }}` for `template` sources, identical
   to first-time indexing.
2. **Continue past per-document failures** — a single document that fails to embed
   is logged and counted as failed; the run continues. The run reports
   `{ total, succeeded, failed }`. The job is marked healthy when the run completes;
   only a fatal failure to *list* sources marks the job failed.
3. **Block concurrent runs** — if a run is already in progress, the start endpoint
   is a no-op that returns the in-progress status, and the button is disabled.
4. **No schema change** — "running" is in-memory only. `job_registry` (existing)
   captures durable last-run timestamp/health. This keeps the change PATCH-level.
5. **Completed badge clears on navigation** — the card records its mount time and
   only renders the completed badge when the run's `finishedAt` is after that mount
   time, so navigating away and back does not re-surface a stale badge.

## Scope

### Domain (`packages/domain`)

- New entity `ReindexableDocument`:
  ```typescript
  export interface ReindexableDocument {
    flowId: string | null;
    sessionId: string | null;
    sourceType: ChunkSourceType;
    storagePath: string;
    filename: string;
    text: string;
  }
  ```
- New port `IReindexSourceRepository`:
  ```typescript
  export interface IReindexSourceRepository {
    listReindexableDocuments(): Promise<Result<ReindexableDocument[]>>;
  }
  ```
- New port `IDocumentIndexer` (so the application layer can call the indexer without
  importing adapters):
  ```typescript
  export interface IndexDocumentInput {
    flowId: string | null;
    sessionId: string | null;
    sourceType: ChunkSourceType;
    storagePath: string;
    filename: string;
    text: string;
  }
  export interface IDocumentIndexer {
    indexDocument(input: IndexDocumentInput): Promise<Result<{ chunkCount: number }>>;
  }
  ```

### Application (`packages/application`)

- New use case `ReindexAllDocuments`:
  - Dependencies: `IReindexSourceRepository`, `IDocumentIndexer`, `IJobRepository`,
    and an optional `onProgress(progress)` callback.
  - Flow: `register("reindex-all-documents")` → list documents (on list error,
    `fail(...)` the job and return the error) → for each document call
    `indexer.indexDocument(...)`, incrementing `succeeded`/`failed`, calling
    `onProgress` after each → on completion `ping("reindex-all-documents")` →
    return `{ total, succeeded, failed }`.
  - Per-document indexer errors are caught, counted as `failed`, and do not abort.
- **Test written first**: in-memory fakes for all three ports. Covers happy path
  (all succeed, job pinged, progress reported), partial failure (one document
  fails, run continues, counts correct), and list failure (job failed, error
  returned).

### Adapters (`packages/adapters`)

- `DrizzleReindexSourceRepository implements IReindexSourceRepository` — three
  queries (`kb_context_doc_content` joined to `app_flows.context_docs` for filename;
  `app_flow_nodes` filtered to those with a `documentTemplatePath`;
  `app_session_uploads` with non-empty `extracted_text`), unioned in memory.
  Rows with empty/null extracted text are skipped.
- `DocumentIndexingService implements IDocumentIndexer` — signature already matches;
  add the `implements` clause only, no behaviour change.

### Web (`apps/web`)

- `lib/reindex-runner.ts` — `globalThis`-backed singleton:
  - `start(container): { started: boolean; status }` — no-op when already running.
    Kicks off `ReindexAllDocuments.execute({ onProgress })` un-awaited, wiring the
    progress callback into the in-memory state; sets `complete`/`failed` on settle.
  - `getStatus(): ReindexStatus` — `{ status: "idle" | "running" | "complete" |
    "failed", total, processed, succeeded, failed, startedAt, finishedAt, error }`.
- `lib/container.ts` — construct `DrizzleReindexSourceRepository` and the
  `ReindexAllDocuments` use case; expose them on the container.
- tRPC `settings` router — two new admin procedures:
  - `startReindex` (mutation) → `reindexRunner.start(container)`.
  - `reindexStatus` (query) → `reindexRunner.getStatus()`.
- `RagEmbeddings` card (`app/(admin)/admin/settings/page.tsx`) — add the
  "Re-index all documents" button, in-progress text (`processed / total`), and the
  completed badge. Poll `reindexStatus` with `refetchInterval` of 5000 ms while the
  status is `running`; disable the button while running.

### DB

- **No schema change.** Uses existing `job_registry` and existing tables.

## API / UI changes

- New tRPC procedures `settings.startReindex` and `settings.reindexStatus` (both
  `adminProcedure`).
- New button + progress/badge UI in the RAG Embeddings settings card.

## Tests

- `packages/application` — `reindex-all-documents.test.ts` (write-first; in-memory
  fakes): happy path, partial-failure path, list-failure path.
- `packages/adapters` — `DrizzleReindexSourceRepository` covered by the application
  use-case tests through its port; the thin `implements` change on
  `DocumentIndexingService` is covered by its existing test.
- `apps/web` — `settings.test.ts` extended for `startReindex` (starts a run, blocks
  while running) and `reindexStatus` (reports progress); `reindex-runner` unit test
  for the singleton transitions.
- E2e: `tests/e2e/enhance-reindex-documents.spec.ts` — admin opens
  `/admin/settings`, clicks "Re-index all documents", observes the in-progress
  state, then the completed badge. (Repo convention places e2e under `tests/e2e/`,
  not `apps/web/e2e/`.)

## Acceptance Criteria

- A "Re-index all documents" button appears in the RAG Embeddings card on
  `/admin/settings`.
- Clicking it re-indexes every `flow_context_doc`, `template`, and `session_upload`
  document using the currently selected embedding provider, reusing stored extracted
  text.
- While running, the UI shows in-progress state and polls every 5 s; the button is
  disabled and a second click does not start an overlapping run.
- On completion the UI shows a "Completed" badge with the succeeded/failed counts;
  the badge clears once the admin navigates away.
- The `reindex-all-documents` entry in `job_registry` records the run.
- A single document failing to re-embed does not abort the run; it is counted as
  failed.
- `./validate.sh` passes.

## Risks

- **Long runs / many chunks** — re-embedding is sequential and, with the local
  provider, CPU-bound. For large corpora a run may take minutes. Mitigated by the
  async fire-and-forget design + polling; the request never blocks. A server restart
  mid-run abandons the run (in-memory state lost) — acceptable; the admin can simply
  click again.
- **In-memory progress is per-process** — accurate for this single-container
  deployment. Multi-instance deployments would not share live progress; out of scope
  here and noted for a future durable-state enhancement.
- **OpenAI provider selected without an API key** — embeds will fail and every
  document is counted as failed. This surfaces in the failed count and error log;
  the existing dialog already warns that OpenAI requires a key.
