// The three author-facing output types for a conversational step (ADR-038):
// generate a document, capture a structured record with no document, or an
// unstructured (free) conversation — the relabelled legacy `conversation_only`.
export type OutputType = "generate_document" | "structured" | "unstructured";

// Sentinel doneWhen value meaning "complete when every declared field is
// gathered". Mirrors the value read by the session graph and schedulers. Valid
// for both `generate_document` and `structured` — the two field-backed types.
export const TEMPLATE_COMPLETE_SENTINEL = "__TEMPLATE_COMPLETE__";

// Whether a given output type has a field set the "all fields captured"
// completion condition can apply to.
const isFieldBacked = (outputType: OutputType): boolean =>
  outputType === "generate_document" || outputType === "structured";

// Computes the `doneWhen` value after the author changes a conversational
// step's output type. Selecting a field-backed type (document or structured)
// defaults completion to "all fields captured" — but only when the author has
// not already committed to a specific condition or "never done". Reverting to
// an unstructured conversation drops the sentinel, which is not a valid option
// without a field set.
export function doneWhenForOutputType(
  outputType: OutputType,
  current: { doneWhen: string; neverDone: boolean },
): string {
  if (isFieldBacked(outputType)) {
    if (current.neverDone) return current.doneWhen;
    if (current.doneWhen.trim()) return current.doneWhen;
    return TEMPLATE_COMPLETE_SENTINEL;
  }
  return current.doneWhen === TEMPLATE_COMPLETE_SENTINEL ? "" : current.doneWhen;
}
