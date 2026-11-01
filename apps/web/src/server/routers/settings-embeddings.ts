import type { AiConfig, EmbeddingsConfig, IDocumentChunkRepository } from "@wayfinder/domain";
import { embeddingsCredentialsFor } from "@wayfinder/adapters";
import {
  EMBEDDINGS_PROVIDERS,
  EMBEDDINGS_PROVIDER_LABELS,
  embeddingsModelKey,
  isEmbeddingsModel,
  type EmbeddingsProvider,
} from "@wayfinder/shared";
import { toTrpcError } from "../trpc-errors";

// ADR-017 makes the embedding provider switchable at runtime; ADR-056 §4 adds
// that the switchable set is whatever the running artefact can actually load. A
// Lambda zip ships without the local runtime, so offering it there would be
// offering a choice that cannot be honoured.
export const UNAVAILABLE_LOCAL_EMBEDDINGS_REASON =
  "This deployment was packaged without the local embedding runtime, so only hosted providers can be selected.";

export interface EmbeddingsProviderOption {
  readonly provider: EmbeddingsProvider;
  readonly available: boolean;
  readonly unavailableReason: string | null;
}

export const embeddingsProviderUnavailableReason = (
  provider: EmbeddingsProvider,
  localAvailable: boolean,
): string | null => {
  if (provider !== "local") return null;
  if (localAvailable) return null;
  return UNAVAILABLE_LOCAL_EMBEDDINGS_REASON;
};

export const embeddingsProviderOptions = (localAvailable: boolean): EmbeddingsProviderOption[] =>
  EMBEDDINGS_PROVIDERS.map((provider) => {
    const unavailableReason = embeddingsProviderUnavailableReason(provider, localAvailable);
    return { provider, available: unavailableReason === null, unavailableReason };
  });

// The catalogue is the guard: the adapter can only build models it lists.
export const embeddingsModelRejection = (
  provider: EmbeddingsProvider,
  model: string,
): string | null => {
  if (isEmbeddingsModel(provider, model)) return null;
  return `"${model}" is not an available ${EMBEDDINGS_PROVIDER_LABELS[provider]} embedding model.`;
};

export type EmbeddingsKeyStatus = "not-needed" | "configured" | "missing";

// Embeddings read the same keys as the language models (AI provider settings,
// env-backed), so the card reports on those rather than asking for its own.
export const embeddingsKeyStatus = (
  provider: EmbeddingsProvider,
  aiConfig: AiConfig,
): EmbeddingsKeyStatus => {
  if (provider === "local") return "not-needed";
  return embeddingsCredentialsFor(provider, aiConfig) ? "configured" : "missing";
};

interface StaleEmbeddingsSource {
  runtimeConfig: { getEmbeddingsConfig(): Promise<EmbeddingsConfig> };
  repos: { documentChunks: Pick<IDocumentChunkRepository, "countDocumentsEmbeddedWithOtherModel"> };
}

// Documents whose stored vectors came from a model other than the configured
// one: they will not match queries until re-indexed.
export const countStaleEmbeddedDocuments = async (container: StaleEmbeddingsSource): Promise<number> => {
  const config = await container.runtimeConfig.getEmbeddingsConfig();
  const result = await container.repos.documentChunks.countDocumentsEmbeddedWithOtherModel(
    embeddingsModelKey(config),
  );
  if (result.error) throw toTrpcError(result.error);
  return result.data;
};
