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

**1. A proposal is thread-scoped scratchpad state, not a stored record.**

A proposal matters only to the conversation it is being argued out in. It is working state for
that thread and nothing else — so it gets no table, no rows and no migration. It lives for the
thread, and when the thread is done it is gone.

Separation is still the point, and this achieves it more cheaply than a table would: nothing that
reads a flow snapshot can encounter an unconfirmed field set, because an unconfirmed field set is
never written anywhere durable. Confirmation is the single moment the proposal crosses into
authoring config, and it goes through the existing `buildExtractionField` path like any
hand-typed field. That write is the *only* durable effect the whole interaction has.

The alternative considered and rejected was a persisted `app_schema_proposals` table. It would
have bought resumability across threads at the cost of a migration, a retention question, and a
second place where something schema-shaped lives — for state whose value expires with the
conversation.

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

**5. Each refinement turn appends a revision rather than overwriting, within the thread.**

The visible history is what makes the interaction reviewable — a human confirming a schema is
agreeing to a specific state, and seeing how it got there is what makes that agreement informed.
The history lives as long as the thread does and no longer, so there is no retention rule to
write and no growth to cap.

## Consequences

- Every reader of a flow snapshot is unchanged. A proposal is invisible to the runner, the
  generator and the export until confirmation, which is the property that makes this safe to add.
- **No schema change and no migration.** The phase adds behaviour and no storage.
- Confirmation reuses `buildExtractionField`, so a proposed field and a hand-typed field are the
  same object with the same validation. There is no "AI-authored" field variant to maintain.
- The proposer's output is text in the annotation language, which means a bad proposal is
  *readable* as a bad proposal rather than failing opaquely inside a parser.
- Nothing accumulates. There is no retention question, no growth to cap and no cleanup job,
  because nothing outlives the thread.
- The cost is that a proposal cannot be picked up in a later thread. Losing an unconfirmed
  proposal costs one conversation's work and no data, which is the trade being accepted.
- Confirmation is a single write rather than a dual write. Because the proposal has no stored
  status to update, there is no window in which a schema is live while its proposal still reads
  draft — the class of bug a stored proposal would have introduced does not exist.
