# PRD — Document Generation Settings

> Routes to the Documentation Review skill before any code is written.

- **Status**: Draft
- **Date**: 2026-06-23
- **Author**: john769160
- **Target version**: 1.50.0 (bump: MINOR — new admin feature, no schema change)

## 1. Problem

The document-generation engine's safety limits — how much reference-document
context is fed into a single model call, how many template fields are gathered
per call, and the prompt-size ceiling above which a call fails gracefully — are
hardcoded constants (`CONTEXT_DOCS_CHAR_BUDGET`, `FIELD_BATCH_SIZE`,
`MAX_PROMPT_TOKENS`). They were introduced in v1.49.0 to stop large reference
sets overflowing the model context window. Because they are baked into the build,
an administrator running Wayfinder against a different model (a larger or smaller
context window, or a cheaper model where fewer calls matter) cannot tune them
without a code change and redeploy. The right values depend on the deployment's
model and document corpus, which only the operator knows.

## 2. Users / Personas

- **Administrator / ops lead** — configures Wayfinder for their organisation's
  chosen AI model and document set; needs to raise or lower generation budgets
  when documents fail to generate or when they switch models.

## 3. Goals

- An admin can view and change the document-generation budgets from the
  Configuration screen, with no redeploy (applies on the next request, matching
  every other runtime setting).
- An admin can express the context budget either as an explicit token cap or as
  a percentage of the configured model's context window.
- The screen shows the active AI model's context window so budgets can be set
  relative to it.
- The hardcoded v1.49.0 constants become the defaults, so behaviour is unchanged
  until an admin edits anything.
- Invalid input is rejected with a clear message; a saved-but-unparseable value
  falls back to defaults rather than breaking generation.

## 4. Non-goals

- Per-flow or per-node overrides — settings are global only (matches
  `SessionUploadConfig`). Captured as future work.
- Changing the generation algorithm itself (batching/truncation logic from
  v1.49.0 stays; this PRD only makes its parameters configurable).
- Exposing chat-path RAG retrieval limits (`DEFAULT_FLOW_LIMIT`, similarity
  thresholds) — different surface, out of scope here.
- Rebuilding the existing AI Provider (model selection) or Global AI Instructions
  cards; they are only visually grouped under a new "AI" section.

## 5. Key entities

| Entity | Lives in | New / existing | Notes |
| ------ | -------- | -------------- | ----- |
| `DocumentGenerationConfig` | `packages/domain/src/entities/runtime-config.ts` | new | `contextBudgetMode: "tokens" \| "model_percent"`, `contextBudgetTokens`, `contextBudgetPercent`, `fieldBatchSize`, `maxPromptTokens` |
| `DOCUMENT_GENERATION_CONFIG_SETTING_KEY` | `packages/domain/src/entities/runtime-config.ts` | new | `"document_generation_config"` |
| `system_settings` row | DB (existing table) | existing | one key/value row; no schema change |

## 6. User stories

1. As an admin, I can open Configuration → AI → Document Generation and see the
   current context budget, field batch size, and max prompt tokens.
2. As an admin, I can switch the context budget between an explicit token cap and
   a percentage of the model window, and save it.
3. As an admin, I can see the configured model's context window on the card, so I
   know what headroom my numbers leave.
4. As an admin, when I enter an out-of-range value (e.g. batch size 0), I get a
   validation error and nothing is saved.
5. As a developer, the generation use-cases read these values at call time, so a
   saved change takes effect on the next generation without redeploy.

## 7. Pages / surfaces affected

- `/admin/settings` — new **Document Generation** card; AI Provider, Global AI
  Instructions, and Document Generation grouped under an "AI" section heading.
- tRPC: `settings.getDocumentGenerationConfig` (query), `settings.setDocumentGenerationConfig`
  (mutation) — added, mirroring the session-upload pair.
- `IRuntimeConfig` port: `getDocumentGenerationConfig()` and
  `invalidateDocumentGeneration()` — added.
- `packages/application/src/use-cases/document/structured-fields.ts` and
  `generate-document.ts` — read config values instead of module constants.

## 8. Database changes

None. Stored as a single `system_settings` row under
`document_generation_config`, exactly like `session_upload_config`.

## 9. Architectural decisions

- Introduces **ADR 027 — Document generation budgeting configuration**: where the
  config is read (the generation boundary, not the prompt builder), the
  explicit-vs-percentage budget model, and how the percentage mode derives a
  token budget from the configured model's context window.
- Assumes the v1.49.0 budgeting/batching mechanism (this PRD parameterises it).

## 10. Acceptance criteria

- [ ] `DocumentGenerationConfig` + setting key defined in domain; defaults equal
      the v1.49.0 constants (context ≈100k tokens, batch size 12, max prompt
      180k tokens).
- [ ] `runtimeConfig.getDocumentGenerationConfig()` returns the parsed config,
      caches it, and `invalidateDocumentGeneration()` clears the cache; an
      unparseable stored value falls back to defaults.
- [ ] `settings.getDocumentGenerationConfig` / `setDocumentGenerationConfig`
      exist; `set` validates ranges, persists, and invalidates the cache.
- [ ] The generation path resolves a concrete token budget: explicit mode uses
      `contextBudgetTokens`; percentage mode uses `contextBudgetPercent` × model
      context window, reserving the remainder for template + output.
- [ ] `structured-fields.ts` / `generate-document.ts` use the resolved values;
      the hardcoded constants remain only as defaults.
- [ ] Admin card reads/writes the config, shows the model context window, toggles
      budget mode, and surfaces validation errors via toast.
- [ ] Existing generation behaviour is unchanged when no setting is saved.
- [ ] `./validate.sh` passes.

## 11. Out of scope / future work

- Per-flow / per-node generation budget overrides.
- Auto-tuning batch size from observed token usage.
- Surfacing chat-path RAG limits in the same panel.

## 12. Risks / open questions

- **Token estimation accuracy.** The budget uses a char/token heuristic
  (~4 chars/token); percentage mode depends on a correct model-window figure per
  provider/model. Mitigation: conservative headroom; readout is informational.
- **Model window source.** The configured model name must map to a context-window
  number. If unknown, percentage mode should fall back to a safe default and the
  card should say so. (Resolved in ADR 027.)
- **Cache coherence.** Like other runtime configs, multi-instance deployments see
  the change after their own cache invalidation/TTL — acceptable and consistent
  with existing settings.
