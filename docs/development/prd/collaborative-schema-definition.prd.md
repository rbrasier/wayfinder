# PRD — Collaborative Schema Definition

- **Status**: Draft
- **Date**: 2026-08-24
- **Author**: rbrasier
- **Target version**: 0.32.0  (bump: MINOR — new feature; **no schema change, no migration**)

## 1. Problem

Defining a structured output schema today is entirely manual. An author opens the extraction
editor and types every field, its annotation, its instruction and its completion criterion by
hand, with nothing to start from — even when the conversation that prompted the schema, and the
sample documents it will run against, already say most of what the fields should be.

That is the wrong way round for the persona the product exists for. A procurement officer can
describe what they need in a sentence; turning that sentence into a validated field set is
exactly the work an AI should draft and a human should approve.

Wayfinder already has the shape of this interaction elsewhere: `ISeedProposer` proposes
plausible prior-step data for a flow with no sessions, validates the proposal against declared
field types, and reports rejects rather than materialising something wrong. Schema definition
has no equivalent.

## 2. Users / Personas

- **Flow author** (business analyst, ops lead) — describes the output they need in conversation
  and wants a first-draft schema to react to rather than a blank editor.
- **Operator** — benefits indirectly: a schema drafted against real sample data extracts better
  than one guessed at authoring time.

## 3. Goals

- The AI proposes a complete first-draft schema from conversation context and sample data.
- The human refines that proposal across as many turns as they want, without losing state.
- The current schema state is visible at every point in the conversation.
- The proposal is validated for coherence before it can be confirmed.
- Nothing activates without an explicit human confirmation step.

## 4. Non-goals

- Replacing the manual extraction editor — the proposal feeds it; it does not supersede it.
- Automatically re-proposing when sample data changes.
- Proposing the input/output config (`ExtractionInputConfig`, `ExtractionOutputConfig`) —
  fields only in this phase.
- Any change to how a confirmed schema is executed. Once activated it is an ordinary
  `ExtractionSchema` and the runner cannot tell it was proposed.

## 5. Key entities

| Entity | Lives in | New / existing | Notes |
| ------ | -------- | -------------- | ----- |
| `SchemaProposal` | `packages/domain/src/entities/schema-proposal.ts` | new | Thread-scoped scratchpad state: draft field set + status + validation findings. Not persisted |
| `SchemaProposalStatus` | same file | new | `"draft" \| "confirmed"` — confirmed is terminal |
| `SchemaProposalRevision` | same file | new | One turn of refinement, for the visible history |
| `ISchemaProposer` | `packages/domain/src/ports/schema-proposer.ts` | new | Mirrors `ISeedProposer`: propose, validate, report rejects |
| — | — | — | **No repository port.** A proposal is never stored |
| `ExtractionFieldDraft` | `packages/domain/src/entities/extraction-schema.ts` | existing | The proposal's output shape — already the pre-parse author type |
| `TemplateField` | `packages/domain/src/entities/template-field.ts` | existing | Carries type, `optional`, `min`/`max`/`maxLength`/`options`, `instruction` |

## 6. User stories

1. As a flow author, I describe the output I need and receive a drafted field set with types
   and instructions already filled in, so that I start from something rather than nothing.
2. As a flow author, I can say "make the date field optional and add a supplier reference" and
   see the schema update, so that refinement is conversational rather than form-filling.
3. As a flow author, I can see the current schema at any point in the conversation, so that I
   always know what I am agreeing to.
4. As a flow author, I am told when the schema is incoherent — a duplicate key, a constraint
   that cannot hold for the type — before I am allowed to confirm it.
5. As a flow author, nothing takes effect until I explicitly confirm, so that a proposal can
   never quietly become the live schema.

## 7. Pages / surfaces affected

- Extraction authoring surface (`apps/web/src/components/extraction/`) — proposal panel showing
  current schema state, per-field diff against the previous revision, and a confirm control.
- tRPC: `extraction.proposeSchema`, `extraction.refineSchema`, `extraction.confirmSchema` (added).

## 8. Database changes

**None.** A proposal is scratchpad state for the thread it is being worked out in, so it is never
written to storage (ADR-052). The only durable effect of the whole interaction is the confirmed
schema landing in the flow snapshot, through the path that already exists for hand-typed fields.

No table, no migration, no retention rule.

## 9. Architectural decisions

- **New:** ADR-052 — a schema proposal is a draft artefact that requires explicit activation,
  and is validated before it can be confirmed.
- **Assumes:** ADR-013 (template-field annotations as the lingua franca), ADR-033 (extraction
  authoring config inside the flow snapshot), ADR-038 (step output types).
- **Precedent followed:** `ISeedProposer` (`packages/domain/src/ports/seed-proposer.ts`) —
  propose, validate against declared types, report rejects rather than materialise.

## 10. Acceptance criteria

**Requirement: Collaborative Schema Definition**

- [ ] The proposer returns a complete `ExtractionFieldDraft[]` from conversation context plus
      sample data, with types and instructions populated.
- [ ] A refinement turn updates the proposal and appends a `SchemaProposalRevision`; earlier
      revisions remain readable.
- [ ] The current schema state is returned by every proposal read, so the UI can show it at any
      point in the conversation.
- [ ] Confirmation is refused while any blocking validation finding is open.
- [ ] A proposal never becomes an `ExtractionSchema` without an explicit confirm call;
      `status: "confirmed"` is terminal.

**Requirement: Structured Field Definition — already satisfied, verified not built**

Each criterion is met by an existing type. This phase asserts them in tests and closes the one
parity gap; it does not rebuild them.

- [ ] Field type selection from validated options — `TemplateFieldType`, rejected at parse time
      by `parseTemplateField` with the valid-annotation list.
- [ ] Required status per field — `TemplateField.optional`.
- [ ] Validation constraints per type — `maxLength`, `max`, `min`, `options`, `multiple`,
      enforced per type by the annotation parser.
- [ ] Instruction text for extraction guidance — `TemplateField.instruction` and
      `ExtractionField.instruction`.
- [ ] Definitions persist through editing — `sync-flow-draft.ts` and the extraction authoring
      config in the flow snapshot.
- [ ] **Parity gap (the only build work here):** a conversational structured step
      (`structuredFields`, ADR-038) and an extraction field reach the same field model by
      different paths. Assert both accept the same annotations and reject the same ones.

## 11. Out of scope / future work

- Proposing input/output config, not just fields.
- Re-proposing automatically when sample documents change.
- Sharing a proposal between authors, or concurrent editing of one proposal.
- Resuming an unconfirmed proposal in a later thread. A proposal expires with its conversation;
  the cost of losing one is a conversation's work and no data.

## 12. Risks / open questions

- **A confident wrong schema is worse than a blank editor.** Mitigated by validation before
  confirm and by the mandatory human confirmation step — the proposal is never authoritative.
- **Sample-data leakage.** The proposer sees sample document content; it must respect the same
  budget caps as other model calls, and its input must not bypass existing document access checks.
- **Revision growth — no longer a question.** History lives as long as the thread and no longer,
  so there is nothing to cap, expire or clean up.
- **An unconfirmed proposal is lost when the thread ends.** Accepted deliberately: the state is
  only meaningful inside the conversation that produced it, and the alternative bought
  resumability at the price of a migration and a retention rule.
