import type { ChunkSourceType } from "../entities/document-chunk";
import type { Result } from "../result";

export interface IndexDocumentInput {
  flowId: string | null;
  sessionId: string | null;
  sourceType: ChunkSourceType;
  storagePath: string;
  filename: string;
  text: string;
}

// Turns an extracted document into embedded, retrievable chunks. Re-indexing the
// same storage path replaces its existing chunks (ADR-016 Decision 4).
export interface IDocumentIndexer {
  indexDocument(input: IndexDocumentInput): Promise<Result<{ chunkCount: number }>>;
}
