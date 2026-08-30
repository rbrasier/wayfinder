# Implementation Summary — Collaborative Schema Definition

- **Version**: 0.32.4 (bump: **PATCH** on the 0.32 line). Split out of PR #257 into
  its own PR. This phase shares no code with the export or provenance splits, so
  it can merge in any order relative to them; the number assumes it merges last.
- **Phase doc**: `collaborative-schema-definition.phase.md` (this folder)
- **PRD**: `docs/development/prd/collaborative-schema-definition.prd.md`
- **ADR**: ADR-052 — a schema proposal is a draft artefact requiring explicit activation
- **Landed via**: PR #257 (the AI orchestration and Excel export line), which stays draft
- **Scope built**: the whole phase, §6 steps 1–9, including §7's parity gap — which
  turned out to be a real divergence, not an assertion.

## What was built

Defining an extraction schema was entirely manual. The AI now drafts a complete
field set from the author's stated intent and sample documents, the author argues
with it across turns with the current schema always visible, and an explicit
confirm materialises it. Nothing takes effect implicitly, and nothing is stored.

### The proposal is thread-local memory and nothing else

This is the whole design, and it is worth being blunt about because the shape
invites a repository. A proposal has **no table, no row, no repository, no
snapshot member and no persisted status**. It lives in the proposal card's own
`useState` and in the request bodies it sends; when the author leaves the page it
is gone. `SchemaProposal`, `SchemaProposalRevision` and `SchemaProposalStatus` are
pure values, and every transition over them is a pure function.

`SchemaProposalStatus` exists for exactly one reason: a second confirm must not
re-materialise the proposal's fields over a set the author has hand-edited since
the first. So `confirmed` is terminal — it refuses both a further refinement and
a second confirm. It is a guard within one conversation, never a lifecycle.

Because there is no stored status, **confirmation is a single write rather than a
dual write**, and the class of bug a stored proposal would have introduced — a
schema live while its proposal still reads draft — does not exist. A failed
snapshot write leaves nothing behind, because there was nothing to leave.

### Confirmation goes through the ordinary save

`ConfirmSchemaProposal` runs the current drafts through `SaveExtractionSchema`,
the same `buildExtractionField` → `parseExtractionSchema` path a hand-typed field
takes. The container holds one instance and shares it, so there is one write path
and no "AI-authored" field variant to maintain. A proposed field and a hand-typed
field are the same object with the same validation.

### Validation reports the whole set, not the first problem

The author is refining a field set; one problem per turn would make the
conversation as long as the number of mistakes. So `validateSchemaProposal`
checks every field and returns findings rather than throwing.

**Blocking** — the coherence checks the field model can actually decide:

- an annotation the parser rejects, quoting the parser's own valid-annotation list
  rather than a second copy of it
- two fields resolving to the same derived key (labels are lowercased and
  snake-cased, so "Supplier Name" and "supplier name" collide)
- a field with no extraction instruction
- a constraint impossible for its type — `(maxlen: N)` on anything but text,
  `(min:)`/`(max:)` on anything but a number or currency. `parseTemplateField`
  applies annotations independently, so `(yesno) (maxlen: 10)` parses cleanly and
  then caps the length of a value that can only be "Yes" or "No"
- a `section` or `signature`, through `validateStructuredFieldSet` itself
- a type the extraction field editor cannot show — see *Deviations* 3

**Advisory**, and never blocking: an options list of one value, which records a
constant rather than a choice.

### The proposer

`AiSchemaProposer` mirrors `AiSeedProposer`: propose, validate against the
declared field model, report findings rather than materialise. It emits the
annotation language authors already write, so a bad proposal is *readable* as a
bad proposal rather than failing opaquely inside a parser. The model proposes
text and never decides the field model — an entry missing a label, an annotation
or an instruction is dropped rather than emitted half-formed, where it would
surface to the author as a parser error about a field they never saw proposed.

The opening proposal and every refinement turn are the same call, with the
current field set shown back, so the proposer amends what stands rather than
being asked to remember it.

**Content and budget.** The proposer reads sample documents through the same
author-gated route a sample run uses, under the same `SAMPLE_MAX_DOCUMENTS`
ceiling, and text is capped per document so one long PDF cannot consume the call.
`userId` and `flowId` are carried so the generation budget caps apply. The flow
name reaching the prompt is read server-side rather than taken from the client —
a display string the caller supplies is not the flow's name. This opens no new
path to document content.

## §7 — Structured Field Definition: one gap, and it was real

The phase expected this requirement to be *asserted, not built*, with one parity
test. The test found an actual divergence.

An extraction field and a conversational structured field (ADR-038
`structuredFields`) reached the same field model down different paths.
`parseExtractionSchema` accepted `(section)` and `(approval)`; the conversational
path rejected both through `validateStructuredFieldSet`. A section is a document
include/omit directive and a signature is an approval slot, and neither means
anything for a value pulled out of a source document — so extraction was simply
more permissive than it intended, and more permissive than its own editor, which
offers neither type.

`parseExtractionSchema` now **calls `validateStructuredFieldSet`** rather than
re-implementing the rejection. `field-annotation-parity.test.ts` drives both
paths from one annotation list — thirteen accepted, eight rejected — so an
annotation newly accepted or rejected on one side fails the suite until the other
side agrees. Sharing the function, not just testing it, is what stops the drift.

Everything else the requirement asks for was already satisfied by `TemplateField`
and `ExtractionField`, and the phase doc §7 records which type meets which
criterion.

## Files created

- `packages/domain/src/entities/schema-proposal.ts` (+ test)
- `packages/domain/src/entities/field-annotation-parity.test.ts`
- `packages/domain/src/ports/schema-proposer.ts`
- `packages/application/src/use-cases/extraction/validate-schema-proposal.ts` (+ test)
- `packages/application/src/use-cases/extraction/schema-proposals.ts` (+ test)
- `packages/adapters/src/ai/ai-schema-proposer.ts` (+ test)
- `apps/web/src/components/extraction/schema-proposal-model.ts` (+ test)
- `apps/web/src/components/extraction/schema-proposal-panel.tsx`
- `apps/web/src/components/extraction/schema-proposal-card.tsx`
- `apps/web/src/server/routers/extraction-schema-proposal.ts`
- `apps/web/src/server/routers/extraction-shared.ts`
- `apps/web/src/lib/read-file-base64.ts`

## Files modified

- `packages/domain/src/entities/extraction-schema.ts` — calls
  `validateStructuredFieldSet` (§7)
- `packages/domain/src/entities/index.ts`, `ports/index.ts` — re-exports
- `packages/application/src/use-cases/extraction/index.ts` — re-exports
- `packages/adapters/src/ai/index.ts` — re-export
- `apps/web/src/server/routers/extraction.ts` — split; spreads the proposal procedures
- `apps/web/src/lib/container-extraction.ts` — wiring, and one shared
  `SaveExtractionSchema`
- `apps/web/src/components/extraction/editor-cards.tsx` — renders the card; uses the
  extracted base64 helper
- `apps/web/src/components/extraction/extraction-editor-model.ts` (+ test) —
  `proposalDraftsToFieldModels`

## Migration

**None.** ADR-052 §1: a proposal gets no table, no rows and no migration, and the
confirmed schema lands in the flow snapshot jsonb the extraction editor already
writes (ADR-033 §3).

## Tests

`./validate.sh` — **25 checks, 0 failures, 3,883 tests**, up from 3,768.

New coverage: 11 proposal-transition cases in the domain, 22 parity cases across
both field-model paths, 14 on `validateSchemaProposal`, 14 on the three use
cases, 9 on the proposer adapter, 16 on the panel model and 4 on
`proposalDraftsToFieldModels`, plus the QA regressions below.

## E2E

**None written — phase §9 stands.** No group in `e2e-test-policy.md` applies: the
proposal exchange is request/response through tRPC, not SSE streaming into the
DOM; there is no file download, no auth lifecycle, and no state surviving a page
load — the proposal deliberately does *not* survive one.

Coverage sits at the layer that owns the logic: proposal transitions and terminal
status in `packages/domain`, validation and confirmation atomicity in
`packages/application`, the proposer's sanitisation in `packages/adapters`, and
the panel's render and disabled-confirm decisions in an `apps/web` model test.

## Deviations from the phase doc

1. **No component tests** (§6 step 7, §9). The repo has no `.test.tsx` files and
   neither jsdom nor testing-library is configured. Followed the convention the
   other two 0.32 threads set: the pure decisions — per-field change against
   the previous revision, the confirm control's disabled state and its stated
   reason, finding order, revision numbering — are extracted to
   `schema-proposal-model.ts` and unit-tested, with the markup left thin.
2. **File layout.** §5 lists `propose-schema.ts`, `refine-schema.ts` and
   `confirm-schema.ts`. The three use cases share a context type, a view type and
   the sample-extraction helper, so they live in one `schema-proposals.ts` rather
   than three files importing each other.
3. **An un-editable field type blocks rather than advises.** Not in the phase
   doc's finding list. `parseExtractionSchema` accepts `narrative`, but the
   extraction field editor offers no narrative type and `templateFieldToModel`
   falls an unshowable type back to `text` — so confirming one would seed the
   editor as Text and the next Save would rewrite the stored schema to match,
   losing the type silently. A proposal must only propose what the author can
   then edit. This is a proposal-level rule; `parseExtractionSchema` is unchanged,
   so parity with the conversational path (which does accept narrative) holds.
4. **The three use cases take sample documents, not extracted text.** §5 implies
   the proposer receives content. Text extraction is an application concern, so
   `ProposeSchema` and `RefineSchemaProposal` hold an `IDocumentExtractor` and
   take the same `SampleInputDocument[]` a sample run does — reusing the route,
   the guard and the ceiling rather than opening a second path to content.
5. **The extraction router was split.** The three procedures pushed
   `extraction.ts` past the 800-line ratchet, so its gates and input contracts
   moved to `extraction-shared.ts` and the proposal procedures to
   `extraction-schema-proposal.ts` — the split `settings.ts` already makes. They
   spread into `extractionRouter`, so they remain `extraction.proposeSchema` and
   friends to every caller.

## QA pass — seven defects found and fixed before this landed

A `/code-review high` over the thread's diff found seven, fixed in `2bfde6e`.
Four are in the provenance producers this thread also added, and the first two
are the same shape as the provenance thread's own QA finding: a guarantee stated
rather than enforced.

1. **Containment alone stamped reshaped values `verbatim`.** A `yesno`, `date`,
   `number`, `currency` or options field reformats what it read by definition, so
   "No" inside "Notice" and an options value inside any heading were reported as
   byte-for-byte copies — on the selection confidence scale, and in the export.
   Containment is now necessary but not sufficient: the field must also be able to
   return source bytes, which is the rule `verbatimTransformViolations` already
   applied to MCP response fields, extracted as `returnsSourceBytes` and shared.
2. **`mergeFieldResults` compared a selection confidence against an accuracy
   one** — the exact cross-scale ranking ADR-053 §3 forbids, unreachable until
   this thread produced the first `verbatim` value. Grounding arbitrates instead:
   a copied value beats a composed one, a human correction beats both, and two
   values of one kind rank on confidence exactly as before. The cost is stated in
   the code: a modestly-confident copy now beats a highly-confident composition.
3. **The export wrote the raw document id** into the source-reference cell — the
   unfollowable locator `resolveSourceRef` exists to prevent. It resolves to the
   filename now, falling back to the id when the listing cannot be read, since a
   reference to a removed document is still evidence.
4. **Two files of the same name in one record** sent every source reference to
   the first. Documents now carry a label unique within the record, used by both
   the prompt and the lookup so the two cannot disagree.
5. **Blankness was tested with `.length`** where `applyConfidenceFloor` uses
   `.trim().length`, so a whitespace-only value was stamped `verbatim`.
6. **A confirmed `narrative` field** seeded the editor as Text — deviation 3.
7. **`confirmSchema` did not invalidate the cached schema** as `saveSchema` does,
   so a later refetch remounted the editor and discarded edits made since.

## Known limitations

- **A proposal cannot be picked up in a later thread.** Accepted deliberately
  (ADR-052): losing an unconfirmed proposal costs one conversation's work and no
  data. This is the trade, not an oversight.
- **`SAMPLE_MAX_DOCUMENTS` (3) bounds what the proposer can read.** A schema for
  a corpus more varied than three documents show is refined by the author rather
  than proposed complete.
- **The card proposes from a fresh file picker, not the flow's staged intake.**
  The staged documents live server-side and the proposal path takes buffers, the
  same shape the sample run takes. Reading the staged set directly is a later
  convenience, not a capability gap.
