import type { ChunkSearchResult } from "../entities/document-chunk";
import type { Result } from "../result";

// `semantic` fuses vector similarity with full-text rank for broad discovery;
// `exact` returns only chunks containing the literal phrase, for SKUs, codes,
// and other sensitive terms (ADR-029 Decision 2).
export type RetrievalMode = "semantic" | "exact";

export type RetrievalScope = { flowId: string } | { sessionId: string };

export interface HybridRetrievalQuery {
  text: string;
  // The embedding of `text`, computed by the caller via IEmbeddingsProvider.
  // Ignored in `exact` mode. Null is permitted so an exact-only call need not embed.
  embedding: number[] | null;
  mode: RetrievalMode;
  scope: RetrievalScope;
  limit: number;
}

// Tunable score-fusion weights (ADR-029 Decision 3). They need not sum to 1.
export interface FusionWeights {
  vector: number;
  keyword: number;
}

export interface IHybridRetriever {
  retrieve(query: HybridRetrievalQuery): Promise<Result<ChunkSearchResult[]>>;
}
