# v1.15.1 — Amazon Bedrock as an AI provider

## What was built

A fourth selectable AI provider, `"bedrock"`, plumbed end-to-end:

- Selectable at boot via `AI_DEFAULT_PROVIDER=bedrock`.
- Authenticated with an AWS triplet — region, access key id, secret access
  key — set either via env (`AWS_BEDROCK_REGION`,
  `AWS_BEDROCK_ACCESS_KEY_ID`, `AWS_BEDROCK_SECRET_ACCESS_KEY`) or
  through the admin Settings → AI Provider modal.
- Calls flow through `@ai-sdk/amazon-bedrock` via the existing
  `ILanguageModel` port — no application-layer changes.
- Default Bedrock models: Sonnet 4.5 for document generation, Haiku 4.5
  for chat / branching (both addressed by their Bedrock model IDs).
- Health check (`AiHealthChecker`) treats Bedrock as healthy when all
  three triplet fields are configured.

## Files modified

### Domain
- `packages/domain/src/ports/language-model.ts` — `ProviderName` adds `"bedrock"`.
- `packages/domain/src/entities/runtime-config.ts` — adds `BedrockCredentials` and `apiKeys.bedrock`.

### Adapters
- `packages/adapters/package.json` — `@ai-sdk/amazon-bedrock` devDependency.
- `packages/adapters/src/ai/providers.ts` — bedrock entry; polymorphic `ProviderCredentials` type; runtime credential-shape guards.
- `packages/adapters/src/ai/providers.test.ts` — 12 tests (4 new for bedrock + 2 cross-provider credential-shape guards).
- `packages/adapters/src/ai/language-model-adapter.ts` — `resolveForCall` returns `credentials: ProviderCredentials` instead of `apiKey: string | null`.
- `packages/adapters/src/ai/language-model-adapter.test.ts` — 15 tests (2 new for bedrock credential plumbing + existing fixtures widened).
- `packages/adapters/src/config/runtime-config-store.ts` — `EnvDefaults.apiKeys.bedrock`, bedrock entry in `DEFAULT_MODELS_FOR`, bedrock parse + redact branches.
- `packages/adapters/src/config/runtime-config-store.test.ts` — new file, 7 tests covering env fallback, parse, redact.
- `packages/adapters/src/factory.ts` — `AdaptersConfig` extends with `aiKeys.bedrock`; provider enum widened.
- `packages/adapters/src/health/ai-health-checker.ts` — bedrock health resolves when triplet is set.

### Web app
- `apps/web/src/lib/env.ts` — `AI_DEFAULT_PROVIDER` widened; 3 new optional env vars.
- `apps/web/src/lib/container.ts` — wires the bedrock triplet (null unless all three set).
- `apps/web/src/server/routers/settings.ts` — Zod schema gains bedrock; new `mergeBedrockCredentials` per-field merge; `bedrockState` for `getAiConfig`; `mergeApiKeys` exported for testing.
- `apps/web/src/server/routers/settings.test.ts` — new file, 6 tests of `mergeApiKeys` bedrock branch.
- `apps/web/src/app/(admin)/admin/settings/page.tsx` — provider dropdown gains "Amazon Bedrock"; 3 new inputs in the modal (region, access key id, secret access key); summary card shows region + set/unset markers.
- `apps/web/src/app/api/chat/[sessionId]/stream/turn-helpers.ts` — `generateTitle`'s `apiKey: string | null` widened to `credentials: ProviderCredentials`.

### API app
- `apps/api/src/env.ts` — `AI_DEFAULT_PROVIDER` widened; 3 new optional env vars.
- `apps/api/src/container.ts` — wires the bedrock triplet into `RuntimeConfigStore` and `AiHealthChecker`.

### Root
- `.env.example` — documents `AI_DEFAULT_PROVIDER` options and adds the three new `AWS_BEDROCK_*` vars under the AI Providers block.
- `VERSION`, `package.json` — bumped to `1.15.1`.

## Migrations run

None. Bedrock credentials live in the existing `ai_config` JSON setting
(`admin_system_settings`). The `RuntimeConfigStore` parser was extended
to recognise the new field; old records that lack a `bedrock` key fall
back to env-provided defaults.

## Known limitations

- **Explicit credentials only.** IAM-role / AWS default-credential-chain
  discovery is not wired up; if all three fields are blank the SDK is
  invoked with `{}`, which means it will look at the runtime AWS
  environment — but we don't actively advertise that fallback.
- **Model list is free-text.** No dropdown of available Bedrock model IDs
  per region; admins paste the exact model identifier. This mirrors the
  existing UI for the other three providers.
- **Cache-token accounting** for Anthropic-on-Bedrock models works because
  the Vercel AI SDK surfaces the same `anthropic.cacheCreationInputTokens`
  / `cacheReadInputTokens` provider metadata. Non-Anthropic Bedrock models
  report 0 cache tokens, same as the OpenAI / Mistral paths.
- **No live connectivity test** in the Settings modal — saving valid-shaped
  garbage will succeed; first failure surfaces at call time via the
  existing `AI_PROVIDER_FAILED` Result.

## Version bump

`1.15.0` → `1.15.1` (PATCH). Originally targeted `1.14.0` → `1.14.1`; rebased onto `1.15.0` after merging main.
