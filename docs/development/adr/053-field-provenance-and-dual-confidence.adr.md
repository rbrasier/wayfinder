# ADR-053 — Provenance Belongs to the Field Result, and Confidence Has Two Meanings

- **Status**: Proposed (scoped by `data-provenance-and-verbatim-governance.prd.md`)
- **Date**: 2026-08-24
- **Builds on**: ADR-024 (operator correction is authoritative), ADR-032 (MCP tool-loop pre-pass
  and its captured tool-call records), ADR-033 (extraction records, confidence and rationale)

## Context

An extracted field carries exactly one signal about where it came from:

```typescript
export interface ExtractionFieldResult {
  key: string;
  value: string;
  confidence: number;
  rationale: string;
}
```

— `packages/domain/src/entities/extraction-record.ts`

`confidence` is documented as a self-assessment produced by the same `generateObject` call as the
value. It answers one question: *is this value correct?* That is the right question for a value
the model composed. It is the wrong question for a value the model copied, where the model is not
assessing correctness at all — the source is what it is — but whether it selected the right one.

The system already contains a provenance it cannot express. Operator correction stamps:

```typescript
? { ...field, value: newValue, confidence: 1, rationale: `Manually corrected${editorNote}.` }
```

A human typed the value, and that is recorded as *the model was maximally confident*. The
rationale string carries the truth, but only as prose — nothing can filter, style or export on
it. The strongest provenance in the system is the least machine-readable.

Meanwhile administrators can classify an MCP connection's reach but not its handling:

```typescript
readonly communicatesExternally: boolean;
```

— `packages/domain/src/entities/mcp-server.ts`, an admin classification with a defaulted column
(`admin_mcp_servers.communicates_externally`, `boolean().notNull().default(false)`). There is no
equivalent for "use this source's results as-is".

## Decision

**1. Provenance is an explicit member of the field result, with four values.**

```typescript
export type FieldProvenance = "verbatim" | "processed" | "derived" | "human_corrected";
```

`verbatim` — selected byte-identically from a tool result. `processed` — composed or transformed
by the model. `derived` — calculated from other fields. `human_corrected` — a person set it,
which outranks everything else and is why it is a provenance rather than a flag.

The member is optional, and absent reads as `processed`:

```typescript
export const fieldProvenance = (result: { provenance?: FieldProvenance }): FieldProvenance =>
  result.provenance ?? "processed";
```

Every historical row was produced by the composing path, so `processed` is the value that
preserves their meaning — the same idiom as `sessionMode` and `stepOutputStatus`. No back-fill,
and because `app_extraction_records.fields` is already `jsonb().$type<ExtractionFieldResult[]>()`,
no migration either.

**2. Confidence kind is derived from provenance, never set independently.**

```typescript
export type ConfidenceKind = "selection" | "accuracy";
```

`verbatim` → `selection`; everything else → `accuracy`. Deriving rather than storing removes the
possibility of a row claiming verbatim provenance with an accuracy metric, which would be a
contradiction no reader could resolve. One function owns the mapping, so the two can never drift.

Readers go through a single accessor returning value *and* kind together. A bare `confidence`
read is the bug this ADR exists to prevent: the number alone no longer means anything without its
kind, and making the accessor the only supported path is what stops an existing caller silently
misreading a verbatim row as an accuracy score.

**3. `aggregateConfidence` stays a triage floor and says so.**

It takes the minimum across a record's fields, which now spans two incomparable scales. Rather
than inventing a weighting, it keeps its existing conservative behaviour and its documentation
states plainly that it is a triage signal across mixed kinds — consistent with ADR-033, which
already calls confidence weakly calibrated and explicitly not a gate.

**4. Derivation and source reference are recorded structurally, not in prose.**

`FieldDerivation` carries the documented calculation method and the source field keys it read.
`FieldSourceRef` carries a document id and a locator, giving field-level provenance where
`ExtractionRecord.sourceDocumentIds` only reaches record level today. Both are optional and
absent for the ordinary case.

This ADR records a derivation; it does not evaluate one. There is no formula language here.

**5. `verbatimOnly` is a per-connection setting enforced where tool results enter the prompt.**

It mirrors `communicatesExternally` exactly — an admin boolean, `notNull().default(false)`, so
every existing connection keeps its current behaviour. Enforcement sits at the point where a tool
result is folded into the turn, not in the UI: a toggle that asserts a guarantee the runtime does
not keep is worse than no toggle.

Verbatim means byte-identical selection from the tool result. Truncation, whitespace
normalisation and unit conversion all make a value `processed`. Drawing the line at
byte-identical is the only definition that can be checked rather than argued about.

## Consequences

- No migration for provenance, and no historical row changes meaning. The `verbatim_only` column
  is the phase's only schema change.
- Every current reader of `confidence` is, strictly, reading an accuracy metric that may now
  describe a selection. Migrating them to the accessor is mandatory work in this phase, not a
  follow-up — the risk is silent, so it will not surface as a test failure on its own.
- Operator correction becomes machine-readable provenance. `applyFieldEdit` still stamps
  `confidence: 1`, but now alongside `human_corrected`, so the UI can stop presenting a person's
  decision as a model score.
- The four provenance values are a closed set, and exhaustive switches over them will fail to
  compile when a fifth is added. That is deliberate: a new provenance must be considered
  everywhere it is displayed, exported and audited.
- `verbatimOnly` constrains what a flow may do with a connection, so an author who selects a
  verbatim-only tool for a step that composes prose must be refused. That refusal is a real
  authoring-time consequence, not just a runtime one.
