import type { ChunkSourceType } from "./document-chunk";

// A document whose text has already been extracted and persisted, so it can be
// re-chunked and re-embedded without re-reading the original file. The stored
// extracted text is the source of truth (ADR-017 Decision 3), which is what makes
// re-embedding after an embedding-provider switch possible with no object-storage
// access. Exactly one of flowId / sessionId is non-null, matching the chunk scope.
export interface ReindexableDocument {
  flowId: string | null;
  sessionId: string | null;
  sourceType: ChunkSourceType;
  storagePath: string;
  filename: string;
  text: string;
}
