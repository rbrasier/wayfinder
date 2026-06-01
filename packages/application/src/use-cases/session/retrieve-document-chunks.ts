import { err, ok } from "@rbrasier/domain";
import type {
  IDocumentChunkRepository,
  IEmbeddingsProvider,
  Result,
  RetrievedChunk,
} from "@rbrasier/domain";

const DEFAULT_LIMIT = 5;
const DEFAULT_MIN_SIMILARITY = 0.5;

export interface RetrieveDocumentChunksInput {
  flowId: string | null;
  sessionId: string | null;
  query: string;
  limit?: number;
  minSimilarity?: number;
}

// Per-turn retrieval (phase doc §8): embed the user's latest message, then fetch
// the most similar chunks scoped to this flow's documents and this session's
// uploads. Returns nothing for a blank query so we never spend an embedding call
// on an empty turn.
export class RetrieveDocumentChunks {
  constructor(
    private readonly embeddings: IEmbeddingsProvider,
    private readonly chunks: IDocumentChunkRepository,
  ) {}

  async execute(input: RetrieveDocumentChunksInput): Promise<Result<RetrievedChunk[]>> {
    const query = input.query.trim();
    if (query.length === 0) return ok([]);

    const embeddingResult = await this.embeddings.embed(query);
    if (embeddingResult.error) return err(embeddingResult.error);

    return this.chunks.search({
      flowId: input.flowId,
      sessionId: input.sessionId,
      embedding: embeddingResult.data,
      limit: input.limit ?? DEFAULT_LIMIT,
      minSimilarity: input.minSimilarity ?? DEFAULT_MIN_SIMILARITY,
    });
  }
}
