import type { NewDocumentChunk, RetrievedChunk } from "../entities/document-chunk";
import type { Result } from "../result";

export interface DocumentChunkSearch {
  // Flow-scoped sources (flow_context_doc, template) are matched against flowId;
  // session uploads are matched against sessionId. Either may be null to skip
  // that scope. Results from both scopes are unioned and ranked by similarity.
  flowId: string | null;
  sessionId: string | null;
  embedding: number[];
  limit: number;
  minSimilarity: number;
}

export interface IDocumentChunkRepository {
  insertMany(chunks: NewDocumentChunk[]): Promise<Result<void>>;
  deleteByStoragePath(storagePath: string): Promise<Result<void>>;
  search(input: DocumentChunkSearch): Promise<Result<RetrievedChunk[]>>;
}
