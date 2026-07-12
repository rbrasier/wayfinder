export type OutputType = "conversation_only" | "generate_document";

// Sentinel doneWhen value meaning "complete when every template field is
// gathered". Mirrors the value read by the session graph and schedulers.
export const TEMPLATE_COMPLETE_SENTINEL = "__TEMPLATE_COMPLETE__";

// Computes the `doneWhen` value after the author changes a conversational
// step's output type. Selecting "generate document" defaults completion to
// "template complete" — but only when the author has not already committed to a
// specific condition or "never done". Reverting to "conversation only" drops the
// template-complete sentinel, which is not a valid option without a template.
export function doneWhenForOutputType(
  outputType: OutputType,
  current: { doneWhen: string; neverDone: boolean },
): string {
  if (outputType === "generate_document") {
    if (current.neverDone) return current.doneWhen;
    if (current.doneWhen.trim()) return current.doneWhen;
    return TEMPLATE_COMPLETE_SENTINEL;
  }
  return current.doneWhen === TEMPLATE_COMPLETE_SENTINEL ? "" : current.doneWhen;
}
