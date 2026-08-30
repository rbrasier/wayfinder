# ADR-051 — Document Composition Is a General Entity; Checkpoint Granularity Is a Configurable, Clamped Setting

> **Rewritten in full — replaces this ADR's prior content, not an amendment
> to it.** The prior decision (session drafts as per-participant rows,
> finalisation on the step output) was scoped to a problem statement PR #262
> withdrew. Nothing from it carries forward as a decision; the entity model
> it produced does not apply here.

- **Status**: Proposed — pending confirmation on PR #262
- **Date**: 2026-08-30
- **Builds on**: ADR-053 (field provenance and dual confidence — reused
  unchanged, not extended), ADR-038 (step output types — `generate_document`
  is the existing surface this attaches to), ADR-033 (extraction flows — the
  sibling batch engine this is deliberately not merged with)
- **Supersedes**: this ADR's own prior content in full

## Context

A single LLM call has a fixed output ceiling. A document that needs to be
larger or more detailed than one call can produce hits that ceiling two
ways: it has more *sections* than one call's output window holds, or a
section is present but under-covered because the model ran out of room
before treating it properly. Both are downstream of the same mechanism, but
a design that only tracks "written vs. not written" per section cannot
represent the second case — a section needing another pass to reach its
target depth looks identical to one that was never touched.

`GenerateDocument` already batches work across calls on the *input* side —
extracting template fields in separate batches to stay under context limits
(`generate-document.ts:173-186`) — but assembles the document itself
deterministically, in one call, from already-resolved values
(`documentGenerator.generate()`, `generate-document.ts:93-97`). There is no
existing mechanism for an LLM to write document *content* across more than
one call. This is new capability, not a fix to something half-working.

## Decision 1 — `DocumentComposition` is a general-purpose entity, not a document-generation-only type

The entity tracks ordered segments, per-segment status and depth, and a
provenance value per segment — agnostic to whether, or how, a segment was
grounded. Hitting this problem at all is a signal that Wayfinder lacks a
general way to let a model work on something bigger than one context
window — accumulate state outside the model, resumable across calls or
sessions. That shape isn't specific to documents: multi-step agents and
multi-agent deliberation setups converge on the same one for the same
reason. `DocumentComposition` is kept generic on purpose so a second
long-lived workflow can reuse it later without rebuilding it, even though
document generation is its only consumer here — see the PRD's §11, which
explicitly declines to build that second consumer speculatively.

## Decision 2 — provenance reuses `FieldProvenance` / `FieldSourceRef` / `FieldConfidence` unchanged; no second taxonomy

Every `CompositionSegment` carries a `provenance: FieldProvenance`
(`"verbatim" | "processed" | "derived" | "human_corrected"`, ADR-053,
`field-provenance.ts:6`), and, where applicable, a `sourceRef: FieldSourceRef`
and `confidence: FieldConfidence` — the exact types ADR-053 already defined,
imported as-is. This is the second consumer of a vocabulary Wayfinder already
committed to for labelling how a value came to exist, not a new taxonomy
invented for this feature. `field-provenance.ts` stays zero-dependency and
is not modified.

**In this phase, a segment's `provenance` is only ever `"processed"` (the
model wrote it) or `"derived"` (mechanically populated, no model judgement)**
— `"verbatim"` is reachable only once a segment can be produced by resolving
a locator against an external source, and no such source is integrated yet
(Decision 5). Nothing about deferring that blocks it: the value is already
defined, a segment simply cannot claim it today.

## Decision 3 — checkpoint granularity is an admin/flow-designer-configurable, clamped setting; not fixed in the architecture

Whether a human confirms every segment, checkpoints at intervals, reviews
once at the end, or never blocks at all is a governance choice that varies
by organisational risk appetite and by what a given flow produces — it is
not something the architecture should answer once for every deployment and
every flow.

**Two existing precedents were checked before designing a new mechanism, and
neither fits:**

- Spend/quota ceilings (ADR-026) dropped org-level ceilings entirely; the
  real model is user/role/global, resolved by most-specific-row-wins, and
  it's checked against actual spend at call time. There is no "author
  proposes a value, admin clamps it" step to borrow.
- MCP tool allowlisting (`ResolveStepTools.execute()`,
  `packages/application/src/use-cases/mcp/mcp.ts:168-188`) is a **filter
  over a set** — admin decides which servers exist and are usable at all,
  the flow author picks a subset of what's permitted. Checkpoint granularity
  is an **ordinal scale** (`per_segment` is stricter than `autonomous`), and
  a subset-filter doesn't express "which of two values is stricter."

**Decision: a new closed, ordered type**

```ts
type CompositionCheckpointGranularity =
  "per_segment" | "per_milestone" | "end_of_run" | "autonomous";
```

set by the flow author on the node (the same authoring pattern as the
existing `ConversationalNodeConfig.requireConfirmation` boolean,
`flow-node.ts:66` — which has no notion of frequency today, so this is new
work, not a repurposing). A new admin setting,
`minimumCheckpointGranularity`, provides a deployment-wide floor, stored the
same way other admin settings already are — a JSON row in
`admin_system_settings`, following the `runtime-config.ts` pattern used by
`UsageLimitsConfig` and `DocumentGenerationConfig`: a tolerant parser and a
safe default. **The default floor is `"autonomous"`** (the loosest), so an
existing deployment that never touches this setting is not retroactively
restricted.

A pure function resolves the two into one value, once, at composition start:

```ts
clampCheckpointGranularity(authored, floor): CompositionCheckpointGranularity
// returns whichever of the two requires more human involvement
```

No most-specific-wins scoping is needed — "the stricter of the two always
wins" is the entire rule. The *resolved* value is what `DocumentComposition`
stores; nothing downstream re-derives it or re-reads the admin setting
mid-run.

## Decision 4 — orchestration limits (context scope and turn ceiling per call) extend `DocumentGenerationConfig`; this is explicitly not a cost/quota mechanism

`ComposeNextSegment` bounds each model call to a narrow slice of context and
caps how many attempts a single segment gets. This is a deliberate technique
for keeping the model's behaviour focused, inspectable, and correctable —
**not** a workaround adopted only because the model's ceiling forces it, and
**not** a cost-control measure. Any reduction in spend is an incidental side
effect, never the justification, and this must not be designed, named, or
described in quota terms.

Wayfinder already draws exactly this line in existing code.
`DocumentGenerationConfig` (`runtime-config.ts:102-114`) is documented as
"Admin-controlled safety limits for document generation... budgeting and
batching," with `fieldBatchSize` (template fields gathered per model call)
and `contextBudgetMode` / `contextBudgetTokens` (how much reference material
a call gets) already doing this for the existing single-shot generator —
kept entirely separate from `ExtractionConfig.perRunCostCeilingUsd`
(`runtime-config.ts:93`), the actual cost-ceiling concept elsewhere in the
same file. The codebase already treats "shape the model's behaviour" and
"cap what it costs" as two different settings; this decision follows that
line rather than crossing it.

**Decision: extend `DocumentGenerationConfig`, do not invent a parallel
config type:**

```ts
export interface DocumentGenerationConfig {
  contextBudgetMode: DocumentGenerationContextBudgetMode;
  contextBudgetTokens: number;
  contextBudgetPercent: number;
  fieldBatchSize: number;
  maxPromptTokens: number;
  // New, for segmented composition:
  compositionSegmentContextScope:
    "section_only" | "recent_segments" | "full_document_so_far";
  compositionRecentSegmentsWindow: number; // used when scope is "recent_segments"
  compositionMaxTurnsPerSegment: number;   // circuit breaker against a
                                            // section that never converges —
                                            // not a spend guard
}
```

This stays a **global admin setting with no flow-level override**, matching
every existing field on this config — nothing today lets a flow author
override `fieldBatchSize` per flow, so a new field on the same config
shouldn't be the first to break that pattern. `ComposeNextSegment` reads it
the same way `GenerateDocument` already reads the config for batching — same
dependency, same pattern, no new wiring concept.

Spend/quota protection (ADR-026/031) still applies to every model call this
feature makes, automatically, because it is enforced at the `ILanguageModel`
decorator level regardless of caller. This decision does not touch that
system, and nothing built from it should be described in its terms.

## Decision 5 — no retrieval-source port in this phase

An earlier draft of this design included an `ISourceRetrievalPort` for
locator-resolved (`verbatim`) segments against an external source. Cut from
this phase: there is no retrieval source to integrate against yet, so a port
with no adapter and no caller would be speculative infrastructure. Phase-1
segments are therefore only ever `"processed"` or `"derived"` (Decision 2).
Nothing here blocks adding the port and an adapter later — `FieldSourceRef`
and the `"verbatim"` provenance value already exist to receive it.

## Decision 6 — segments are rows, not a JSONB array on the composition

`app_document_composition_segments` is a table with one row per segment,
not a JSONB array nested under `app_document_compositions`. A review surface
needs to run `WHERE qa_sampled = false ORDER BY random() LIMIT N` and
`GROUP BY status` at a scale that can reach thousands of segments per
document — both are index-friendly on real rows and require pulling an
entire JSONB blob into application code to compute on a nested array — the
same anti-pattern ADR-054 rejected for CSV export, where widening a shared
port past what a format supports "would mean every CSV call passes a
structure it cannot honour" (`054-csv-is-its-own-writer-port.adr.md:32-33`). A
composition stored as one JSONB document is also a single row rewritten on
every segment write — the same write-amplification concern this ADR's prior
content raised about `app_sessions.version`, recreated one level down had
this shape been chosen.

## Consequences

- A document's full state is now N+1 rows instead of one row — more moving
  parts for a small document, in exchange for a review surface that scales
  to a large one.
- The checkpoint-granularity clamp and the orchestration-limit extension are
  both genuinely new mechanisms with no precedent to lean on in this
  codebase; both need direct, dedicated test coverage rather than coverage
  inherited from an existing pattern.
- `DocumentGenerationConfig`'s existing consumer (`GenerateDocument`) is
  unaffected by the new fields as long as their defaults preserve current
  behaviour — this needs an explicit test, not an assumption.
- The retrieval port and the fuller statistical-sampling review surface are
  deferred, not designed away — see the PRD's §11 for what a future ADR
  would need to add and why neither is needed to ship this one.
- `DocumentComposition`'s generic shape is unproven by a second consumer;
  that is an accepted, deliberate gap rather than evidence the generality
  was unnecessary — see Decision 1.
