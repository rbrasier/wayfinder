import type { Result } from "../result";

// Turns text into a dense vector for similarity search. Implemented by an
// adapter over the configured embedding model (see ADR-016: text-embedding-3-small,
// 1536 dimensions). The returned vector length must match the embedding column's
// declared dimensionality.
export interface IEmbeddingsProvider {
  embed(text: string): Promise<Result<number[]>>;
}
