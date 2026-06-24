// An append-only snapshot of a curated chunk's text and embedding, taken before
// an edit or revert (ADR-028 Decision 2). History is never mutated; a revert
// reads a version, snapshots the current text as a new version, then restores
// the chosen version's text and embedding onto the chunk.
export interface ChunkVersion {
  id: string;
  chunkId: string;
  chunkText: string;
  embedding: number[];
  editedBy: string | null;
  reason: string | null;
  createdAt: Date;
}

export interface NewChunkVersion {
  chunkId: string;
  chunkText: string;
  embedding: number[];
  editedBy: string | null;
  reason: string | null;
}
