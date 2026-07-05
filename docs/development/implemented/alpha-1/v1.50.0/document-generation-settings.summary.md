# Implementation Summary — Document Generation Settings (v1.50.0)

- **Version bump**: MINOR (1.49.0 → 1.50.0) — new admin feature, no schema change.
- **PRD**: `docs/development/prd/document-generation-settings.prd.md`
- **ADR**: `docs/development/adr/027-document-generation-budgeting-config.adr.md`
- **Phase**: `docs/development/implemented/v1.50.0/document-generation-settings.phase.md`

## What was built

The v1.49.0 document-generation safety limits (context-document budget, field
batch size, max prompt tokens) — previously hardcoded constants — are now
admin-configurable at runtime from **Configuration → AI → Document Generation**,
applied on the next request with no redeploy. The context budget can be expressed
either as an explicit token cap or as a percentage of the configured model's
context window, and the card shows that window (flagged "estimated" for models not
in the known list). Defaults equal the v1.49.0 constants, so behaviour is
unchanged until an admin edits anything.

## How it works

- Settings ride a single `system_settings` row under `document_generation_config`
  (no schema change), following the established `SessionUploadConfig` pattern.
- The budget mode resolves to a concrete `ResolvedDocumentGenerationBudget`
  (`contextBudgetChars`, `fieldBatchSize`, `maxPromptTokens`) in
  `RuntimeConfigStore.resolveDocumentGenerationBudget()`: percentage mode derives
  a token budget from the model's context window; both modes convert tokens to a
  character budget via a shared chars/token constant.
- The budget is fetched at the generation boundary (the `generateDocument`
  turn-helper) and threaded into `GenerateDocument` → `extractStructuredFields`,
  which already parameterise the prompt builder. A failure resolving the budget
  falls back to the use-case defaults — it never blocks generation.

## Files created

- `packages/shared/src/schemas/document-generation.ts` — defaults, chars/token
  ratio, fallback context window.
- `docs/development/implemented/v1.50.0/document-generation-settings.summary.md`
  (this file).
- `apps/web/e2e/enhance-document-generation-settings.spec.ts` — e2e (below).

## Files modified

- `packages/shared/src/schemas/index.ts` — export the new constants module.
- `packages/domain/src/entities/runtime-config.ts` — `DocumentGenerationConfig`,
  `DocumentGenerationContextBudgetMode`, `ResolvedDocumentGenerationBudget`,
  `DOCUMENT_GENERATION_CONFIG_SETTING_KEY`.
- `packages/application/src/use-cases/document/structured-fields.ts` — optional
  `contextBudgetChars` / `maxPromptTokens` inputs; constants kept as defaults.
- `packages/application/src/use-cases/document/generate-document.ts` — optional
  `budget` input; `batchFields` honours an injected batch size.
- `packages/adapters/src/config/runtime-config-store.ts` —
  `DEFAULT_DOCUMENT_GENERATION_CONFIG`, `MODEL_CONTEXT_WINDOWS`,
  `resolveContextWindow`, `parseDocumentGenerationConfig` (field-by-field
  fallback), `getDocumentGenerationConfig`, `resolveDocumentGenerationBudget`,
  `invalidateDocumentGeneration`.
- `apps/web/src/server/routers/settings.ts` — `documentGenerationConfigInputSchema`
  (range validation) and `getDocumentGenerationConfig` / `setDocumentGenerationConfig`.
- `apps/web/src/app/api/chat/[sessionId]/stream/turn-helpers.ts` — resolve and
  thread the budget in the `generateDocument` wrapper.
- `apps/web/src/app/(admin)/admin/settings/page.tsx` — `DocumentGenerationCard`
  and an "AI" section grouping Global AI Instructions, AI Provider, and Document
  Generation.
- `VERSION`, `package.json` — 1.50.0.

## Migrations run

None. No schema change — the config is a `system_settings` key/value row.

## Tests added

- **Unit (application)**: injected `maxPromptTokens` guard and `contextBudgetChars`
  truncation in `structured-fields.test.ts`; injected `fieldBatchSize` batching in
  `generate-document.test.ts`.
- **Unit (adapters)**: defaults, field-by-field fallback, unparseable fallback,
  cache/invalidate, `resolveContextWindow` (known vs estimated), and
  `resolveDocumentGenerationBudget` in both modes in `runtime-config-store.test.ts`.
- **Unit (web)**: `documentGenerationConfigInputSchema` range validation in
  `settings.test.ts`; budget threading in `turn-helpers.test.ts`.
- **E2E**: `enhance-document-generation-settings.spec.ts` — admin edits the field
  batch size and the card reflects it (happy path); an out-of-range value is
  rejected with an error and nothing is saved (error path).

## Known limitations

- Per-flow / per-node budget overrides are out of scope (global only).
- Token budgeting is heuristic (chars/token), so percentage mode is approximate;
  conservative headroom keeps generation under the real window.
- `MODEL_CONTEXT_WINDOWS` must be extended as new models ship; unknown models fall
  back to a conservative default and are labelled "estimated" on the card.
