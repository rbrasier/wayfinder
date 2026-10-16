// Embedding provider configuration (ADR-017). The provider and model are
// selectable per deployment via an env default and an /admin/settings control.
// Every model's vectors are zero-padded to EMBEDDINGS_DIMENSION so the
// kb_document_chunks schema stays provider-agnostic.

export const EMBEDDINGS_PROVIDERS = ["local", "openai", "mistral", "bedrock"] as const;
export type EmbeddingsProvider = (typeof EMBEDDINGS_PROVIDERS)[number];

// The stored vector column width, fixed across providers so the HNSW index never
// changes when the model does. Zero-padding a shorter vector leaves its cosine
// similarity to any other padded vector unchanged.
export const EMBEDDINGS_DIMENSION = 1024;

export const EMBEDDINGS_DEFAULT_PROVIDER: EmbeddingsProvider = "local";

export const EMBEDDINGS_PROVIDER_LABELS: Record<EmbeddingsProvider, string> = {
  local: "Local (in-process)",
  openai: "OpenAI",
  mistral: "Mistral",
  bedrock: "AWS Bedrock",
};

export interface EmbeddingsModelOption {
  readonly id: string;
  readonly label: string;
  // Requested from (or natively returned by) the provider, before padding.
  readonly nativeDimension: number;
}

// Curated per provider: each entry must be callable through the installed
// AI SDK provider and fit EMBEDDINGS_DIMENSION. OpenAI 3-small stays at 384 so
// vectors stored before the column widened keep matching without a re-index.
export const EMBEDDINGS_MODELS: Record<EmbeddingsProvider, readonly EmbeddingsModelOption[]> = {
  local: [
    { id: "onnx-community/all-MiniLM-L6-v2-ONNX", label: "all-MiniLM-L6-v2", nativeDimension: 384 },
  ],
  openai: [
    { id: "text-embedding-3-small", label: "text-embedding-3-small", nativeDimension: 384 },
    { id: "text-embedding-3-large", label: "text-embedding-3-large", nativeDimension: 1024 },
  ],
  mistral: [{ id: "mistral-embed", label: "mistral-embed", nativeDimension: 1024 }],
  bedrock: [
    {
      id: "amazon.titan-embed-text-v2:0",
      label: "Amazon Titan Text Embeddings v2",
      nativeDimension: 1024,
    },
  ],
};

export const EMBEDDINGS_DEFAULT_MODELS: Record<EmbeddingsProvider, string> = {
  local: EMBEDDINGS_MODELS.local[0]!.id,
  openai: EMBEDDINGS_MODELS.openai[0]!.id,
  mistral: EMBEDDINGS_MODELS.mistral[0]!.id,
  bedrock: EMBEDDINGS_MODELS.bedrock[0]!.id,
};

export const isEmbeddingsProvider = (value: unknown): value is EmbeddingsProvider =>
  typeof value === "string" && (EMBEDDINGS_PROVIDERS as readonly string[]).includes(value);

export const findEmbeddingsModel = (
  provider: string,
  model: string,
): EmbeddingsModelOption | undefined => {
  if (!isEmbeddingsProvider(provider)) return undefined;
  return EMBEDDINGS_MODELS[provider].find((option) => option.id === model);
};

export const isEmbeddingsModel = (provider: string, model: string): boolean =>
  findEmbeddingsModel(provider, model) !== undefined;

// Stamped on every stored chunk so a later model switch can be detected.
export const embeddingsModelKey = (config: { provider: string; model: string }): string =>
  `${config.provider}:${config.model}`;
