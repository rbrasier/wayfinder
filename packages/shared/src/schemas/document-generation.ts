// Defaults for the admin-configurable document-generation budgets. If no value
// is stored in admin settings, these apply — chosen to equal the hardcoded
// v1.49.0 constants so behaviour is unchanged until an admin edits anything.
//
// Token figures convert to the character budget the generation prompt builder
// consumes via DOCUMENT_GENERATION_CHARS_PER_TOKEN (e.g. 100k tokens × 4 =
// 400k chars, matching the former CONTEXT_DOCS_CHAR_BUDGET).
export const DOCUMENT_GENERATION_DEFAULT_CONTEXT_BUDGET_TOKENS = 100_000;
export const DOCUMENT_GENERATION_DEFAULT_CONTEXT_BUDGET_PERCENT = 50;
export const DOCUMENT_GENERATION_DEFAULT_FIELD_BATCH_SIZE = 12;
export const DOCUMENT_GENERATION_DEFAULT_MAX_PROMPT_TOKENS = 180_000;

// Rough char-per-token ratio for English prose, used only to keep prompts under
// the model context window — conservative, not exact. Mirrors the application's
// own estimate so a token budget converts to the same character budget.
export const DOCUMENT_GENERATION_CHARS_PER_TOKEN = 4;

// Fallback context window for percentage-mode budgeting when the configured
// model is not in the known-models map. Conservative so an unknown model is
// less likely to overflow; the admin card flags this figure as estimated.
export const DOCUMENT_GENERATION_DEFAULT_CONTEXT_WINDOW_TOKENS = 128_000;
