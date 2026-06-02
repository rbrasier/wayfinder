// Embedding provider configuration (ADR-017). The provider is selectable per
// deployment via an env default and an /admin/settings control. Both providers
// emit EMBEDDINGS_DIMENSION-sized vectors so the kb_document_chunks schema stays
// provider-agnostic.

export const EMBEDDINGS_PROVIDERS = ["local", "openai"] as const;
export type EmbeddingsProvider = (typeof EMBEDDINGS_PROVIDERS)[number];

// Fixed across providers so the vector column / HNSW index never changes when
// the provider does. Local all-MiniLM-L6-v2 is natively 384; OpenAI
// text-embedding-3-small is reduced to 384 via its `dimensions` parameter.
export const EMBEDDINGS_DIMENSION = 384;

export const EMBEDDINGS_DEFAULT_PROVIDER: EmbeddingsProvider = "local";

// Default model id per provider.
export const EMBEDDINGS_DEFAULT_MODELS: Record<EmbeddingsProvider, string> = {
  local: "onnx-community/all-MiniLM-L6-v2-ONNX",
  openai: "text-embedding-3-small",
};

export const isEmbeddingsProvider = (value: unknown): value is EmbeddingsProvider =>
  typeof value === "string" && (EMBEDDINGS_PROVIDERS as readonly string[]).includes(value);
