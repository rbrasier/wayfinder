import { err, ok } from "@rbrasier/domain";
import type {
  ChunkSearchResult,
  IEmbeddingsProvider,
  IHybridRetriever,
  RetrievalMode,
  RetrievalScope,
  Result,
} from "@rbrasier/domain";

export interface SearchKnowledgeInput {
  text: string;
  mode: RetrievalMode;
  scope: RetrievalScope;
  limit?: number;
}

const DEFAULT_LIMIT = 25;

// The SME search surface (ADR-029). Semantic mode embeds the query and fuses
// vector + keyword rank; exact mode skips embedding entirely and matches the
// literal phrase. A blank query returns nothing rather than embedding an empty
// string.
export class SearchKnowledge {
  constructor(
    private readonly embeddings: IEmbeddingsProvider,
    private readonly retriever: IHybridRetriever,
  ) {}

  async execute(input: SearchKnowledgeInput): Promise<Result<ChunkSearchResult[]>> {
    const text = input.text.trim();
    if (text.length === 0) return ok([]);

    let embedding: number[] | null = null;
    if (input.mode === "semantic") {
      const embeddingResult = await this.embeddings.embed(text);
      if (embeddingResult.error) return err(embeddingResult.error);
      embedding = embeddingResult.data;
    }

    return this.retriever.retrieve({
      text,
      embedding,
      mode: input.mode,
      scope: input.scope,
      limit: input.limit ?? DEFAULT_LIMIT,
    });
  }
}
