import { err, ok } from "@rbrasier/domain";
import type {
  IDocumentChunkRepository,
  IEmbeddingsProvider,
  Result,
  RetrievedChunk,
} from "@rbrasier/domain";

// Flow context docs are a curated knowledge base that can be large, so retrieval
// stays strict to surface only on-point excerpts. Session uploads are documents
// the operator deliberately attached for the current request, so they retrieve
// with a permissive threshold and a higher limit — a short attachment must reach
// the prompt even when the user's message is only loosely worded.
const DEFAULT_FLOW_LIMIT = 5;
const DEFAULT_FLOW_MIN_SIMILARITY = 0.5;
const DEFAULT_SESSION_LIMIT = 8;
const DEFAULT_SESSION_MIN_SIMILARITY = 0.2;

export interface RetrieveDocumentChunksInput {
  flowId: string | null;
  sessionId: string | null;
  query: string;
  flowLimit?: number;
  flowMinSimilarity?: number;
  sessionLimit?: number;
  sessionMinSimilarity?: number;
}

// Per-turn retrieval (phase doc §8): embed the user's latest message, then fetch
// the most similar chunks. The flow scope (context docs/templates) and the
// session scope (operator uploads) are searched separately so each can use its
// own similarity threshold and limit, then merged and ranked by similarity.
// Returns nothing for a blank query or when no scope is given so we never spend
// an embedding call on an empty turn.
export class RetrieveDocumentChunks {
  constructor(
    private readonly embeddings: IEmbeddingsProvider,
    private readonly chunks: IDocumentChunkRepository,
  ) {}

  async execute(input: RetrieveDocumentChunksInput): Promise<Result<RetrievedChunk[]>> {
    const query = input.query.trim();
    if (query.length === 0) return ok([]);
    if (!input.flowId && !input.sessionId) return ok([]);

    const embeddingResult = await this.embeddings.embed(query);
    if (embeddingResult.error) return err(embeddingResult.error);
    const embedding = embeddingResult.data;

    const retrieved: RetrievedChunk[] = [];

    if (input.flowId) {
      const flowResult = await this.chunks.search({
        flowId: input.flowId,
        sessionId: null,
        embedding,
        limit: input.flowLimit ?? DEFAULT_FLOW_LIMIT,
        minSimilarity: input.flowMinSimilarity ?? DEFAULT_FLOW_MIN_SIMILARITY,
      });
      if (flowResult.error) return err(flowResult.error);
      retrieved.push(...flowResult.data);
    }

    if (input.sessionId) {
      const sessionResult = await this.chunks.search({
        flowId: null,
        sessionId: input.sessionId,
        embedding,
        limit: input.sessionLimit ?? DEFAULT_SESSION_LIMIT,
        minSimilarity: input.sessionMinSimilarity ?? DEFAULT_SESSION_MIN_SIMILARITY,
      });
      if (sessionResult.error) return err(sessionResult.error);
      retrieved.push(...sessionResult.data);
    }

    // Lead the prompt with the strongest matches regardless of their scope.
    return ok(retrieved.sort((first, second) => second.similarity - first.similarity));
  }
}
