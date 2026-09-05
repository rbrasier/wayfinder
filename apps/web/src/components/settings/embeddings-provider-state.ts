// Pure decisions for the RAG embeddings card.
//
// ADR-017 makes the embedding provider switchable at runtime. ADR-056 §4 adds
// that the switchable set is whatever the running artefact can load — a Lambda
// zip ships without the local runtime — so the server sends an availability
// list and the card renders against it rather than against a hardcoded pair.

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
