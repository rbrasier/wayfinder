# Phase — Collaborative Schema Definition

- **Status**: Implemented (2026-08-28, v0.32.4); **revised 2026-09-01, see §11**
- **Target version**: 0.32.4  (bump: PATCH on the 0.32 line — new feature; **no schema change, no migration**)
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

## 11. Revision — 2026-09-01: the generator becomes the way in

**Version: unchanged at 0.32.4.** The phase has not shipped — it is still the
unmerged `claude/split-schema-definition` line — so this is a revision of work in
flight, not a new release. No schema change and no migration; ADR-052 is
untouched.

### Why

§6 step 7 put the proposal surface *inside* the output card, above the field
editor: an author already looking at a blank field list saw a paragraph of prose,
a bare `<input type="file">` and a Draft button, and had to work out for
themselves that the AI route existed and was worth taking. The interaction was
right and the placement was wrong. The proposal is a **fork in how the schema
gets defined**, not a widget beside the thing it defines — so it is now asked as
a fork, once, when the output card first opens.

### What changed

1. **The output card opens on a two-way choice.** A full-card overlay offers
   *Build from an existing output document or sample* and *Configure manually*.
   It is offered once per editor mount; either choice dismisses it, and neither
   writes anything. A secondary **Generate from sample** control beside the
   *Fields to extract* heading reopens it whenever the author wants it back.

2. **The sample upload leads.** Choosing the AI route shows an upload drop zone
   in the app's own dashed-border style, prominent and above the text box, with
   the intent text now an **optional** instruction field beneath it. Handing over
   the document you already produce *is* the statement of what you need to
   capture, so requiring prose alongside it was a second ask for the same thing.
   `ProposeSchema` now refuses only the case that leaves the proposer nothing to
   read — no intent **and** no documents.

3. **Drafting has a face of its own.** A schema proposal is a long model call;
   a frozen form reads as a hang, so drafting renders as its own step.

4. **The review step shows fields, types and drafted output instructions**, then
   **Back** (secondary) and **Continue** (primary). Continue confirms — the same
   single write ADR-052 §3 describes — and lands the author in the structured
   output editor with the fields and the output instructions pre-filled.

5. **The proposer drafts the output instructions too.** New:
   `SchemaProposalOutput.outputInstruction`, carried per revision on
   `SchemaProposalRevision` so it travels with the field set it was written for,
   and surfaced on `SchemaProposalView`. It is only answerable once the fields are
   known, so it is drafted in the same call rather than a second one that would
   be proposing a layout for a field set it had not seen.

6. **Template output is hidden pending the trial.** The generator is being
   trialled as the supersession of template-derived output — an author who uploads
   the document they already produce gets the same result without the template
   plumbing. Nothing is removed: the mode, the parser, the derived field editor and
   every stored template still work, and a flow already on a template keeps its
   toggle. Only the way to *newly choose* template output is withheld
   (`TEMPLATE_OUTPUT_SELECTABLE` in `editor-cards.tsx`), so nobody starts down a
   path that may not survive the trial. Flip the constant to restore it.

7. **The focus overlays name their step** — "Step 1: Configure Input" and
   "Step 2: Configure Output" — so the two cards read as a sequence rather than
   two independent panels.

### Files

- New: `apps/web/src/components/extraction/schema-generator-overlay.tsx`,
  `apps/web/src/components/extraction/editor-cards-dialogs.tsx`
- Removed: `apps/web/src/components/extraction/schema-proposal-card.tsx` —
  superseded by the overlay
- Reworked: `schema-proposal-panel.tsx` (now the review step),
  `editor-cards.tsx`, `editor-cards-controls.tsx`, `extraction-field-editor.tsx`
- Changed for the drafted output instructions: `schema-proposal.ts`,
  `schema-proposer.ts`, `schema-proposals.ts`, `ai-schema-proposer.ts`,
  `extraction-schema-proposal.ts`

### Judgement calls worth flagging

- **The offer is per mount, not per flow.** There is no stored "has been offered"
  flag — that would be proposal state in a database, which ADR-052 §1 forbids in
  spirit if not in letter. So an author reopening a synthesis that already has
  fields is offered the fork again. One click on *Configure manually* dismisses
  it and nothing is lost, but it is a real cost and a per-user preference would
  be the way to remove it.
- **Redraft was kept on the review step.** The spec named only Back and Continue.
  Refinement is the argue-with-it half of ADR-052 and the whole reason revisions
  exist; dropping it would have left `refineSchema` unreachable from the UI. It
  sits above the two buttons and does not compete with them.
- **`editor-cards.tsx` was split.** The overlay wiring pushed it past the
  700-line warn ratchet, so its two modals moved to `editor-cards-dialogs.tsx`.
