# Phase — Advanced-Mode Step Configuration

- **Status**: Awaiting review
- **Target version**: 1.19.0  (bump: MINOR — additive `app_flows.advanced_mode` column + new feature)
- **PRD**: `docs/development/prd/advanced-step-config.prd.md`
- **ADRs**: ADR-014 (gating & storage), ADR-015 (step-level AI overrides)
- **Depends on**: existing flow/session schema (ADR-006), session-scoped LangGraph
  (ADR-007), multi-provider AI (ADR-002), the read-only prompt preview
  (`flow.node.previewPrompt`)

## 1. Problem

Flow authors get one fixed behaviour per conversational step: a generated
prompt, a hard-coded advance-at-90 confidence rule, and the globally configured
model. Power authors need per-step control — advancement pacing, prompt wording,
and model choice (including for document generation) — without complicating the
default simple authoring experience. See the PRD for full detail.

## 2. Goals

- Flow-level **Advanced mode** toggle gates all new controls.
- Per-step **confidence progression**: threshold + behaviour
  (`auto_advance` | `require_confirmation`).
- Per-step **editable prompt** (override), seeded from the generated prompt,
  with the machine output-contract always enforced.
- Per-step **model selection** for `chat` and `documentGeneration` from a
  curated allow-list.
- Simple flows behave byte-for-byte as today.

## 3. Non-goals

Model parameters, retrieval/KB config, escalation limits, document-output
formats, branching-model override, free-form model ids. (PRD §4 / §11.)

## 4. Approach

Storage and gating follow ADR-014; prompt and model override mechanics follow
ADR-015. One additive flow column; everything else rides the node `config`
jsonb. Build strictly bottom-up (domain → application → adapters → web), writing
the test file before each implementation file (CLAUDE.md rule).

## 5. Key entities / files

| Layer | File | Change |
|-------|------|--------|
| domain | `packages/domain/src/entities/flow.ts` | add `advancedMode: boolean` to `Flow` (not `NewFlow`) |
| domain | `packages/domain/src/entities/flow-node.ts` | add `ConfidenceProgression`, `ConfidenceBehaviour`, `ModelRef`; extend `ConversationalNodeConfig` with `confidenceProgression`, `promptOverride`, `modelOverrides` |
| domain | `packages/domain/src/ports/language-model.ts` | add optional `provider?: ProviderName` to `StreamTextInput`, `GenerateObjectInput`, `StreamObjectInput` |
| domain | `packages/domain/src/ports/session-agent.ts` (`BuildSystemPromptInput`) | no new field needed — `nodeConfig`, `gatheredContext`, etc. already present; builder reads `promptOverride` from `nodeConfig` |
| application | `packages/application/src/use-cases/session/run-turn.ts` | resolve threshold (`confidenceProgression.threshold` → legacy → 90); honour `behaviour` (`require_confirmation` withholds advance, emits `awaitingConfirmation`) |
| application | `packages/application/src/use-cases/document/generate-document.ts` | pass `modelOverrides?.documentGeneration` (`{ provider, model }`) on `languageModel.generateObject` calls when present |
| adapters | `packages/adapters/src/db/schema/wayfinder.ts` | `app_flows`: add `advanced_mode boolean not null default false` |
| adapters | `packages/adapters/drizzle/<next>.sql` | migration: `ALTER TABLE app_flows ADD COLUMN advanced_mode boolean NOT NULL DEFAULT false` |
| adapters | `packages/adapters/src/repositories/<flow-repository>.ts` | map `advancedMode` ↔ `advanced_mode` |
| adapters | `packages/adapters/src/agents/flow-session-graph.ts` | `buildSystemPrompt`: when `nodeConfig.promptOverride` set, render placeholder template; always append `<output>` contract; thread `{{confidenceTarget}}` from threshold |
| adapters | `packages/adapters/src/ai/language-model-adapter.ts` | `resolveForCall`: `provider = inputProvider ?? config.provider`; credentials from chosen provider |
| adapters | `packages/adapters/src/ai/providers.ts` | export curated `ALLOWED_MODELS: { provider, model, label }[]` |
| web | `apps/web/src/server/routers/flow.ts` | `flow.update` accepts `advancedMode`; `flow.node.update` accepts new config fields + validates `ModelRef` ∈ `ALLOWED_MODELS`; add `flow.allowedModels` query |
| web | `apps/web/src/app/api/chat/[sessionId]/stream/route.ts` | when `flow.advancedMode`: apply `behaviour`/threshold and pass `modelOverrides?.chat` `{ provider, model }` into the LM call |
| web | `apps/web/src/components/canvas/node-config-modal.tsx` | gated **Advanced** section: threshold + behaviour, editable prompt (extend existing edit/preview), two model selectors |
| web | `apps/web/src/app/(user)/flows/[id]/config/_content.tsx`, `apps/web/src/app/(admin)/admin/flows/[id]/_content.tsx` | flow-level Advanced-mode toggle |

## 6. Implementation steps (test-first per CLAUDE.md)

1. **Domain — types.** Add `advancedMode` to `Flow`; add `ConfidenceProgression`,
   `ConfidenceBehaviour`, `ModelRef`, and the three new `ConversationalNodeConfig`
   fields; add optional `provider?` to the LM input types. Domain stays
   dependency-free (uses existing `ProviderName` from its own port). No tests
   needed for pure type additions, but update any exhaustive type guards.

2. **Application — confidence behaviour.** Write `run-turn.test.ts` cases first:
   (a) `auto_advance` reproduces `>= threshold` advance; (b) legacy
   `advanceConfidenceThreshold` still respected when `confidenceProgression`
   absent; (c) `confidenceProgression.threshold` wins when both present;
   (d) `require_confirmation` returns `advanced: false` + `awaitingConfirmation`
   when confidence ≥ threshold; (e) advance occurs only on the confirmation turn.
   Then implement.

3. **Application — doc-gen model override.** Add `generate-document.test.ts`
   case asserting `documentGeneration` override `{ provider, model }` is passed
   through to `languageModel.generateObject` only when present and when
   `outputType === "generate_document"`. Implement by threading the node config's
   `modelOverrides` into the call input.

4. **Adapters — schema + migration + repo mapping.** Add the `advanced_mode`
   column, generate the migration, map it in the flow repository. Repository test
   asserts round-trip of `advancedMode` and default `false` for existing rows.

5. **Adapters — prompt override.** Write `flow-session-graph.test.ts` cases:
   (a) no override → byte-for-byte today's prompt; (b) override with placeholders
   → substituted correctly; (c) `<output>` contract present even if the override
   omits it; (d) `{{confidenceTarget}}` reflects the configured threshold. Then
   implement the `buildSystemPrompt` branch.

6. **Adapters — model resolution.** Write `language-model-adapter.test.ts` /
   `providers.test.ts` cases: (a) omitted `provider` → global provider (no
   change); (b) `provider` override → that provider + its credentials;
   (c) missing credentials → `AI_PROVIDER_FAILED` Result, never a throw.
   Export and test `ALLOWED_MODELS`. Implement `resolveForCall` change.

7. **Web — tRPC.** Extend `flow.update` and `flow.node.update` inputs; add
   `flow.allowedModels`; validate `ModelRef` membership (returns
   `VALIDATION_FAILED`). Add `turn-helpers`/route changes to apply overrides only
   when `flow.advancedMode`. Cover with the existing route/helper tests.

8. **Web — UI.** Flow-level Advanced-mode toggle; gated Advanced section in
   `NodeConfigModal` (threshold slider/input + behaviour select; editable prompt
   reusing the edit/preview toggle and `previewPrompt` seed; two model selectors
   populated from `flow.allowedModels`). Render advanced controls only when the
   flow is advanced.

9. **Version + validate.** Bump `VERSION` and root `package.json#version` to
   `1.19.0`. Run `./validate.sh`; fix all failures. Move this phase doc to
   `docs/development/implemented/alpha-1/v1.19/` with an implementation summary (per the
   `to-be-implemented/` lifecycle).

## 7. Acceptance criteria

Mirror PRD §10. In particular:

- [ ] Simple-mode flows are byte-for-byte unchanged (prompt, threshold default
      90, global model) — guarded by tests asserting the no-override branches.
- [ ] `advanced_mode` column added, additive, backfills `false`; round-trips via
      the repository.
- [ ] `confidenceProgression` supersedes `advanceConfidenceThreshold`;
      `require_confirmation` withholds advancement until confirmation.
- [ ] `promptOverride` rendered with placeholders; `<output>` contract always
      enforced; revert (null) restores the generated prompt.
- [ ] Per-step `chat` and `documentGeneration` model overrides apply at runtime;
      unset falls back to global; doc-gen override only for `generate_document`.
- [ ] `ModelRef` validated against `ALLOWED_MODELS`; missing credentials fail
      safely via Result.
- [ ] Architecture boundaries intact (`domain` dependency-free; allow-list +
      resolution in adapters; Result pattern at boundaries).
- [ ] `VERSION` = `package.json#version` = `1.19.0`; `./validate.sh` passes.

## 8. Risks / open questions

- Exact transport for a `require_confirmation` "confirmation turn" in the chat
  stream (explicit UI action vs. sentinel message) — pin down in step 2/7.
- Placeholder DSL ergonomics and validation messaging for authors.
- Adding `provider?` to three port input types ripples to all `ILanguageModel`
  mocks/implementations — keep additive and update test doubles.
- Curation/ownership of `ALLOWED_MODELS` and handling providers without
  configured credentials in a given environment.
