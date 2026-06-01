import { domainError, err, ok, type IEmbeddingsProvider, type Result } from "@rbrasier/domain";
import { createOpenAI } from "@ai-sdk/openai";
import { embed, type EmbeddingModel } from "ai";

// ADR-016 Decision 2: text-embedding-3-small (1536 dims). The embedding column
// type is locked to this dimensionality at DDL time — swapping to a model with
// different dimensions requires a migration.
export const DEFAULT_EMBEDDING_MODEL = "text-embedding-3-small";

// Wraps the Vercel AI SDK embed() call behind the IEmbeddingsProvider port. The
// concrete embedding model is injected so the provider can be swapped per
// ADR-016 without touching this adapter.
export class EmbeddingsAdapter implements IEmbeddingsProvider {
  constructor(private readonly model: EmbeddingModel<string>) {}

  async embed(text: string): Promise<Result<number[]>> {
    try {
      const { embedding } = await embed({ model: this.model, value: text });
      return ok(embedding);
    } catch (cause) {
      return err(domainError("AI_PROVIDER_FAILED", "Embedding generation failed.", cause));
    }
  }
}

// Builds the production embeddings adapter over OpenAI. Embeddings always use
// OpenAI regardless of the configured chat provider (ADR-016 Decision 2), so the
// OpenAI key is required for retrieval to work.
export const createOpenAIEmbeddingsAdapter = (
  apiKey: string | null,
  modelId: string = DEFAULT_EMBEDDING_MODEL,
): EmbeddingsAdapter => {
  const openai = createOpenAI(apiKey ? { apiKey } : {});
  return new EmbeddingsAdapter(openai.textEmbeddingModel(modelId));
};
