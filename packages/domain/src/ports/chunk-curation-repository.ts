import type { ChunkStatus, CuratedChunk } from "../entities/document-chunk";
import type { ChunkVersion } from "../entities/chunk-version";
import type { Result } from "../result";

export interface ChunkListFilter {
  flowId: string | null;
  status: ChunkStatus | null;
  tag: string | null;
  limit: number;
  offset: number;
}

// An edit to a chunk's text (ADR-028 Decision 2 + 4). The new embedding is
// computed by the application layer via IEmbeddingsProvider; the repository
// snapshots the chunk's *current* text and embedding into history before
// applying the new ones, atomically. The prior embedding never leaves the data
// layer — CuratedChunk deliberately omits it.
export interface ChunkEdit {
  chunkId: string;
  newText: string;
  newEmbedding: number[];
  editedBy: string | null;
  reason: string | null;
}

export interface ChunkRevert {
  chunkId: string;
  versionId: string;
  editedBy: string | null;
}

export interface IChunkCurationRepository {
  list(filter: ChunkListFilter): Promise<Result<CuratedChunk[]>>;
  findById(chunkId: string): Promise<Result<CuratedChunk | null>>;
  applyEdit(edit: ChunkEdit): Promise<Result<CuratedChunk>>;
  // Snapshots the current text/embedding, then restores the chosen version's
  // text and embedding onto the chunk. Nothing is destroyed.
  revert(input: ChunkRevert): Promise<Result<CuratedChunk>>;
  setStatus(chunkIds: string[], status: ChunkStatus): Promise<Result<void>>;
  addTag(chunkIds: string[], tag: string): Promise<Result<void>>;
  listVersions(chunkId: string): Promise<Result<ChunkVersion[]>>;
}
