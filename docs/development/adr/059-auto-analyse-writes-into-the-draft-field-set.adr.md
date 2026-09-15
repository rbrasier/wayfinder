# ADR-059 — Auto Analyse Writes Into the Draft Field Set

- **Status**: Proposed (scoped by `auto-analyse-synthesis.prd.md`)
- **Date**: 2026-09-15
- **Supersedes**: ADR-052 (a schema proposal is a draft artefact requiring explicit activation)
- **Builds on**: ADR-013 (template-field annotations as the lingua franca),
  `033-extraction-flows.adr.md` §3 (extraction authoring config inside the flow snapshot — cited by
  filename because a second, unrelated ADR-033 exists)

## Context

ADR-052 settled where an AI-proposed field set lives while a human is still arguing with it. Its
answer was: nowhere durable. A proposal was thread-scoped scratchpad state, and the single moment
it crossed into authoring config was an explicit human confirm.

That answer was correct for the interaction it was designed around. `collaborative-schema-definition`
planned a chat thread in which the AI proposed a field set, the human pushed back over several
turns, and a confirm control marked the argument settled. A proposal in that world has a genuine
lifecycle — it is provisional, it is contested, and "has the human agreed yet?" is a real question
with a real answer.

Issue #296 asks for something with a different shape. There is no thread and no argument. A user
uploads documents; the AI reads them and drafts fields; the user then edits those fields in the
ordinary field editor. Nothing distinguishes "the AI's proposal" from "the schema I am working on"
because they are the same object at different moments — the user's first act on a drafted field is
to rename it, and their second is to change its type.

Holding that in thread-scoped scratchpad state would mean building a confirm step the feature does
not want, in order to protect an invariant that, on inspection, the draft does not need:

```typescript
// Validates the authored schema and stores it in the flow's open draft version
// snapshot (ADR-033 §3) — no new authoring tables. Publishing later promotes
// this draft unchanged.
export class SaveExtractionSchema {
```

— `packages/application/src/use-cases/flow/extraction-authoring.ts`

The draft version *is* the scratchpad. It is not read by the runner, the document generator or the
export; those read the published version. ADR-052's fear — "a half-agreed field set stored there is
indistinguishable from a real schema to every downstream reader" — describes the *snapshot* being
authoritative, and the open draft snapshot is precisely the one that is not.

## Decision

**1. An analysis writes its proposed fields straight into the open draft field set.**

There is no proposal object, no proposal status and no confirm control. `ProposeExtractionFields`
produces `ExtractionFieldDraft[]` and they go through `buildExtractionField` and into the draft
snapshot by the same path a hand-typed field takes. A drafted field and a typed field are
indistinguishable afterwards because they are the same thing.

**2. Publish is the activation gate, and it already exists.**

ADR-052 was right that AI-proposed configuration must not take effect implicitly. It does not here:
a draft field set changes no run, no generated document and no export until the author publishes.
The gate ADR-052 wanted is the gate the flow already has, one level further out.

**3. Analysis appends and fills; it never overwrites.**

A field the author has touched by hand is authoritative over anything an analysis proposes. An
analysis adds fields that are not already present and leaves every existing field alone. This is
what makes a direct write safe without a confirm step: the worst outcome of an unwanted analysis is
extra fields to delete, never lost work.

**4. A failed analysis writes nothing.**

The merge is all-or-nothing. A proposer that errors, times out or returns an unparseable annotation
leaves the draft field set byte-identical to what it was before, and surfaces a retry.

## Consequences

- The confirm-before-activation machinery ADR-052 specified is not built: no `SchemaProposal`
  entity, no `SchemaProposalStatus`, no revision list, no `confirm-schema` use case.
- `collaborative-schema-definition.phase.md` and `collaborative-schema-definition.prd.md` are
  retired, and ADR-052 is marked superseded by this ADR.
- The never-overwrite rule (§3) carries the safety burden the confirm step used to carry, so it
  needs to be genuinely reliable rather than best-effort.
- Should conversational, multi-turn schema refinement be wanted later, it will be re-planned
  against `IFieldProposer` rather than resurrected from ADR-052's design.
- One thing ADR-052 established is kept unchanged and deliberately: the proposer emits the
  annotation language authors already write, so `parseTemplateField` remains the single route into
  the field model.
- ADR-052 is cited as precedent by ADR-057, `flow-memory.prd.md` and
  `calculated-extraction-fields.phase.md`. Those citations survive: what they take from it is the
  propose/validate/report-rejects discipline and the cost of a second route to the field model,
  neither of which this ADR touches. Only its durability answer — where a proposal lives before a
  human agrees — is reversed, and only for the Auto Analyse path. ADR-057's own durability
  reasoning stands on its own terms and is not reopened here.
