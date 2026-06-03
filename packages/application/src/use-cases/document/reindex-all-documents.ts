import { err, ok } from "@rbrasier/domain";
import type {
  IDocumentIndexer,
  IJobRepository,
  IReindexSourceRepository,
  Result,
} from "@rbrasier/domain";

// Tracked in job_registry so the admin Jobs view records the last re-index run.
export const REINDEX_JOB_NAME = "reindex-all-documents";

export interface ReindexProgress {
  total: number;
  processed: number;
  succeeded: number;
  failed: number;
}

export interface ReindexAllDocumentsResult {
  total: number;
  succeeded: number;
  failed: number;
}

export interface ReindexAllDocumentsOptions {
  onProgress?: (progress: ReindexProgress) => void;
}

// Re-embeds every already-extracted document with the currently selected embedding
// provider. Individual document failures are counted but do not abort the run
// (ADR-017 re-embed-on-switch); only an inability to list the documents is fatal.
export class ReindexAllDocuments {
  constructor(
    private readonly source: IReindexSourceRepository,
    private readonly indexer: IDocumentIndexer,
    private readonly jobs: IJobRepository,
  ) {}

  async execute(options?: ReindexAllDocumentsOptions): Promise<Result<ReindexAllDocumentsResult>> {
    await this.jobs.register(REINDEX_JOB_NAME);

    const listResult = await this.source.listReindexableDocuments();
    if (listResult.error) {
      await this.jobs.fail(REINDEX_JOB_NAME, listResult.error.message);
      return err(listResult.error);
    }

    const documents = listResult.data;
    const total = documents.length;
    let succeeded = 0;
    let failed = 0;

    const report = options?.onProgress;
    report?.({ total, processed: 0, succeeded, failed });

    for (const document of documents) {
      const indexResult = await this.indexer.indexDocument({
        flowId: document.flowId,
        sessionId: document.sessionId,
        sourceType: document.sourceType,
        storagePath: document.storagePath,
        filename: document.filename,
        text: document.text,
      });

      if (indexResult.error) {
        failed += 1;
      } else {
        succeeded += 1;
      }
      report?.({ total, processed: succeeded + failed, succeeded, failed });
    }

    await this.jobs.ping(REINDEX_JOB_NAME);
    return ok({ total, succeeded, failed });
  }
}
