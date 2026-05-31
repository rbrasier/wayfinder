# PRD — Advanced-Mode Step Configuration

- **Status**: Draft
- **Date**: 2026-05-31
- **Author**: richy.brasier@gmail.com
- **Target version**: 1.19.0  (bump: MINOR — additive `app_flows.advanced_mode` column + new feature; see `docs/guides/versioning.md`)

## 1. Problem

Flow authors today get a single, fixed behaviour for every conversational
step: the system prompt is assembled for them by `FlowSessionGraph.buildSystemPrompt()`,
a step advances the moment AI confidence reaches a hard-coded default (90), and
every step talks to whichever model is set globally in `RuntimeConfigStore`.
Power authors building high-stakes or unusual flows need finer control — to
tune how readily a step advances, to hand-write the prompt a step sends, and to
pick a stronger or cheaper model per step (and for document generation). There
is no way to do any of this, and exposing all of it to every author would
clutter the simple authoring experience that most flows want.

## 2. Users / Personas

- **Flow author / admin** — designs flows on the canvas. Wants optional,
  advanced controls for steps without losing the simple default experience.
  Opts in per flow.
- **End user (runtime)** — runs the flow. Not a direct user of these controls,
  but experiences their effects (advancement pacing, prompt wording, model
  quality/latency).

## 3. Goals

- An author can turn on **Advanced mode** at the **flow** level. When off, the
  step config UI is exactly as it is today. When on, advanced controls appear
  in the step config modal.
- **Confidence progression (per step):** an author can set the advancement
  **threshold** (0–100) and the advancement **behaviour** — `auto_advance`
  (advance immediately once the threshold is met, today's behaviour) or
  `require_confirmation` (pause at the threshold and ask the user to confirm
  before moving on).
- **Generated prompt (per step):** an author can view the auto-generated system
  prompt, switch it to a custom editable prompt seeded from the generated one,
  and have that custom prompt used verbatim (with documented placeholders) when
  the step runs. They can revert to the auto-generated prompt at any time.
- **Model (per step):** an author can choose, from a **curated allow-list**, the
  model used for the step's conversation and the model used for that step's
  document generation. When unset, the global `RuntimeConfigStore` default for
  the purpose is used (today's behaviour).
- All advanced config persists on the node's existing `config` JSON — **no node
  table migration**. Only the flow gains one additive boolean column.
- Turning Advanced mode off does not destroy stored advanced config, but stored
  advanced config is **not applied at runtime** while the flow is in simple
  mode (see §9 / ADR-014).

## 4. Non-goals

- No model **parameters** (temperature, max tokens, top-p). Deferred.
- No retrieval / knowledge-base configuration per step. Deferred.
- No escalation / retry-limit configuration. Deferred.
- No document-**output-format** controls (file type, structured schema,
  template skeleton). Deferred.
- No free-form model IDs — selection is constrained to the allow-list.
- No per-step override of the **branching** model (`AiPurpose: "branching"`).
  Only `chat` and `documentGeneration` are overridable.
- No prompt-snapshot history or diffing beyond what the existing preview offers.
- No change to auto (n8n) node configuration.

## 5. Key entities

| Entity | Lives in | New / existing | Notes |
|--------|----------|----------------|-------|
| `Flow.advancedMode` | `packages/domain/src/entities/flow.ts` | new field | boolean; gates advanced controls |
| `app_flows.advanced_mode` | `packages/adapters/src/db/schema/wayfinder.ts` | new column | `boolean not null default false` — the only migration |
| `ConversationalNodeConfig.confidenceProgression` | `packages/domain/src/entities/flow-node.ts` | new optional field | `{ threshold: number; behaviour: "auto_advance" \| "require_confirmation" }`; stored in `app_flow_nodes.config` jsonb |
| `ConversationalNodeConfig.promptOverride` | `packages/domain/src/entities/flow-node.ts` | new optional field | `string \| null`; when set, used as the step's system prompt |
| `ConversationalNodeConfig.modelOverrides` | `packages/domain/src/entities/flow-node.ts` | new optional field | `{ chat?: ModelRef; documentGeneration?: ModelRef }` |
| `ModelRef` | `packages/domain/src/entities/flow-node.ts` | new | `{ provider: ProviderName; model: string }` |
| Model allow-list | `packages/adapters/src/ai/providers.ts` (`PROVIDERS`) | existing source → new exported list | curated `{ provider, model, label }[]` surfaced to the UI |
| `ConversationalNodeConfig.advanceConfidenceThreshold` | `packages/domain/src/entities/flow-node.ts` | existing | kept as back-compat fallback for `confidenceProgression.threshold` |
| `FlowSessionGraph.buildSystemPrompt()` | `packages/adapters/src/agents/flow-session-graph.ts` | existing | returns `promptOverride` (with placeholders resolved) when present |
| Confidence advancement | `packages/application/src/use-cases/session/run-turn.ts` | existing | honours `behaviour` (gate advance behind confirmation) |
| Model resolution | `packages/adapters/src/ai/language-model-adapter.ts`, `runtime-config-store.ts` | existing | per-call model override threading (ADR-015) |
| `NodeConfigModal` | `apps/web/src/components/canvas/node-config-modal.tsx` | existing | adds gated advanced section; extends existing prompt preview to editable |
| `flow.update` / `flow.node.update` tRPC | `apps/web/src/server/routers/flow.ts` | existing | accept `advancedMode` / new config fields |
| Chat turn wiring | `apps/web/src/app/api/chat/[sessionId]/stream/route.ts` | existing | applies progression + model overrides at runtime |

## 6. User stories

1. As a flow author, I can toggle **Advanced mode** on a flow so that advanced
   step controls become available without affecting flows I want kept simple.
2. As a flow author, in advanced mode I can set a step's confidence **threshold**
   and choose whether it **auto-advances** or **requires my user to confirm**
   before advancing, so that I can pace high-stakes steps appropriately.
3. As a flow author, in advanced mode I can take the auto-generated step prompt,
   edit it, and have my version sent to the AI, so that I can hand-tune wording
   the generator can't express — and revert to the generated prompt if I change
   my mind.
4. As a flow author, in advanced mode I can pick the model used for a step's
   conversation and for that step's document generation from an approved list,
   so that I can trade off cost, latency, and quality per step.
5. As an end user running an advanced-mode step set to `require_confirmation`,
   I am asked to confirm before the flow moves to the next step, so that I stay
   in control of progression.

## 7. Pages / surfaces affected

- `apps/web/src/app/(user)/flows/[id]/config/_content.tsx` and
  `apps/web/src/app/(admin)/admin/flows/[id]/_content.tsx` — surface the
  flow-level **Advanced mode** toggle.
- `apps/web/src/components/canvas/node-config-modal.tsx` — new collapsible
  **Advanced** section (rendered only when the flow is in advanced mode):
  confidence threshold + behaviour, editable prompt (extends the existing
  read-only preview at `view: "edit" | "preview"`), and two model selectors.
- tRPC `flow.update` — accepts `advancedMode: boolean`.
- tRPC `flow.node.update` — accepts `confidenceProgression`, `promptOverride`,
  `modelOverrides` inside the node config payload.
- tRPC `flow.node.previewPrompt` — extended/parallel query to return the
  generated prompt that seeds the editable field (and to render placeholders).
- tRPC `flow.getCanvas` / flow read — returns `advancedMode` and the new config
  fields so the UI can hydrate.
- `apps/web/src/app/api/chat/[sessionId]/stream/route.ts` — applies the
  configured `behaviour`/`threshold` and per-step model overrides at runtime.

## 8. Database changes

| Table | Change | Prefix valid? |
|-------|--------|---------------|
| `app_flows` | add column `advanced_mode boolean not null default false` | n/a (column add) |
| `app_flow_nodes` | **none** — `confidenceProgression`, `promptOverride`, `modelOverrides` stored in existing `config` jsonb | n/a |

Migration is additive and backfills `false`, so existing flows stay in simple
mode. Generated via the project's Drizzle migration workflow.

## 9. Architectural decisions

- **New ADR-014 — Advanced-mode gating & step-configuration storage.** Decides:
  flow-level boolean column as the gate; advanced step config stored in the
  node `config` jsonb (no node migration); and the runtime rule that advanced
  config is **only applied when the owning flow is in advanced mode** (so the
  toggle is meaningful and reversible without data loss).
- **New ADR-015 — Step-level AI overrides (prompt + model).** Decides: the
  prompt-customisation strategy (full editable override seeded from the
  generated prompt, with a documented placeholder contract, vs. structured
  block editing) and how a per-node `ModelRef` is threaded through
  `language-model-adapter` / call sites to override the global
  `RuntimeConfigStore` model per purpose without breaking the adapter boundary.
- Reuses existing ADRs: ADR-002 (multi-provider AI), ADR-004 (LangGraph adapter
  boundary), ADR-006 (flow & session schema), ADR-007 (session-scoped LangGraph).
- The model allow-list is **derived from `PROVIDERS`** in `providers.ts` (the
  single source of truth), surfaced read-only to the UI — authors cannot type
  arbitrary model IDs.

## 10. Acceptance criteria

- [ ] `Flow` gains `advancedMode: boolean`; `app_flows` gains
      `advanced_mode boolean not null default false`; repository read/write maps
      it; existing flows backfill to `false`.
- [ ] Flow config UI shows an **Advanced mode** toggle that persists via
      `flow.update`.
- [ ] When the flow is **not** in advanced mode, `NodeConfigModal` shows no
      advanced controls and runtime behaviour is byte-for-byte unchanged from
      today (same prompt, threshold 90 default, global model).
- [ ] `ConversationalNodeConfig` gains `confidenceProgression`, `promptOverride`,
      and `modelOverrides`, all optional, all stored in `config` jsonb with no
      node migration.
- [ ] In advanced mode, an author can set threshold (0–100) and behaviour;
      `auto_advance` reproduces today's `>= threshold` advance; `require_confirmation`
      makes `run-turn` withhold advancement until an explicit confirmation turn,
      even when confidence ≥ threshold.
- [ ] `confidenceProgression.threshold` takes precedence over the legacy
      `advanceConfidenceThreshold`; when only the legacy field exists, behaviour
      is unchanged.
- [ ] In advanced mode, an author can switch the step prompt to an editable
      field seeded from `buildSystemPrompt()`, save a `promptOverride`, and the
      running step uses that override (with placeholders resolved); clearing it
      reverts to the generated prompt.
- [ ] `buildSystemPrompt()` returns the `promptOverride` (placeholders resolved)
      when present, otherwise the generated prompt — verified by a unit test for
      both branches.
- [ ] In advanced mode, an author can pick a step's `chat` model and
      `documentGeneration` model from the allow-list; at runtime the chosen model
      is used for that step, and `documentGeneration` override applies only when
      `outputType === "generate_document"`.
- [ ] When a model override is unset, resolution falls back to the global
      `RuntimeConfigStore` default for that purpose.
- [ ] Selecting a model whose provider has no configured credentials surfaces a
      clear, non-crashing error path (validation or runtime).
- [ ] Architecture boundaries hold: `domain` stays dependency-free; the model
      allow-list and resolution stay in `adapters`; ports keep the Result pattern.
- [ ] `VERSION` and root `package.json#version` = `1.19.0`; `./validate.sh`
      passes.

## 11. Out of scope / future work

- Model parameters (temperature, max tokens, top-p) per step.
- Per-step retrieval / knowledge-base configuration (pairs with the pgvector
  RAG phase).
- Escalation / retry-limit configuration before handoff.
- Document-output-format controls (file type, structured schema, template).
- Per-step override of the branching model.
- Prompt versioning / history / diff.

## 12. Risks / open questions

- **Prompt override drift**: a saved `promptOverride` won't pick up later
  improvements to the generated base prompt. Mitigation: clearly mark overridden
  steps and offer "re-seed from generated"; documented placeholder contract so
  dynamic context (criteria, reference docs, gathered context) still injects.
- **`require_confirmation` semantics**: needs a precise definition of what a
  "confirmation turn" is in `run-turn`/the chat stream (explicit user action vs.
  next message). To be pinned down in ADR-014 and the phase doc.
- **Model override threading**: `language-model-adapter` currently resolves the
  model per `AiPurpose` from global config; passing a per-call override must not
  leak provider/SDK types across the adapter boundary. ADR-015 resolves the
  exact seam.
- **Credential availability**: an author may pick a model whose provider key
  isn't configured in this environment; needs validation at save time and a safe
  runtime fallback/error.
- **Allow-list staffing**: who curates `PROVIDERS`/allowed models and how often —
  treated as config, not per-flow data.
