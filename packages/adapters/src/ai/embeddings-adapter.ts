import { domainError, err, ok, type EmbeddingsConfig, type IEmbeddingsProvider, type Result } from "@rbrasier/domain";
import {
  EMBEDDINGS_DEFAULT_PROVIDER,
  EMBEDDINGS_DIMENSION,
  isEmbeddingsProvider,
  type EmbeddingsProvider,
} from "@rbrasier/shared";
import { createOpenAI } from "@ai-sdk/openai";
import { embed, type EmbeddingModel } from "ai";
import {
  LocalEmbeddingsAdapter,
  createTransformersExtractorFactory,
  type LocalModelEnvOptions,
} from "./local-embeddings-adapter";

export const DEFAULT_OPENAI_EMBEDDING_MODEL = "text-embedding-3-small";

// Wraps the Vercel AI SDK embed() call behind the IEmbeddingsProvider port. The
// concrete embedding model is injected so the provider can be swapped without
// touching this adapter.
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

// OpenAI embeddings, reduced to EMBEDDINGS_DIMENSION via the `dimensions`
// parameter so the vector column stays provider-agnostic (ADR-017).
export const createOpenAIEmbeddingsAdapter = (
  apiKey: string | null,
  modelId: string = DEFAULT_OPENAI_EMBEDDING_MODEL,
): EmbeddingsAdapter => {
  const openai = createOpenAI(apiKey ? { apiKey } : {});
  return new EmbeddingsAdapter(
    openai.textEmbeddingModel(modelId, { dimensions: EMBEDDINGS_DIMENSION }),
  );
};

export type EmbeddingsAdapterBuilders = Record<
  EmbeddingsProvider,
  (model: string) => IEmbeddingsProvider
>;

// Resolves the active embedding provider per call from runtime config so the
// /admin/settings choice takes effect without a restart. Each underlying adapter
// is built once and cached by provider+model (ADR-017 Decision 1).
export class DispatchingEmbeddingsAdapter implements IEmbeddingsProvider {
  private readonly cache = new Map<string, IEmbeddingsProvider>();

  constructor(
    private readonly getConfig: () => Promise<EmbeddingsConfig>,
    private readonly builders: EmbeddingsAdapterBuilders,
  ) {}

  async embed(text: string): Promise<Result<number[]>> {
    const config = await this.getConfig();
    const provider = isEmbeddingsProvider(config.provider)
      ? config.provider
      : EMBEDDINGS_DEFAULT_PROVIDER;
    const key = `${provider}:${config.model}`;
    let adapter = this.cache.get(key);
    if (!adapter) {
      adapter = this.builders[provider](config.model);
      this.cache.set(key, adapter);
    }
    return adapter.embed(text);
  }
}

export interface EmbeddingsProviderDeps {
  openaiApiKey: string | null;
  localEnvOptions?: LocalModelEnvOptions;
}

// Production wiring: a dispatching adapter over the local and OpenAI providers.
export const createEmbeddingsProvider = (
  getConfig: () => Promise<EmbeddingsConfig>,
  deps: EmbeddingsProviderDeps,
): IEmbeddingsProvider =>
  new DispatchingEmbeddingsAdapter(getConfig, {
    local: (model) =>
      new LocalEmbeddingsAdapter(model, createTransformersExtractorFactory(deps.localEnvOptions)),
    openai: (model) => createOpenAIEmbeddingsAdapter(deps.openaiApiKey, model),
  });
