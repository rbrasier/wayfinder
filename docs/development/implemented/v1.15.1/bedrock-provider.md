# Amazon Bedrock as an AI provider

## Problem

The framework currently supports three AI providers — Anthropic, OpenAI, and
Mistral — each authenticated with a single API key. Organisations that
already run on AWS want to route their model calls through **Amazon
Bedrock** so that traffic, billing, and audit live inside their AWS
account. Bedrock does not authenticate with a single API key: it uses an
IAM access-key / secret-key pair plus a region. That doesn't fit the
current `apiKeys` shape on `AiConfig`, which is `Record<ProviderName,
string | null>`.

## Behaviour change

- A new fourth provider, `"bedrock"`, is selectable everywhere the existing
  three are selectable: the `AI_DEFAULT_PROVIDER` env var, the
  `RuntimeConfigStore`, the admin Settings modal's provider dropdown, and
  the runtime AI calls themselves.
- Bedrock authentication is configured with three fields — region, access
  key id, secret access key — set either through new env vars
  (`AWS_BEDROCK_REGION`, `AWS_BEDROCK_ACCESS_KEY_ID`,
  `AWS_BEDROCK_SECRET_ACCESS_KEY`) or through the Settings modal.
- When Bedrock is the active provider, calls are routed through
  `@ai-sdk/amazon-bedrock` with the configured credentials and region.
  Default Bedrock models are Sonnet 4.5 for `documentGeneration` and
  Haiku 4.5 for `chat` / `branching`, matching the existing Anthropic
  defaults but pointed at their Bedrock-hosted model IDs.
- The existing three providers behave exactly as before. Bedrock is purely
  additive.
- The Settings modal continues to show non-secret state only: stored
  credentials are reported as `set` / `unset`, never echoed back.

## Affected entities

- `domain/ports/language-model.ts`:
  - `ProviderName` gains `"bedrock"`.
- `domain/entities/runtime-config.ts`:
  - `AiConfig.apiKeys` becomes a union per provider — the existing three
    stay as `string | null`; a new `bedrock` field holds
    `BedrockCredentials | null`, where
    `BedrockCredentials = { region: string; accessKeyId: string; secretAccessKey: string }`.
  - A small named type `BedrockCredentials` is exported from
    `entities/runtime-config.ts` so adapters and tRPC schemas can refer
    to it.

## Affected use cases

None at the application layer. The change is purely in the adapters
and the configuration plumbing. All `ILanguageModel` callers
(`SendMessage`, `GenerateDocument`, `SummariseTemplate`,
`LangGraphAgentRunner`, etc.) remain unchanged because the port surface
doesn't change.

## DB changes

**None.** Bedrock credentials are stored inside the existing
`ai_config` value under `admin_system_settings`. No new tables, no new
columns, no migration. The serialiser/parser inside
`RuntimeConfigStore` is extended to recognise the new `bedrock` field.

## API / UI changes

### Packages

- `packages/adapters/package.json`: add `@ai-sdk/amazon-bedrock` as a peer
  dependency (mirroring the pattern used for the other three SDKs) and as
  a devDependency so adapter tests can import it without the host app.
- `packages/adapters/src/ai/providers.ts`:
  - Extend the `PROVIDERS` registry with a `bedrock` entry whose default
    model is `anthropic.claude-sonnet-4-5-20250929-v1:0`.
  - Replace the `apiKey?: string | null` resolver signature with a
    polymorphic `credentials` value:
    `string | BedrockCredentials | null`. For the existing three
    providers the resolver narrows to the string branch (no behaviour
    change). For Bedrock the resolver calls
    `createAmazonBedrock({ region, accessKeyId, secretAccessKey })`.
- `packages/adapters/src/ai/language-model-adapter.ts`:
  - `resolveForCall` picks `config.apiKeys[provider]` and passes it as
    `credentials` to `resolveModel`. For the three legacy providers the
    value is `string | null` (unchanged); for `bedrock` it's
    `BedrockCredentials | null`.
- `packages/adapters/src/config/runtime-config-store.ts`:
  - `EnvDefaults.apiKeys` gains `bedrock: BedrockCredentials | null`.
  - `DEFAULT_MODELS_FOR` gains a `bedrock` entry:
    chat = `anthropic.claude-haiku-4-5-20251001-v1:0`,
    documentGeneration = `anthropic.claude-sonnet-4-5-20250929-v1:0`,
    branching = `anthropic.claude-haiku-4-5-20251001-v1:0`.
  - `parseAiConfig` validates the bedrock credential shape and falls back
    to the env-provided default if the stored value is missing or
    malformed.
  - `redactAi` renders the bedrock credentials as
    `{ region, accessKeyId: "set"/"unset", secretAccessKey: "set"/"unset" }`
    so the region (non-secret) is still visible after redaction.

### Web app

- `apps/web/src/lib/env.ts`: add three optional fields —
  `AWS_BEDROCK_REGION`, `AWS_BEDROCK_ACCESS_KEY_ID`,
  `AWS_BEDROCK_SECRET_ACCESS_KEY` — and add `"bedrock"` to the
  `AI_DEFAULT_PROVIDER` enum.
- `apps/web/src/lib/container.ts`: wire the env defaults into
  `EnvDefaults.apiKeys.bedrock` as a `BedrockCredentials | null` (null if
  any of the three fields are absent — they only mean something as a
  triplet).
- `apps/web/src/server/routers/settings.ts`:
  - Extend `aiConfigInputSchema` so `apiKeys.bedrock` accepts
    `{ region?: string; accessKeyId?: string; secretAccessKey?: string } | null`.
  - `mergeApiKeys` keeps the existing behaviour for the legacy providers,
    and for `bedrock` does a per-field merge: any blank/missing incoming
    field keeps the stored value, so an admin can rotate just the secret
    without re-entering the region.
  - `getAiConfig` returns `apiKeys.bedrock` as
    `{ region: string | null, accessKeyId: "set"/"unset", secretAccessKey: "set"/"unset" }`
    so the modal can show the configured region without exposing the
    secret.
- `apps/web/src/app/(admin)/admin/settings/page.tsx` (`AiProviderCard`):
  - Add `"Amazon Bedrock"` to the provider dropdown.
  - Add three new inputs that render only when relevant: AWS region
    (text), Access key ID (text), Secret access key (password,
    placeholder shows `•••••• (stored)` when set). These follow the
    same "blank means keep stored" pattern as the other three keys.
  - The summary block (when the modal is closed) shows the current
    Bedrock region plus `set` / `unset` for the credentials.

### Env

- `.env.example` gains:
  ```
  # Amazon Bedrock (used when AI_DEFAULT_PROVIDER=bedrock)
  AWS_BEDROCK_REGION=us-east-1
  AWS_BEDROCK_ACCESS_KEY_ID=
  AWS_BEDROCK_SECRET_ACCESS_KEY=
  ```
  and `AI_DEFAULT_PROVIDER` is documented to accept `bedrock` as a value.

## Why a credential object instead of one composite string

Bedrock callers will want to rotate the secret independently of the
region (region changes are rare; secret rotation is routine). Storing
three explicit fields preserves the existing "leave blank to keep
stored" UX per-field, matches the AWS SDK's own shape, and avoids
parsing surprises that would come from packing `region:keyId:secret`
into one cell.

## Why no IAM-role / default-credential-chain fallback

The user opted for explicit credentials only. If we later need to
support IAM roles or the AWS default credential chain, this becomes
additive: leaving all three fields blank could be made to mean "fall
back to whatever the AWS SDK can discover."

## Out of scope

- Cross-region routing / fail-over.
- Bedrock-specific token-usage extraction (cache read/write metadata).
  Bedrock returns standard Anthropic provider metadata; the existing
  `extractMeta` shape already reads `cacheCreationInputTokens` /
  `cacheReadInputTokens` from the `anthropic` provider-meta block, so
  Claude-on-Bedrock cache stats Just Work. Non-Anthropic Bedrock models
  will report 0 cache tokens, same as the OpenAI / Mistral paths today.
- Listing available models for the dropdown (text inputs only, as today).

## Version bump

`1.15.0` → `1.15.1` (PATCH). Originally targeted `1.14.0` → `1.14.1`; rebased onto `1.15.0` after merging main.
