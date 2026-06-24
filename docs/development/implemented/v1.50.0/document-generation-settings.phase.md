# Phase — Document Generation Settings

- **Status**: Awaiting review
- **Target version**: 1.50.0  (bump: MINOR — new admin feature; no schema change, rides `system_settings`)
- **PRD**: `docs/development/prd/document-generation-settings.prd.md`
- **ADRs**: ADR-027 (budgeting configuration)
- **Depends on**: v1.49.0 generation budgeting/batching; `RuntimeConfigStore`
  pattern (`session_upload_config`, `ai_config`); admin settings page + tRPC
  `settings` router.

## 1. Problem

The document-generation safety limits (context-doc budget, field batch size,
max prompt tokens) are hardcoded constants from v1.49.0. They depend on the
deployment's model and document corpus, which only the admin knows, but cannot be
changed without a redeploy. See the PRD.

## 2. Goals

- Admin-editable document-generation budgets on the Configuration screen, applied
  on the next request (no redeploy).
- Context budget expressible as an explicit token cap **or** a percentage of the
  configured model's context window.
- Read-only model-context-window readout on the card.
- v1.49.0 constants become the defaults — unchanged behaviour until edited.

## 3. Non-goals

Per-flow/per-node overrides; changing the batching/truncation algorithm; chat-path
RAG limits; rebuilding the AI Provider or Global AI Instructions cards (visual
grouping only). (PRD §4 / §11.)

## 4. Approach

Mirror the `SessionUploadConfig` end-to-end pattern: a domain config type + setting
key, a `RuntimeConfigStore` getter/parser/invalidator, an `IRuntimeConfig` port
method, tRPC `get`/`set` procedures, and an admin card. Resolve the concrete
budget at the generation boundary (ADR-027) and thread the numbers into the
already-parameterised `buildContextDocsSection` / `extractStructuredFields`.
Build strictly bottom-up (domain → application → adapters → web), test file before
implementation file (CLAUDE.md).

## 5. Key entities / files

| Layer | File | Change |
|-------|------|--------|
| domain | `packages/domain/src/entities/runtime-config.ts` | add `DocumentGenerationConfig` (`contextBudgetMode: "tokens" \| "model_percent"`, `contextBudgetTokens`, `contextBudgetPercent`, `fieldBatchSize`, `maxPromptTokens`), `DOCUMENT_GENERATION_CONFIG_SETTING_KEY = "document_generation_config"`, and default constants equal to v1.49.0 values |
| domain | `packages/domain/src/ports/runtime-config.ts` (`IRuntimeConfig`) | add `getDocumentGenerationConfig(): Promise<DocumentGenerationConfig>` and `invalidateDocumentGeneration(): void` |
| domain | `packages/domain/src/entities/runtime-config.ts` | add `ResolvedDocumentGenerationBudget` (`{ contextBudgetChars, fieldBatchSize, maxPromptTokens }`) — what the use-case consumes |
| application | `packages/application/src/use-cases/document/structured-fields.ts` | keep constants as exported defaults; `buildContextDocsSection` already takes `maxChars`; thread `maxPromptTokens` into the pre-flight guard via a param instead of the module constant |
| application | `packages/application/src/use-cases/document/generate-document.ts` | accept a resolved budget (constructor dep or `execute` input); use `fieldBatchSize` for `batchFields`; pass `contextBudgetChars` + `maxPromptTokens` into `extractStructuredFields` |
| adapters | `packages/adapters/src/config/runtime-config-store.ts` | add `DEFAULT_DOCUMENT_GENERATION_CONFIG`, `parseDocumentGenerationConfig` (field-by-field fallback), cache + pending fields, `getDocumentGenerationConfig()`, `invalidateDocumentGeneration()`; resolve model context window via the lookup below |
| adapters | `packages/adapters/src/ai/providers.ts` (or model-defaults module) | add `MODEL_CONTEXT_WINDOWS: Record<provider, Record<modelId, number>>` + `DEFAULT_CONTEXT_WINDOW_TOKENS`; helper `resolveContextWindow(provider, model)` |
| adapters | `packages/adapters/src/config/runtime-config-store.ts` | `resolveDocumentGenerationBudget()` → converts config + model window into `ResolvedDocumentGenerationBudget` (tokens→chars via `CHARS_PER_TOKEN`) |
| web | `apps/web/src/server/routers/settings.ts` | add `getDocumentGenerationConfig` (query, returns config + resolved model window) and `setDocumentGenerationConfig` (mutation: validate ranges, persist, `invalidateDocumentGeneration()`) |
| web | `apps/web/src/app/api/chat/[sessionId]/stream/turn-helpers.ts` (`generateDocument` wrapper) | fetch `runtimeConfig.getDocumentGenerationConfig()` / resolved budget at the edge and pass into the use-case |
| web | `apps/web/src/lib/container.ts` | wire the resolved budget / runtime config into `GenerateDocument` if constructor-injected |
| web | `apps/web/src/app/(admin)/admin/settings/page.tsx` | new `DocumentGenerationCard`; group `AiProviderCard`, `GlobalInstructionsCard`, `DocumentGenerationCard` under an "AI" section heading |

## 6. Implementation steps (test-first per CLAUDE.md)

1. **Domain — types.** Add `DocumentGenerationConfig`, the setting key, defaults,
   and `ResolvedDocumentGenerationBudget`; extend `IRuntimeConfig`. Pure type
   additions; no test, but keep defaults equal to the v1.49.0 constants.
2. **Application — parameterise.** Write tests first: `extractStructuredFields`
   honours an injected `maxPromptTokens`; `GenerateDocument` uses an injected
   `fieldBatchSize` and `contextBudgetChars`. Then thread the params; constants
   become defaults only.
3. **Adapters — config store.** Test first: `parseDocumentGenerationConfig`
   round-trips and falls back per-field; `getDocumentGenerationConfig` caches and
   invalidates; `resolveContextWindow` returns the mapped window or the safe
   default; `resolveDocumentGenerationBudget` computes the same number in
   `tokens` and `model_percent` modes. Then implement.
4. **Web — tRPC.** Test first (settings router test): `set` rejects out-of-range
   input and invalidates the cache; `get` returns config + model window. Then add
   the procedures.
5. **Web — wiring.** Fetch the resolved budget in the `generateDocument` wrapper
   and pass it into the use-case; confirm a saved change takes effect without
   redeploy (covered by step 3/4 unit behaviour).
6. **Web — UI.** `DocumentGenerationCard` (mode toggle, three inputs, model-window
   readout) following `SessionUploadsCard`; add the "AI" section grouping.
7. **E2E.** `apps/web/e2e/enhance-document-generation-settings.spec.ts`: admin
   edits the budget, save persists, validation error on a bad value.
8. **Validate + version.** `./validate.sh`; bump VERSION + root `package.json` to
   `1.50.0`; move this phase doc to `implemented/v1.50.0/`.

## 7. Defaults (must match v1.49.0)

| Setting | Default | Source constant |
|---------|---------|-----------------|
| `contextBudgetMode` | `"tokens"` | n/a |
| `contextBudgetTokens` | 100_000 (≈ `CONTEXT_DOCS_CHAR_BUDGET` 400_000 ÷ `CHARS_PER_TOKEN`) | `CONTEXT_DOCS_CHAR_BUDGET` |
| `contextBudgetPercent` | 50 | n/a (only used in `model_percent` mode) |
| `fieldBatchSize` | 12 | `GenerateDocument.FIELD_BATCH_SIZE` |
| `maxPromptTokens` | 180_000 | `MAX_PROMPT_TOKENS` |

## 8. Acceptance criteria

Mirrors PRD §10. Each item testable; verified by the unit/e2e tests above and a
final `./validate.sh`.

## 9. Risks

- Model→context-window map must track new models; safe fallback + "estimated"
  label mitigate. (ADR-027.)
- Token budgeting stays heuristic; percentage mode is approximate. Conservative
  headroom keeps generation under the real window.
