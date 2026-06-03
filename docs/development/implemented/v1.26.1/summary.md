# v1.26.1 — Re-index All Documents

**Version bump:** 1.26.0 → 1.26.1 (PATCH — no DB schema change)

## What was built

A "Re-index all documents" button in the RAG Embeddings card on `/admin/settings`,
below the embedding-provider details. Clicking it re-embeds every already-indexed
document (templates, flow context docs, session uploads) with the **currently
selected** embedding provider, so retrieval works again after a provider switch
(the gap ADR-017 Decision 3 anticipated).

Re-indexing reuses the text already extracted in the database — it never re-reads
files from object storage or re-runs extractors. Each document's stored text is fed
back through the existing `DocumentIndexingService`, which deletes the prior chunks
by `storage_path` and re-chunks + re-embeds under the live provider.

The run is asynchronous: the request kicks it off and returns immediately. Live
progress is held in an in-memory `globalThis` singleton; the UI polls every 5
seconds while running and shows a "Completed" badge (with succeeded/failed counts)
afterwards. The badge clears once the admin navigates away. Durable last-run health
is recorded in the existing `job_registry` under the job name
`reindex-all-documents`. Concurrent runs are blocked — a second click while a run is
in progress is a no-op. Individual document failures are counted but do not abort
the run.

## Files created

- `packages/domain/src/entities/reindexable-document.ts` — `ReindexableDocument`.
- `packages/domain/src/ports/document-indexer.ts` — `IDocumentIndexer` + `IndexDocumentInput`.
- `packages/domain/src/ports/reindex-source-repository.ts` — `IReindexSourceRepository`.
- `packages/application/src/use-cases/document/reindex-all-documents.ts` — `ReindexAllDocuments` use case + `REINDEX_JOB_NAME`.
- `packages/application/src/use-cases/document/reindex-all-documents.test.ts` — use-case tests.
- `packages/adapters/src/repositories/drizzle-reindex-source-repository.ts` — `DrizzleReindexSourceRepository`.
- `apps/web/src/lib/reindex-runner.ts` — in-memory run/progress singleton.
- `apps/web/src/lib/reindex-runner.test.ts` — runner tests.
- `tests/e2e/enhance-reindex-documents.spec.ts` — e2e test.

## Files modified

- `packages/domain/src/entities/index.ts`, `packages/domain/src/ports/index.ts` — barrels.
- `packages/adapters/src/extraction/document-indexing-service.ts` — now `implements IDocumentIndexer`; `IndexDocumentInput` moved to domain and re-exported. No behaviour change.
- `packages/adapters/src/repositories/index.ts` — barrel.
- `packages/application/src/use-cases/document/index.ts` — barrel.
- `apps/web/src/lib/container.ts` — wired `DrizzleReindexSourceRepository` + `ReindexAllDocuments`.
- `apps/web/src/server/routers/settings.ts` — `startReindex` mutation + `reindexStatus` query (both `adminProcedure`).
- `apps/web/src/app/(admin)/admin/settings/page.tsx` — button, in-progress text, completed/failed badges, 5s polling.
- `VERSION`, `package.json` — 1.26.0 → 1.26.1.

## Migrations run

None. No schema change — reuses existing tables and `job_registry`.

## Tests

- **Unit (`./validate.sh` — all 14 checks pass):**
  - `ReindexAllDocuments` use case: happy path, pass-through of stored text/scope,
    continue-past-failure with correct counts, progress reporting, list-failure
    (job failed + error), empty-document set.
  - `reindex-runner`: idle default, start marks running, blocks a second run,
    complete with counts, failed on error result, failed on thrown error.
- **E2e:** `tests/e2e/enhance-reindex-documents.spec.ts` — admin opens
  `/admin/settings`, clicks "Re-index all documents", and observes the run reach the
  "Completed" badge. This is the e2e that covers the new behaviour. It runs in CI
  (Playwright + Postgres/MinIO are provisioned there); it could not be executed in
  the authoring sandbox, which has no Docker daemon, database, or browser cache.

## Known limitations

- In-memory progress is per-process: accurate for the single-container deployment,
  but multi-instance deployments would not share live progress (noted for a future
  durable-state enhancement). A server restart mid-run abandons the run; the admin
  can simply click again.
- Selecting the OpenAI provider without an API key makes every document fail to
  embed; this surfaces in the failed count and error log.
