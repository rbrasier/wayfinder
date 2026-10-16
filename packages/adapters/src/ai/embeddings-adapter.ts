import {
  domainError,
  err,
  ok,
  type AiConfig,
  type BedrockCredentials,
  type EmbeddingsConfig,
  type IEmbeddingsProvider,
  type Result,
  type StoredEmbedding,
} from "@wayfinder/domain";
import {
  EMBEDDINGS_DEFAULT_PROVIDER,
  EMBEDDINGS_DIMENSION,
  EMBEDDINGS_MODELS,
  embeddingsModelKey,
  findEmbeddingsModel,
  isEmbeddingsProvider,
  type EmbeddingsModelOption,
  type EmbeddingsProvider,
} from "@wayfinder/shared";
import { createAmazonBedrock } from "@ai-sdk/amazon-bedrock";
import { createMistral } from "@ai-sdk/mistral";
import { createOpenAI } from "@ai-sdk/openai";
import { embed, type EmbeddingModel } from "ai";
import {
  LocalEmbeddingsAdapter,
  createTransformersExtractorFactory,
  isLocalEmbeddingsAvailable,
  type LocalModelEnvOptions,
} from "./local-embeddings-adapter";

// Re-exported deliberately: the admin settings router needs the probe to decide
// which providers it may offer, and this module is what `ai/index` publishes.
export { isLocalEmbeddingsAvailable } from "./local-embeddings-adapter";

// One model's raw output, before the dispatcher checks its width and pads it.
export type TextEmbedder = Pick<IEmbeddingsProvider, "embed">;

// Wraps the Vercel AI SDK embed() call. The concrete embedding model is injected
// so the provider can be swapped without touching this adapter.
export class EmbeddingsAdapter implements TextEmbedder {
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

// The same credentials the language models use (AiConfig.apiKeys), which already
// fall back to the env vars, so a key saved in Admin → Settings reaches both.
export type EmbeddingsCredentials = string | BedrockCredentials | null;

export const embeddingsCredentialsFor = (
  provider: EmbeddingsProvider,
  aiConfig: AiConfig,
): EmbeddingsCredentials => {
  if (provider === "local") return null;
  return aiConfig.apiKeys[provider];
};

const PROVIDERS_REQUIRING_API_KEY: Partial<Record<EmbeddingsProvider, string>> = {
  openai: "OpenAI",
  mistral: "Mistral",
};

export type EmbeddingsAdapterBuilders = Record<
  EmbeddingsProvider,
  (model: EmbeddingsModelOption, credentials: EmbeddingsCredentials) => TextEmbedder
>;

// Whether the running artefact can load each provider at all. A provider with no
// entry is treated as available, so wiring that predates ADR-056 is unaffected.
export type EmbeddingsAvailabilityChecks = Partial<Record<EmbeddingsProvider, () => boolean>>;

export interface DispatchingEmbeddingsAdapterOptions {
  getConfig: () => Promise<EmbeddingsConfig>;
  getCredentials: (provider: EmbeddingsProvider) => Promise<EmbeddingsCredentials>;
  builders: EmbeddingsAdapterBuilders;
  availability?: EmbeddingsAvailabilityChecks;
}

interface CachedEmbedder {
  credentialsFingerprint: string;
  embedder: TextEmbedder;
}

interface ResolvedEmbedder {
  embedder: TextEmbedder;
  model: EmbeddingsModelOption;
  modelKey: string;
}

const padToColumnWidth = (vector: number[]): number[] =>
  vector.length === EMBEDDINGS_DIMENSION
    ? vector
    : [...vector, ...new Array<number>(EMBEDDINGS_DIMENSION - vector.length).fill(0)];

// Resolves the active embedding model and its credentials per call from runtime
// config, so an /admin/settings change takes effect without a restart. Each
// underlying adapter is cached by provider+model and rebuilt when its
// credentials change (ADR-017 Decision 1). Every vector leaves padded to the
// stored column width; zero-padding leaves cosine similarity unchanged.
export class DispatchingEmbeddingsAdapter implements IEmbeddingsProvider {
  private readonly cache = new Map<string, CachedEmbedder>();

  constructor(private readonly options: DispatchingEmbeddingsAdapterOptions) {}

  async embed(text: string): Promise<Result<number[]>> {
    const stored = await this.embedForStorage(text);
    if (stored.error) return err(stored.error);
    return ok(stored.data.vector);
  }

  async embedForStorage(text: string): Promise<Result<StoredEmbedding>> {
    const resolved = await this.resolve();
    if (resolved.error) return err(resolved.error);

    const { embedder, model, modelKey } = resolved.data;
    const embedded = await embedder.embed(text);
    if (embedded.error) return err(embedded.error);

    if (embedded.data.length !== model.nativeDimension) {
      return err(
        domainError(
          "AI_PROVIDER_FAILED",
          `Embedding model "${model.id}" returned ${embedded.data.length} dimensions; expected ${model.nativeDimension}.`,
        ),
      );
    }
    return ok({ vector: padToColumnWidth(embedded.data), model: modelKey });
  }

  private async resolve(): Promise<Result<ResolvedEmbedder>> {
    const config = await this.options.getConfig();
    const provider = isEmbeddingsProvider(config.provider)
      ? config.provider
      : EMBEDDINGS_DEFAULT_PROVIDER;

    // Without this the failure is a module-not-found thrown from a lazy import
    // deep inside the pipeline, which reads as a bug rather than as a
    // deployment that was never packaged for this provider (ADR-056 §4).
    if (this.options.availability?.[provider]?.() === false) {
      return err(
        domainError(
          "INFRA_FAILURE",
          `The "${provider}" embedding provider is not available in this deployment. Select a hosted provider such as "openai" in Admin → Settings, then re-index.`,
        ),
      );
    }

    const credentials = await this.options.getCredentials(provider);
    const providerLabel = PROVIDERS_REQUIRING_API_KEY[provider];
    if (providerLabel && !credentials) {
      return err(
        domainError(
          "AI_PROVIDER_FAILED",
          `No ${providerLabel} API key configured. Add one under AI provider in Admin → Settings.`,
        ),
      );
    }

    const model = findEmbeddingsModel(provider, config.model) ?? EMBEDDINGS_MODELS[provider][0]!;
    const modelKey = embeddingsModelKey({ provider, model: model.id });
    const credentialsFingerprint = JSON.stringify(credentials);
    const cached = this.cache.get(modelKey);
    if (cached && cached.credentialsFingerprint === credentialsFingerprint) {
      return ok({ embedder: cached.embedder, model, modelKey });
    }

    const embedder = this.options.builders[provider](model, credentials);
    this.cache.set(modelKey, { credentialsFingerprint, embedder });
    return ok({ embedder, model, modelKey });
  }
}

const apiKeyOf = (credentials: EmbeddingsCredentials): string | undefined =>
  typeof credentials === "string" ? credentials : undefined;

const bedrockSettingsOf = (credentials: EmbeddingsCredentials): Partial<BedrockCredentials> =>
  credentials !== null && typeof credentials === "object" ? credentials : {};

// Titan v2 accepts 256, 512 or 1024; the catalogue offers it at 1024.
const TITAN_EMBEDDING_DIMENSION = 1024;

export interface EmbeddingsProviderDeps {
  getAiConfig: () => Promise<AiConfig>;
  localEnvOptions?: LocalModelEnvOptions;
}

// Production wiring: a dispatching adapter over every catalogue provider.
export const createEmbeddingsProvider = (
  getConfig: () => Promise<EmbeddingsConfig>,
  deps: EmbeddingsProviderDeps,
): IEmbeddingsProvider =>
  new DispatchingEmbeddingsAdapter({
    getConfig,
    getCredentials: async (provider) => embeddingsCredentialsFor(provider, await deps.getAiConfig()),
    builders: {
      local: (model) =>
        new LocalEmbeddingsAdapter(model.id, createTransformersExtractorFactory(deps.localEnvOptions)),
      // OpenAI's text-embedding-3 models shorten natively via `dimensions`.
      openai: (model, credentials) =>
        new EmbeddingsAdapter(
          createOpenAI({ apiKey: apiKeyOf(credentials) }).textEmbeddingModel(model.id, {
            dimensions: model.nativeDimension,
          }),
        ),
      mistral: (model, credentials) =>
        new EmbeddingsAdapter(
          createMistral({ apiKey: apiKeyOf(credentials) }).textEmbeddingModel(model.id),
        ),
      bedrock: (model, credentials) =>
        new EmbeddingsAdapter(
          createAmazonBedrock(bedrockSettingsOf(credentials)).embedding(model.id, {
            dimensions: TITAN_EMBEDDING_DIMENSION,
          }),
        ),
    },
    availability: { local: () => isLocalEmbeddingsAvailable() },
  });
