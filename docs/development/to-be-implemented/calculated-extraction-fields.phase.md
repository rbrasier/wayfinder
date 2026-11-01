# Phase — Calculated Extraction Fields

- **Status**: Awaiting review
- **Target version**: unassigned (bump: MINOR — new authoring capability; **no schema change,
  no migration** — see §5)
- **PRD**: `docs/development/prd/data-provenance-and-verbatim-governance.prd.md` — the
  *Derived Field Handling* requirement, which its own phase could not deliver
- **ADRs**: ADR-053 (field provenance and dual confidence) — this phase writes the producer
  for a value ADR-053 already defines; ADR-013 (template-field annotations as the lingua
  franca); ADR-033 (extraction authoring config inside the flow snapshot)
- **Covers requirements**: Derived Field Handling

## 1. Problem

Every reader of a calculated field already exists and none of them can ever fire.

The Data Provenance and Verbatim Governance phase (v0.32.0) built `derived` into
`FieldProvenance`, defined `FieldDerivation` as `{ method, sourceKeys }`, carried it on
`ExtractionFieldResult`, routed it to the accuracy confidence scale, tagged such a value
"Calculated" in the result grid, rendered its method and inputs through `derivationSummary`,
cleared it on an operator correction, and exported it in JSON, in the XLSX confidence tab and
in the CSV's `__derivation` column.

What it did not build — and could not — is a way for an author to say a field is calculated.
`ExtractionField` is:

```typescript
export interface ExtractionField {
  field: TemplateField;
  instruction: string;
  doneWhen: string | null;
}
```

— a parsed annotation, a plain-English extraction instruction, and an optional completion
criterion. There is no member on which an author could declare "this field is computed from
those fields", and the extraction prompt has nothing to say about one. So no `derived` value
can be produced, and the requirement's five criteria are unmeetable however good the readers
are.

**This cannot be closed by classifying model output**, which is how the sibling gap for
`verbatim` was closed. Verbatim is decidable from the returned bytes: the value either occurs
in the source text or it does not. Whether a value was *calculated from other fields* is an
authoring intent, and a classifier guessing at it would invent the audit trail the requirement
exists to provide. The producer has to be the author.

## 2. Goals

- An author can declare that an extraction field is calculated from other fields in the same
  schema, in the annotation language they already write.
- The declaration names its inputs by field key and its method in plain English, and both are
  validated against the schema before the flow can be published.
- A calculated field is filled after its inputs are, and the value it produces carries
  `provenance: "derived"` with the `FieldDerivation` the author declared.
- The existing readers light up unchanged — no new rendering, no new export column.

## 3. Non-goals

- **A formula language or calculation engine.** Explicitly out of scope in the provenance PRD
  §11, and still out of scope here. ADR-053 §4 is deliberate: a derivation is *recorded, never
  evaluated*. The model performs the calculation from a plain-English method and its named
  inputs, exactly as it performs an extraction from an instruction; Wayfinder records what was
  claimed, not a proof.
- Derivation across records, or from anything other than fields of the same record.
- Back-filling `derived` onto historical extraction records.
- Derivation on conversational step outputs — extraction records only, per ADR-053.

## 4. Approach

**The declaration rides the annotation, not a new type.** ADR-013 makes the annotation line the
lingua franca, and ADR-052 records the cost of a second route to the same field model. A
calculated field is an ordinary `ExtractionFieldDraft` whose `instruction` is the method and
whose annotation carries the inputs — the exact shape is §6 step 1's first decision, and it
must be readable as text, because a bad derivation should be visible as a bad derivation rather
than fail opaquely in a parser.

**Validation is the part that earns the phase.** A derivation is only meaningful if its inputs
exist, so `parseExtractionSchema` gains a resolution pass: every `sourceKey` must be a key of
another field in the same schema, no field may derive from itself, and the graph must be
acyclic. All three are decidable at authoring time from data the schema already holds, and all
three are `VALIDATION_FAILED` results, never throws.

**Extraction fills derived fields in a second pass.** A derived field's inputs must be settled
before it can be computed, so `extractDocumentFields` cannot fill it in the single keyed call
it makes today. The ordering — one call over source fields, then a second over derived ones
given the first call's values — is the main implementation cost and the main risk (§10).

**Nothing is stored that is not already storable.** `ExtractionFieldResult.derivation` is
already on the type and `app_extraction_records.fields` is already a `jsonb` array of it. The
authoring side lives in the flow snapshot jsonb per ADR-033 §3. Hence no migration.

## 5. Key entities / files

| Path | New / changed | Notes |
| ---- | ------------- | ----- |
| `packages/domain/src/entities/extraction-schema.ts` | changed | `ExtractionField` gains a derivation declaration; `buildExtractionField` parses it; `parseExtractionSchema` resolves and cycle-checks it |
| `packages/domain/src/entities/extraction-derivation.ts` | new | Resolution and cycle detection over the declared graph — pure, and the file the tests are written against first |
| `packages/application/src/use-cases/extraction/extract-document-fields.ts` | changed | Second pass filling derived fields from settled inputs, stamping `provenance: "derived"` and the declared `FieldDerivation` |
| `packages/application/src/use-cases/extraction/build-extraction-prompt.ts` | changed | A `<derived_fields>` block naming each calculated field's method and inputs |
| `apps/web/src/components/extraction/` | changed | The field editor accepts and displays the declaration |

**No adapter change and no migration.** The persisted shape does not move.

## 6. Implementation steps (test-first per CLAUDE.md)

1. **Domain — the declaration and its parse.** Tests first: a field declaring inputs parses;
   one declaring none is an ordinary source field; a malformed declaration is a
   `VALIDATION_FAILED` result quoting what was expected. Then decide and implement the
   annotation shape.
2. **Domain — resolution and cycles.** Tests first: an input key matching no field blocks; a
   field deriving from itself blocks; a two-field cycle blocks; a three-field chain resolves in
   dependency order; a diamond resolves once. Then implement.
3. **Domain — schema validation.** Fold the above into `parseExtractionSchema`, and assert a
   schema whose derivation is unresolvable cannot be built at all.
4. **Application — the second pass.** Tests first, against a fake model: a derived field is
   filled from its inputs' settled values; it carries `provenance: "derived"` and the author's
   `{ method, sourceKeys }`; a derived field whose input the confidence floor blanked is left
   blank rather than computed from a missing value; a derived field is never sent in the first
   call. Then implement.
5. **Application — the prompt.** The `<derived_fields>` block, asserted in the prompt test the
   way the existing field-instruction block is.
6. **Web — authoring surface.** The pure decision extracted to a model module and unit-tested,
   per the convention the v0.32.0 threads established (no jsdom, no `.test.tsx`).
7. **Validate.** `./validate.sh` must exit 0.

## 7. Acceptance criteria

The five criteria from the provenance PRD's *Derived Field Handling*, each now with a producer:

- [ ] Derived fields are visually distinct from source fields — the "Calculated" tag, which
      already exists, becomes reachable.
- [ ] The calculation method is documented and accessible — `derivationSummary` renders the
      author's declared method and inputs.
- [ ] Source-data references are preserved for audit — `sourceKeys` names the fields it read.
- [ ] Derived fields carry a confidence metric appropriate to their kind — accuracy, per
      ADR-053 §2, now demonstrable rather than merely decided.
- [ ] Exports keep derived and source data distinguishable — the `__derivation` column and the
      XLSX confidence tab, which already emit it, carry real values.

Plus, for this phase:

- [ ] A schema whose derivation names a missing field, derives from itself, or forms a cycle
      cannot be published.
- [ ] A derived field is filled only after its inputs are settled.

## 8. Playwright e2e

**Does not qualify**, on the current reading. No group in `e2e-test-policy.md` applies: the
authoring surface is form state and the extraction pass is server-side, with no streaming into
the DOM, no upload or download, no auth lifecycle, and no state surviving a page load. Coverage
sits in `packages/domain` (resolution and cycles) and `packages/application` (the second pass).
Re-check this at build time against the policy rather than inheriting the conclusion.

## 9. Migration

**None.** `ExtractionFieldResult.derivation` is already carried on a `jsonb` column and the
authoring declaration lives in the flow snapshot jsonb (ADR-033 §3). Confirm at build time.

## 10. Risks / open questions

- **A second model call per record raises cost and latency.** The derived pass is a second
  `generateObject` on every record that has a calculated field. Records with none must not pay
  for it, and the generation budget caps still apply.
- **A model that "calculates" by guessing is worse than a blank.** The existing
  `EXTRACTION_CONFIDENCE_FLOOR` applies to the derived pass too, and a derived field whose
  inputs are blank must be left blank rather than computed from nothing.
- **The annotation shape is the open design question.** It must stay readable as text and must
  not collide with the existing `(type) (optional)` annotations. Settle it in step 1 before
  anything downstream is written.
- **`derived` is currently unreachable, and that is deliberate.** Until this phase lands, the
  `FieldDerivation` type, the "Calculated" tag and the `__derivation` export columns are
  correct and unused. They are kept, not deleted — removing them would mean rebuilding
  identical readers here.
