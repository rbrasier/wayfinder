# ADR-015 — Step-Level AI Overrides: Configurable Prompt & Model

- **Status**: Proposed
- **Date**: 2026-05-31
- **Builds on**: ADR-002 (multi-provider AI), ADR-004 (LangGraph adapter
  boundary), ADR-006 (jsonb config)
- **Paired with**: ADR-014 (advanced-mode gating & storage)

## Context

ADR-014 establishes that, when a flow is in advanced mode, a step may carry a
`promptOverride` and `modelOverrides` on its node `config`. This ADR decides how
those two overrides actually take effect without breaking the adapter boundary
or the structured-output contract.

Two facts from the codebase constrain the design:

1. **The system prompt is fully assembled by `FlowSessionGraph.buildSystemPrompt()`**
   (`packages/adapters/src/agents/flow-session-graph.ts`). It interleaves
   *authored* content (`aiInstruction`, `doneWhen`) with *dynamic, per-turn*
   content (`gatheredContext`, `contextDocs`, document template, field formats)
   and a fixed **machine contract** — the `<output>` block that forces the
   `turnResponseSchema` JSON (`response`, `rationale`, `stepCompleteConfidence`,
   `contextGathered`). The prompt also states a hard-coded "90% confidence"
   target in `<goal>` that is independent of the real advancement threshold.

2. **The `ILanguageModel` port already accepts a per-call `model`, but pins the
   provider to global config.** `resolveForCall` in
   `packages/adapters/src/ai/language-model-adapter.ts` computes
   `model = input.model ?? config.models[purpose]` but always uses
   `provider = config.provider` and `credentials = config.apiKeys[provider]`.
   So overriding the model *string* needs no change; overriding the *provider*
   does.

## Decision

### 1. Prompt override = placeholder template, machine contract auto-enforced

A verbatim stored prompt would freeze per-turn dynamic content (context docs,
gathered context) and could silently drop the JSON output contract, breaking
parsing. So the override is **not** an opaque string substitution.

- `buildSystemPrompt()` gains a branch: when `nodeConfig.promptOverride` is set
  (and the flow is advanced — enforced by the caller per ADR-014 §4), it renders
  the override as a **template** with a documented placeholder set that the
  builder substitutes from the same `BuildSystemPromptInput` it already receives:

  | Placeholder | Substituted with |
  |-------------|------------------|
  | `{{role}}` | the role block (`expertRole`, org, workflow) |
  | `{{instructions}}` | `aiInstruction` |
  | `{{completionCriteria}}` | effective `doneWhen` |
  | `{{context}}` | gathered-context + reference-docs block |
  | `{{documentTemplate}}` | document template block (if `generate_document`) |
  | `{{fieldFormats}}` | field-format block (if any) |
  | `{{confidenceTarget}}` | the configured threshold (see §3 of ADR-014) |

- The **`<output>` machine contract is appended by the builder, always**, and is
  **not** part of the editable surface. If an author's override happens to
  include its own output instructions, the canonical contract still wins
  (appended last). This guarantees `turnResponseSchema` parsing keeps working no
  matter what the author writes.

- When `promptOverride` is **null/absent**, `buildSystemPrompt()` produces
  exactly today's prompt — no behavioural change for simple flows or
  advanced steps that don't override.

- **Seeding:** the editable field in the UI is seeded from the *generated*
  prompt (reusing the existing `flow.node.previewPrompt` query) so authors start
  from a working template and edit down, rather than from a blank box. The
  placeholders above are the parts the seed exposes as `{{…}}` tokens.

> Rationale for placeholders over free text: it preserves RAG/context injection
> (critical once the pgvector phase lands), keeps the hard structured-output
> contract intact, and still gives authors full control over wording, ordering,
> tone, and added instructions.

### 2. Model override = extend the call input with an optional provider

`ModelRef` (ADR-014) is `{ provider, model }`. To honour the provider, the
domain `ILanguageModel` input types gain an **optional** `provider`:

```ts
// packages/domain/src/ports/language-model.ts (StreamTextInput, GenerateObjectInput, StreamObjectInput)
provider?: ProviderName;   // NEW — overrides the globally configured provider for this call
model?: string;            // existing — overrides the per-purpose model
purpose: string;           // existing
```

`resolveForCall` in the adapter is updated:

```ts
const provider = inputProvider ?? config.provider;
const credentials = config.apiKeys[provider];
const model = inputModel ?? config.models[resolvePurpose(rawPurpose)];
```

- Backward compatible: every existing call omits `provider`, so behaviour is
  unchanged.
- Credentials come from `config.apiKeys[provider]`. If the chosen provider has
  no key, `resolveModel`/the provider SDK fails and surfaces as the existing
  `AI_PROVIDER_FAILED` Result — never a thrown exception across the boundary.

### 3. Who passes the override, and for which purpose

- **Conversation (`purpose: "chat"`):** the chat-turn call site
  (`apps/web/src/app/api/chat/[sessionId]/stream/route.ts`) reads
  `nodeConfig.modelOverrides?.chat` (only when `flow.advancedMode`, per ADR-014)
  and passes `{ provider, model }` into the `streamObject`/`streamText` input.
- **Document generation (`purpose: "documentGeneration"`):** the
  `GenerateDocument` use-case
  (`packages/application/src/use-cases/document/generate-document.ts`) receives
  the node config and passes `nodeConfig.modelOverrides?.documentGeneration` on
  its `languageModel.generateObject(...)` calls. This applies **only** when
  `outputType === "generate_document"`. `ProviderName` lives in a domain port,
  so the application layer references it without importing any adapter/SDK —
  the boundary holds.
- **Branching (`purpose: "branching"`)** is **not** overridable (PRD §4); it
  keeps using global config.

### 4. Model allow-list derives from the provider registry

`providers.ts` (`PROVIDERS`) is already the single source of truth for supported
providers and their default models. A curated allow-list is exported from the
adapters AI module:

```ts
// packages/adapters/src/ai/providers.ts
export const ALLOWED_MODELS: ReadonlyArray<{
  provider: ProviderName;
  model: string;
  label: string;
}> = [ /* curated per provider */ ];
```

- Surfaced read-only to the UI via a tRPC query (e.g. `flow.allowedModels`), so
  authors **pick**, never type, a model id.
- `flow.node.update` validates that any submitted `ModelRef` is a member of
  `ALLOWED_MODELS`; otherwise it returns a `VALIDATION_FAILED` Result.
- Curation of the list is an ops/config concern, not per-flow data.

## Consequences

**Positive**

- Authors get genuine prompt control without the ability to break structured
  output or lose dynamic context injection.
- Cross-provider per-step model choice works, via a minimal, backward-compatible
  optional field on existing port inputs — no new port, no adapter leak.
- The allow-list reuses the existing provider registry; one place to curate.
- Document-generation model override is naturally scoped to document steps.

**Negative**

- The placeholder contract is a small DSL authors must learn; needs inline UI
  docs and validation/warnings for unknown or dropped placeholders.
- Adding `provider?` to three domain input types touches the port surface
  (additive, but every implementation/mocks must accept it).
- A saved `promptOverride` can drift from later improvements to the generated
  base prompt (also noted in PRD §12); mitigated by re-seed affordance and by
  keeping dynamic blocks as placeholders rather than baked text.
- Validating model/credential availability spans save-time (allow-list
  membership) and runtime (key presence) — two checks, clearly separated.

## Deferred (not this ADR)

- Model parameters (temperature, max tokens, top-p) — would extend the same
  call inputs later.
- Overriding the branching model.
- Per-step prompt for the separate confidence-evaluator prompt
  (`buildConfidenceSystemPrompt`), if/when that path is configurable.
