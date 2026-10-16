// Pure decisions for the RAG embeddings card.
//
// ADR-017 makes the embedding provider switchable at runtime. ADR-056 §4 adds
// that the switchable set is whatever the running artefact can load — a Lambda
// zip ships without the local runtime — so the server sends an availability
// list and the card renders against it rather than against a hardcoded pair.

import {
  EMBEDDINGS_PROVIDER_LABELS,
  isEmbeddingsProvider,
  type EmbeddingsModelOption,
} from "@wayfinder/shared";

export interface ProviderOption {
  readonly provider: string;
  readonly available: boolean;
  readonly unavailableReason: string | null;
}

const findOption = (
  options: readonly ProviderOption[] | undefined,
  provider: string,
): ProviderOption | undefined => options?.find((option) => option.provider === provider);

// Absent options mean the query has not resolved. Treating that as "everything
// allowed" keeps the control live on first paint; the server-side guard is what
// actually rejects an impossible choice.
export const isProviderSelectable = (
  options: readonly ProviderOption[] | undefined,
  provider: string,
): boolean => findOption(options, provider)?.available !== false;

export const providerSelectionBlockedReason = (
  options: readonly ProviderOption[] | undefined,
  provider: string,
): string | null => {
  const option = findOption(options, provider);
  if (!option || option.available) return null;
  return option.unavailableReason;
};

// The stored provider can become unloadable without anyone touching the setting
// — the same database moved to a deployment packaged differently.
export const storedProviderWarning = (
  options: readonly ProviderOption[] | undefined,
  storedProvider: string,
): string | null => providerSelectionBlockedReason(options, storedProvider);

type ModelCatalogue = Readonly<Record<string, readonly EmbeddingsModelOption[]>>;

export const modelOptionsFor = (
  catalogue: ModelCatalogue | undefined,
  provider: string,
): readonly EmbeddingsModelOption[] => catalogue?.[provider] ?? [];

export const modelAfterProviderChange = (
  catalogue: ModelCatalogue | undefined,
  provider: string,
  currentModel: string,
): string => {
  const options = modelOptionsFor(catalogue, provider);
  if (options.some((option) => option.id === currentModel)) return currentModel;
  return options[0]?.id ?? currentModel;
};

export const embeddingsProviderLabel = (provider: string): string =>
  isEmbeddingsProvider(provider) ? EMBEDDINGS_PROVIDER_LABELS[provider] : provider;

// Driven by the per-chunk model stamp: documents embedded by any model other than
// the configured one will not match queries until re-indexed.
export const staleDocumentsMessage = (staleDocumentCount: number): string | null => {
  if (staleDocumentCount <= 0) return null;
  if (staleDocumentCount === 1) {
    return "1 document was embedded with a different model — re-index to search it.";
  }
  return `${staleDocumentCount} documents were embedded with a different model — re-index to search them.`;
};

export type EmbeddingsKeyStatus = "not-needed" | "configured" | "missing";

// Bedrock is the one provider whose SDK falls back to the server's AWS
// environment, so a missing saved credential is a caution there, not a failure.
export const missingKeyWarning = (provider: string, keyStatus: EmbeddingsKeyStatus): string | null => {
  if (keyStatus !== "missing") return null;
  if (provider === "bedrock") {
    return "No AWS Bedrock credentials are saved under AI provider; embedding will use the server's AWS environment if it has any.";
  }
  return `No ${embeddingsProviderLabel(provider)} API key is saved under AI provider, so embedding will fail.`;
};
