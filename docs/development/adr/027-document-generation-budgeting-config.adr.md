# ADR-027 — Document Generation Budgeting Configuration

- **Status**: Proposed (scoped by `document-generation-settings.prd.md`)
- **Date**: 2026-06-23

## Context

v1.49.0 stopped document generation overflowing the model context window by
budgeting and batching the generation prompt. Three values control this, all
currently module-level constants:

1. **`CONTEXT_DOCS_CHAR_BUDGET`** (`packages/application/src/use-cases/document/structured-fields.ts`)
   — the hard cap on combined flow-context-document text injected into one call.
2. **`MAX_PROMPT_TOKENS`** (same file) — the pre-flight ceiling above which a
   batch returns a clear `VALIDATION_FAILED` instead of calling the model.
3. **`FIELD_BATCH_SIZE`** (`packages/application/src/use-cases/document/generate-document.ts`)
   — how many template fields are gathered per model call.

The correct values depend on the deployment's configured model (context-window
size) and document corpus, which only the administrator knows. They cannot be
tuned without a code change. `document-generation-settings.prd.md` asks for an
admin screen to set them at runtime, with the budget expressible either as an
explicit token cap or as a percentage of the model's context window.

This forces three decisions: **where the config is read**, **how the two budget
modes resolve to a concrete token budget**, and **how the model's context window
is determined for percentage mode**.

Constraints:

1. **No schema change.** Runtime config already rides on `system_settings`
   key/value rows (`session_upload_config`, `ai_config`, etc.) via
   `RuntimeConfigStore` with per-key caching and `invalidate*()`.
2. **Architecture rules.** `packages/application` may not read settings or know
   about HTTP/DB; it receives data through ports. The prompt-building agent
   (`packages/adapters`) stays a pure builder.
3. **Backwards compatible.** With no setting saved, behaviour must equal v1.49.0
   — so the constants become the defaults.

## Decision

### 1. Read the config at the generation boundary, not in the builder

`GenerateDocument` (application use-case) is constructed by the container, which
can supply runtime config. The use-case resolves a concrete
`{ contextBudgetChars, fieldBatchSize, maxPromptTokens }` once per generation and
passes the values down into `extractStructuredFields` /
`buildContextDocsSection` as parameters (those already accept a `maxChars`
argument). The functions stay pure; no use-case reaches for settings directly.

Wiring: the chat-stream `generateDocument` wrapper (and any other caller) fetches
`runtimeConfig.getDocumentGenerationConfig()` and hands the resolved values to the
use-case, mirroring how `organisation_name` / session-upload config are fetched
at the edge and threaded in.

### 2. Two budget modes resolve to one token budget

`DocumentGenerationConfig.contextBudgetMode` is `"tokens"` or `"model_percent"`.

- **`tokens`** — `contextBudgetTokens` is used directly.
- **`model_percent`** — the resolved budget is
  `floor(modelContextWindow × contextBudgetPercent / 100)`, where the remaining
  window is implicitly reserved for the template field-constraints, transcript,
  and the model's structured output.

Both then convert to a character budget for `buildContextDocsSection` using the
existing `CHARS_PER_TOKEN` heuristic. `maxPromptTokens` is kept as an explicit
token ceiling regardless of mode (the graceful-failure guard); in
`model_percent` mode its default is derived as a high fraction of the window.

### 3. Model context window comes from a provider/model lookup with a safe fallback

Add a small, data-only map of `{ provider → { modelId → contextWindowTokens } }`
(adapters layer, alongside the existing model defaults) plus a conservative
`DEFAULT_CONTEXT_WINDOW_TOKENS`. The runtime store resolves the active model from
`ai_config` and looks up its window; an unknown model falls back to the default
and the admin card labels the figure as estimated. Percentage mode therefore
always yields a number, and explicit mode never needs the lookup.

### 4. Validation and fallback

`settings.setDocumentGenerationConfig` validates ranges (positive integers;
percent in 1–100; batch size ≥ 1) and rejects bad input with a clear message.
`parseDocumentGenerationConfig` in the store falls back field-by-field to defaults
for any missing/invalid stored value, so a corrupt row degrades to safe defaults
rather than failing generation — consistent with `parseSessionUploadConfig`.

## Consequences

- **Positive.** Operators tune generation for their model/corpus without a
  redeploy; switching models can be absorbed by percentage mode; defaults keep
  existing deployments byte-for-byte unchanged; the change reuses the established
  runtime-config + settings-card pattern end to end.
- **Negative / cost.** A provider/model → context-window map must be maintained
  as new models appear (mitigated by the safe fallback). Token budgeting remains
  heuristic (char/token ratio), so percentage mode is approximate, not exact.
- **Follow-on.** Per-flow overrides and auto-tuning batch size from observed
  usage are deliberately deferred (see PRD §11).

## Alternatives considered

- **Keep constants, document them.** Rejected — the whole point is runtime
  tunability per deployment/model.
- **Read config inside `extractStructuredFields`.** Rejected — pushes settings
  access into a pure application helper used by auto-node and scheduling paths,
  violating the boundary and surprising those callers.
- **Percentage mode only (always derive from the model).** Rejected — admins
  asked for either; explicit caps are predictable and don't depend on the
  context-window lookup being correct.
