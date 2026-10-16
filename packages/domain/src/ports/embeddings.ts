import type { Result } from "../result";

// A vector bound for storage, with the "provider:model" key of the model that
// produced it. Resolved in the same call so a concurrent settings change cannot
// mislabel a stored chunk (ADR-017, as amended for per-chunk model stamps).
export interface StoredEmbedding {
  vector: number[];
  model: string;
}

// Turns text into a dense vector for similarity search. Implemented by an
// adapter over the admin-selected embedding model (ADR-017). Every returned
// vector is padded to the embedding column's declared dimensionality.
export interface IEmbeddingsProvider {
  // Query-side: compared against stored vectors, never persisted.
  embed(text: string): Promise<Result<number[]>>;
  // Write-side: the vector plus the model label stored alongside it.
  embedForStorage(text: string): Promise<Result<StoredEmbedding>>;
}
