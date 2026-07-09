// Pure resolver for the transient "Generating document…" badge state. After a
// step advances, the stream route writes a `generating-document` message
// annotation with `active: true` while the document is generated and
// `active: false` once it finishes, both onto the same streaming message. The
// document generation is awaited so the next step opens only after it — the badge
// gives the operator live feedback during that wait, so it must follow the
// *latest* annotation rather than mere presence.

export interface GeneratingDocumentState {
  active: boolean;
}

export const resolveGeneratingDocumentState = (
  annotations: readonly unknown[] | undefined,
): GeneratingDocumentState => {
  let state: GeneratingDocumentState = { active: false };
  if (!annotations) return state;
  for (const annotation of annotations) {
    if (typeof annotation !== "object" || annotation === null) continue;
    const record = annotation as Record<string, unknown>;
    if (record["type"] !== "generating-document") continue;
    // A missing flag means active — matches the cross-checking convention.
    state = { active: record["active"] !== false };
  }
  return state;
};
