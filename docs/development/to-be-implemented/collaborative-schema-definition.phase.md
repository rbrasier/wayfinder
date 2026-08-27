# Phase — Collaborative Schema Definition

- **Status**: Awaiting review
- **Target version**: 0.32.0  (bump: MINOR — new feature; **no schema change, no migration**)
- **PRD**: `docs/development/prd/collaborative-schema-definition.prd.md`
- **ADRs**: ADR-052 (schema proposals are drafts requiring activation)
- **Depends on**: ADR-013 (annotation lingua franca), ADR-033 (extraction authoring config),
  ADR-038 (step output types)
- **Covers requirements**: Collaborative Schema Definition; Structured Field Definition
  (verified as already met — see §7)

## 1. Problem

Defining an extraction schema is entirely manual, even though the conversation that prompted it
and the sample documents it will run against already imply most of the fields. Wayfinder has the
right interaction shape elsewhere — `ISeedProposer` proposes, validates against declared types
and reports rejects — but nothing equivalent exists for schemas. See the PRD.

## 2. Goals

- The AI drafts a complete field set from conversation context and sample data.
- The human refines it across turns without losing state, with the current schema always visible.
- Coherence is validated before confirmation is possible.
- Activation requires an explicit human confirm; nothing takes effect implicitly.

## 3. Non-goals

- Replacing the manual extraction editor.
- Proposing input/output config — fields only.
- Rebuilding the field model. **Structured Field Definition is already satisfied** by
  `TemplateField` and `ExtractionField`; this phase asserts that in tests and closes one parity
  gap (§7), and builds nothing new for it.

## 4. Approach

A proposal is thread-scoped scratchpad state holding `ExtractionFieldDraft[]` — the pre-parse
author type that already exists. It is never stored and never written into the flow snapshot, so
no snapshot reader can encounter an unconfirmed field set (ADR-052). Confirmation runs the drafts
through the existing `buildExtractionField` path, so a proposed field and a hand-typed field end
up identical. Because the proposal has no stored status, confirmation is a single write rather
than a dual write, and the "schema live while its proposal still reads draft" bug cannot occur.

**The proposal's own status and revision history are in-memory thread state and nothing more.**
`SchemaProposalStatus` exists so a second confirm cannot re-materialise a schema over a set of
fields the author has since hand-edited — it is a guard within one conversation, never a column,
a row or a snapshot member. No repository, no table, no migration: when the thread ends, the
status ends with it. Read every mention of `draft` and `confirmed` below in that light.

The proposer emits the annotation language authors already write (`Label (date) (optional)`),
reusing `parseTemplateField` rather than adding a second route to the same field model.

## 5. Key entities / files

| Path | New / changed | Notes |
| ---- | ------------- | ----- |
| `packages/domain/src/entities/schema-proposal.ts` | new | `SchemaProposal`, `SchemaProposalStatus`, `SchemaProposalRevision` — **in-memory thread state; never persisted, never written to the snapshot** |
| `packages/domain/src/ports/schema-proposer.ts` | new | `ISchemaProposer`, mirroring `ISeedProposer` |
| `packages/domain/src/entities/index.ts`, `ports/index.ts` | changed | Re-exports |
| `packages/application/src/use-cases/extraction/propose-schema.ts` | new | Proposal from context + samples |
| `packages/application/src/use-cases/extraction/refine-schema.ts` | new | One refinement turn, appends a revision |
| `packages/application/src/use-cases/extraction/confirm-schema.ts` | new | Validate, materialise into the flow snapshot, close the in-memory proposal against a second confirm |
| `packages/application/src/use-cases/extraction/validate-schema-proposal.ts` | new | Blocking vs advisory findings |
| `packages/adapters/src/ai/schema-proposer.ts` | new | `ISchemaProposer` over the language model |
| `apps/web/src/server/routers/extraction.ts` | changed | `proposeSchema`, `refineSchema`, `confirmSchema` |
| `apps/web/src/components/extraction/` | changed | Proposal panel, revision diff, confirm control |

## 6. Implementation steps (test-first per CLAUDE.md)

1. **Domain — proposal entity, held in memory.** Write `schema-proposal.test.ts` first: (a) a
   new proposal is `draft`; (b) appending a revision preserves earlier ones in order;
   (c) confirming a proposal with a blocking finding is refused; (d) `confirmed` is terminal — a
   second confirm is rejected. Then add the entity and its transitions. Pure, no dependencies.

   The transitions are a guard over thread-local state, not a persisted lifecycle. **Do not add a
   repository, a table or a snapshot member for any of it** — if the build reaches for one, the
   design has been misread (ADR-052, §4 above).

2. **Domain — proposer port.** Add `ISchemaProposer`. Type-only. No repository port: a proposal
   is never stored.

3. **Application — validation.** Write `validate-schema-proposal.test.ts` first: (a) a duplicate
   derived key blocks; (b) an annotation the parser rejects blocks, quoting the parser's own
   valid-annotation list; (c) a constraint impossible for the type (`maxlen` on `yesno`) blocks;
   (d) `section` and `signature` in a structured set block, matching
   `validateStructuredFieldSet`; (e) a coherent set returns no blocking findings. Then implement.

4. **Application — propose and refine.** Tests first, against an in-memory fake proposer:
   (a) a proposal returns drafts with types and instructions populated; (b) refinement appends a
   revision and updates current state; (c) a proposer that emits an unparseable annotation
   produces a reported finding, not a thrown error; (d) reads return current state so the UI can
   always render it. Then implement.

5. **Application — confirm.** Tests first: (a) confirmation refuses while a blocking finding is
   open; (b) on success the drafts go through `buildExtractionField` and land in the snapshot;
   (c) a failed snapshot write leaves nothing behind — there is no stored proposal state to
   become inconsistent with it. Then implement.

6. **Adapters — proposer only.** Implement `ISchemaProposer` over the language model, verifying
   the SDK call shape in `node_modules` rather than from memory. Respect the existing generation
   budget caps. **No schema change and no migration in this phase.**

7. **Web — proposal surface.** Component tests first: the panel renders current schema state,
   shows per-field change against the previous revision, and disables confirm while a blocking
   finding is open. Then wire the three procedures.

8. **Parity assertion for Structured Field Definition (§7).** No new types.

9. **Validate.** Run `./validate.sh` after each sub-component; do not proceed on a non-zero exit.

## 7. Structured Field Definition — already met, asserted not built

Every criterion of this requirement is satisfied by an existing type. This phase records which,
and adds tests that keep it true:

| Criterion | Satisfied by |
| --------- | ------------ |
| Type selection from validated options | `TemplateFieldType` + `parseTemplateField`, which rejects unknown annotations against a published valid list |
| Required status per field | `TemplateField.optional` |
| Validation constraints per type | `maxLength`, `max`, `min`, `options`, `multiple` — parsed and type-checked |
| Instruction text for extraction guidance | `TemplateField.instruction`, `ExtractionField.instruction` |
| Definitions persist through editing | `sync-flow-draft.ts` + extraction config in the flow snapshot (ADR-033 §3) |

**The one gap** — an extraction field and a conversational structured field (ADR-038
`structuredFields`) reach the same field model by different paths. Add a shared test asserting
both accept the same annotation set and reject the same ones, so the two cannot drift. This is
the only build work this requirement generates.

## 8. Acceptance criteria

Mirrors PRD §10. Restated as the build's test plan:

- [ ] A proposal returns a complete `ExtractionFieldDraft[]` with types and instructions filled.
- [ ] Refinement appends a revision; earlier revisions stay readable; current state is always returned.
- [ ] Confirmation is refused while any blocking finding is open.
- [ ] Confirmation materialises through `buildExtractionField`; a failed write leaves no
      partial state, since nothing about the proposal is stored.
- [ ] `confirmed` is terminal within the thread; no proposal reaches a snapshot without an
      explicit confirm, and no proposal state is persisted anywhere.
- [ ] Extraction fields and conversational structured fields accept and reject the same annotations.

## 9. Playwright e2e

**Does not qualify.** No group in `e2e-test-policy.md` applies: the proposal exchange is not SSE
streaming into the DOM (it is request/response through tRPC), involves no file upload or
download, no auth lifecycle, and no state surviving a document load.

Coverage sits at the layer that owns the logic — proposal transitions and terminal status in
`packages/domain` (step 1), validation and confirmation atomicity in `packages/application`
(steps 3–5), and the panel's render and disabled-confirm behaviour in an `apps/web` component
test (step 7).

## 10. Risks / open questions

- **A confident wrong schema is worse than a blank editor.** Mitigated by validation before
  confirm and the mandatory confirmation step; the proposal is never authoritative.
- **An unconfirmed proposal dies with its thread.** Accepted deliberately (ADR-052): the state
  is only meaningful inside the conversation that produced it. The cost is one conversation's
  work, never data.
- **Sample-data exposure.** The proposer reads sample document content and must respect existing
  document access checks and generation budget caps rather than opening a new path to content.
- **Revision growth is not a risk here.** History lives as long as the thread and no longer, so
  there is nothing to cap, expire or clean up.
