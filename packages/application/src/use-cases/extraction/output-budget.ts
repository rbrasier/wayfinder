// Bounds for a structured-output call's maxTokens. Without an explicit value
// @ai-sdk/anthropic sends 4096, which a many-field reply with rationales can
// exhaust; the cut-off tool input then fails validation and the whole call is
// lost. The floor keeps small calls at that long-standing default; the ceiling
// stays within the output limit of the models an admin is likely to configure.
const MIN_OUTPUT_TOKENS = 4096;
const MAX_OUTPUT_TOKENS = 8192;

export const clampOutputBudget = (tokens: number): number =>
  Math.min(MAX_OUTPUT_TOKENS, Math.max(MIN_OUTPUT_TOKENS, Math.ceil(tokens)));
