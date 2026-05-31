# ADR-014 — Advanced-Mode Gating & Step-Configuration Storage

- **Status**: Proposed
- **Date**: 2026-05-31
- **Builds on**: ADR-006 (jsonb over join tables; flow & session schema),
  ADR-007 (session-scoped LangGraph), ADR-005 (route groups & role model)
- **Paired with**: ADR-015 (step-level AI overrides — prompt + model)

## Context

`/new-feature` scoped a set of advanced step controls for **flow authors**:
configurable confidence progression (threshold **and** behaviour), an editable
generated prompt, and per-step model selection. The product requirement is that
these controls are **opt-in per flow** so the default authoring experience stays
simple, and that the underlying configuration is stored — where possible — on
the node's existing JSON `config`, not in new dedicated columns.

Two storage facts from the codebase shape this ADR:

- `app_flow_nodes.config` is `jsonb` typed as `Record<string, unknown>` and
  surfaced as `ConversationalNodeConfig` (`packages/domain/src/entities/flow-node.ts`).
  It already carries `advanceConfidenceThreshold`. Adding fields here needs **no
  migration**.
- `app_flows` (`packages/adapters/src/db/schema/wayfinder.ts`) has **no** generic
  JSON config blob — it has typed columns (`status`, `visibility`,
  `permissions`, `context_docs`). There is nowhere to hang a flow-level flag
  without either a new column or a new jsonb blob.

This ADR decides the **gate** and the **storage**; ADR-015 decides how the
prompt and model overrides actually take effect at runtime.

## Decision

### 1. Advanced mode is a typed boolean column on the flow

Add a first-class column rather than a generic config blob — the flag is a
single, queryable, schema-meaningful property, consistent with how `status` and
`visibility` are modelled.

```ts
// packages/adapters/src/db/schema/wayfinder.ts — app_flows
advanced_mode: boolean("advanced_mode").notNull().default(false),
```

```ts
// packages/domain/src/entities/flow.ts
export interface Flow {
  // …existing…
  advancedMode: boolean;
}
```

The migration is additive and backfills `false`, so every existing flow stays
in simple mode. This is the **only** schema change in the feature and is what
makes the version bump **MINOR** (1.18.0 → 1.19.0).

`NewFlow` does **not** gain the field — flows are always created in simple mode
and opt in later via `flow.update`.

### 2. Advanced step config lives in the node `config` jsonb (no node migration)

All per-step advanced settings extend `ConversationalNodeConfig`, persisted in
the existing `app_flow_nodes.config` jsonb:

```ts
// packages/domain/src/entities/flow-node.ts
export type ConfidenceBehaviour = "auto_advance" | "require_confirmation";

export interface ConfidenceProgression {
  threshold: number;            // 0–100
  behaviour: ConfidenceBehaviour;
}

export interface ModelRef {
  provider: ProviderName;       // from @rbrasier/domain language-model port
  model: string;                // must be a member of the allow-list (ADR-015)
}

export interface ConversationalNodeConfig {
  // …existing fields…
  advanceConfidenceThreshold?: number;          // legacy; kept (see §3)
  confidenceProgression?: ConfidenceProgression; // NEW
  promptOverride?: string | null;                // NEW (ADR-015)
  modelOverrides?: {                             // NEW (ADR-015)
    chat?: ModelRef;
    documentGeneration?: ModelRef;
  };
}
```

`ProviderName` already lives in `packages/domain/src/ports/language-model.ts`,
so the domain stays dependency-free.

### 3. Confidence: `confidenceProgression` supersedes `advanceConfidenceThreshold`

Today `run-turn` reads `advanceConfidenceThreshold ?? 90` and advances when
`stepCompleteConfidence >= threshold` (`run-turn.ts:86,98`; wired at
`stream/route.ts:195`). To avoid a data migration of existing nodes:

- **Threshold resolution order:** `confidenceProgression.threshold` →
  `advanceConfidenceThreshold` → `90`.
- **Behaviour** defaults to `auto_advance`, which is byte-for-byte today's
  behaviour.
- `require_confirmation` changes `run-turn` so that, even when
  `confidence >= threshold`, the step does **not** advance on the same turn:
  the turn returns `advanced: false` plus an `awaitingConfirmation: true`
  signal, and advancement happens on a subsequent **explicit confirmation
  turn** (a dedicated user action surfaced by the chat stream, not merely the
  next free-text message). The precise confirmation transport is detailed in the
  phase doc; the domain rule is "threshold met ⇒ offer to advance; advance only
  after confirmation".

### 4. Gating rule: advanced config is applied only while the flow is advanced

The flag governs both **editability** and **runtime application**:

- **Editability:** advanced controls render in `NodeConfigModal` only when the
  owning flow has `advancedMode === true`.
- **Runtime:** at the chat-turn call site, advanced fields
  (`confidenceProgression.behaviour`, `promptOverride`, `modelOverrides`) are
  read **only if** `flow.advancedMode` is true. When the flow is in simple mode,
  the runtime ignores them and falls back to today's defaults (generated prompt,
  threshold-from-legacy-or-90 with `auto_advance`, global model).

Consequently, **turning advanced mode off is non-destructive but inert**: stored
overrides remain on the node `config` and reappear if the author re-enables
advanced mode, but they have no effect while the flow is simple. This keeps the
toggle meaningful (off truly means "behave like a simple flow") without erasing
the author's work.

> Exception for back-compat: the **threshold** value alone continues to be
> honoured in simple mode via the legacy `advanceConfidenceThreshold` path, so
> flows that set a custom threshold before this feature are unaffected. Only the
> *new* advanced fields are gated.

### 5. Read/write plumbing

- `IFlowRepository` mapping adds `advancedMode` ↔ `advanced_mode`.
- `flow.update` tRPC accepts `advancedMode`; `flow.getCanvas` / flow reads return
  it plus the new node `config` fields for UI hydration.
- `flow.node.update` accepts `confidenceProgression`, `promptOverride`,
  `modelOverrides` within the existing node-config payload; no new procedure.
- All boundaries keep the Result pattern; no new ports are introduced by this
  ADR (ADR-015 covers the model-resolution seam).

## Consequences

**Positive**

- One additive column; everything else rides on existing jsonb — minimal schema
  surface, consistent with ADR-006.
- Simple flows are provably unchanged: gating short-circuits all new behaviour.
- The toggle is reversible without data loss; authors can experiment freely.
- Back-compat for existing custom thresholds is explicit, not accidental.

**Negative**

- A node can hold "orphaned" advanced config that is invisible/inert while the
  flow is simple — potential confusion if a flow is toggled off then on. Mitigated
  by UI affordances that show which steps carry overrides.
- `require_confirmation` adds a new control-flow state to `run-turn` and the chat
  stream that must be covered by tests (threshold met but not advanced; advance
  on confirmation; no double-advance).
- The "gated at runtime" rule means the same node `config` produces different
  behaviour depending on a *flow* field — call sites must read both. Centralised
  in the stream route to avoid divergence.

## Deferred (not this ADR)

- Model parameters, retrieval/KB config, escalation limits, document-output
  formats (PRD §11).
- Per-flow audit/history of advanced-mode toggles.
- The prompt-override and model-resolution mechanics — see ADR-015.
