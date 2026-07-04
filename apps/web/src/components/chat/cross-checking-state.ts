// Pure resolver for the transient "Cross-checking…" badge state. The stream
// route writes a `cross-checking` message annotation with `active: true` before
// the pre-generation gate runs and `active: false` once it finishes, both onto
// the same streaming message. Presence alone is therefore not enough — the badge
// must follow the *latest* annotation so it clears the instant the gate ends,
// rather than lingering through the fail-path follow-up.

export interface CrossCheckingState {
  active: boolean;
  documents: string[];
}

export const resolveCrossCheckingState = (
  annotations: readonly unknown[] | undefined,
): CrossCheckingState => {
  let state: CrossCheckingState = { active: false, documents: [] };
  if (!annotations) return state;
  for (const annotation of annotations) {
    if (typeof annotation !== "object" || annotation === null) continue;
    const record = annotation as Record<string, unknown>;
    if (record["type"] !== "cross-checking") continue;
    const documents = Array.isArray(record["documents"])
      ? record["documents"].filter((doc): doc is string => typeof doc === "string")
      : [];
    // A missing flag means active — legacy annotations only ever signalled "on".
    state = { active: record["active"] !== false, documents };
  }
  return state;
};
