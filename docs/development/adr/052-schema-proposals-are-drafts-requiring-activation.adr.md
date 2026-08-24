# ADR-052 — A Schema Proposal Is a Draft Artefact Requiring Explicit Activation

- **Status**: Proposed (scoped by `collaborative-schema-definition.prd.md`)
- **Date**: 2026-08-24
- **Builds on**: ADR-013 (template-field annotations as the lingua franca), ADR-033 (extraction
  authoring config inside the flow snapshot), ADR-038 (step output types)

## Context

Wayfinder has one existing example of the AI proposing structured configuration for a human:

```typescript
// Proposes prior-step data for a flow with no real sessions to clone … The proposal is
// validated against the declared field types before anything is materialised, so a proposer
// that invents a key or breaks a constraint produces a reported reject rather than a test
// that quietly measures the wrong thing.
export interface ISeedProposer {
  propose(request: SeedProposalRequest): Promise<Result<FlowTestSeed>>;
}
```

— `packages/domain/src/ports/seed-proposer.ts`

That shape — propose, validate against declared types, report rejects rather than materialise —
is the right one, and this ADR reuses it. What it does not settle is *where a proposal lives
while a human is still arguing with it*, which is the new problem: seed proposal is one-shot,
schema definition is explicitly multi-turn.

The existing authoring config offers no home for it. `ExtractionSchema` lives inside the
flow snapshot jsonb (ADR-033 §3), and everything that reads a snapshot treats what it finds as
authoritative. A half-agreed field set stored there is indistinguishable from a real schema
to every downstream reader — the runner, the document generator, the export.

There is also a type already sitting at exactly the right level of doneness:

```typescript
export interface ExtractionFieldDraft {
  label: string;
  annotation: string;
  instruction: string;
  doneWhen: string | null;
}
```

— `packages/domain/src/entities/extraction-schema.ts`, the author-supplied field *before*
parsing, which `buildExtractionField` turns into a real `ExtractionField`.

## Decision

**1. A proposal is a row in a new `app_schema_proposals` table, never a write to the flow
snapshot.**

Separation is the point. Nothing that reads a flow snapshot can encounter an unconfirmed field
set, because an unconfirmed field set is not in a snapshot. Confirmation is the single moment
the proposal crosses into authoring config, and it goes through the existing
`buildExtractionField` path like any hand-typed field.

**2. The proposal carries `ExtractionFieldDraft[]`, not `ExtractionField[]`.**

The draft type is pre-parse by design, which is exactly what an in-progress proposal is. It also
means the AI proposes in the annotation language authors already write
(`Label (date) (optional)`), so the proposal is reviewable as text and reuses the one parser
rather than introducing a second path to the same field model.

**3. Status is `"draft" | "confirmed"`, and `confirmed` is terminal.**

A confirmed proposal is history, not live state — the schema it produced lives in the snapshot
from that moment. Re-opening for further refinement starts a new proposal, so there is never a
question of whether the confirmed thing has since drifted.

**4. Validation runs before confirmation is offered, and blocking findings refuse it.**

Coherence checks are the ones the field model can actually decide: a duplicate derived key, an
annotation the parser rejects, a constraint impossible for the declared type (`maxlen` on a
`yesno`), a `section` or `signature` in a structured set — the last two already rejected by
`validateStructuredFieldSet`. Findings are returned, not thrown, per the Result pattern.

**5. Each refinement turn appends a revision rather than overwriting.**

The visible history is what makes the interaction reviewable — a human confirming a schema is
agreeing to a specific state, and the path to it is the evidence for how it got there. Full
history is retained rather than capped; it is the record of what a person agreed to.

## Consequences

- Every reader of a flow snapshot is unchanged. A proposal is invisible to the runner, the
  generator and the export until confirmation, which is the property that makes this safe to add.
- Confirmation reuses `buildExtractionField`, so a proposed field and a hand-typed field are the
  same object with the same validation. There is no "AI-authored" field variant to maintain.
- The proposer's output is text in the annotation language, which means a bad proposal is
  *readable* as a bad proposal rather than failing opaquely inside a parser.
- Proposals accumulate. They are per-flow, per-author working state with no retention rule of
  their own yet — noted in the PRD as an open question rather than settled here.
- The dual-write risk is real: confirmation writes the snapshot and marks the proposal
  confirmed. It must go through the existing unit of work so a half-applied confirmation cannot
  leave a schema live with its proposal still marked draft.
