import { EMBEDDINGS_PROVIDERS, type EmbeddingsProvider } from "@rbrasier/shared";

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
