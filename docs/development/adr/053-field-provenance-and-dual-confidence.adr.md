# ADR-053 — Provenance Belongs to the Field Result, and Confidence Has Two Meanings

- **Status**: Proposed (scoped by `data-provenance-and-verbatim-governance.prd.md`)
- **Date**: 2026-08-24 (amended 2026-08-30 — §1, `verbatim` is verified rather than inferred)
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
preserves their meaning — the same idiom as `sessionMode`. No back-fill,
and because `app_extraction_records.fields` is already `jsonb().$type<ExtractionFieldResult[]>()`,
no migration either.

### Amendment (0.32.3) — `verbatim` is a verified claim, not an inferred one

The first implementation inferred `verbatim` from substring containment: if the value occurred
byte-identically anywhere in any of the record's source texts, and the field could return source
bytes at all, it was stamped copied.

Containment does not distinguish selection from coincidence. A short composed value — `N/A`,
`None`, a surname — occurs incidentally in any long document, and the consequences of the
mislabel are not cosmetic:

- a copied value is scored on the **selection** scale (§2), so the field silently leaves the
  accuracy pool that §3's per-kind minimum is computed over, and a record's triage band can
  improve because of a coincidence;
- a copied value takes precedence in **merge arbitration** (§3, `outranks`), so an incidental
  match could displace a better-supported composed answer outright, at any confidence.

No length floor closes this. A reference code `A7` is legitimately copied at two characters; a
surname is eight and still incidental. The defect is not the threshold, it is that the code was
*inferring* a claim the model never made.

So the model now makes the claim and the code verifies it. `sourceRef` gains a required `quote` —
the exact characters the model copied — and `verifyVerbatim` replaces `isVerbatimIn`. All four
must hold:

1. the field can return source bytes at all (`returnsSourceBytes`, unchanged);
2. the quote occurs byte-identically in the document the model **named** — not in any of the
   record's documents, in that one;
3. the value occurs inside that quote;
4. that occurrence is word-bounded, so `No` inside `Notice` is not a match.

Steps 2 and 3 stay byte comparisons — no trimming, no case folding, no whitespace collapsing,
each of which is the transformation that makes a value processed rather than copied. Step 4
permits a quote carrying surrounding context, which is the single concession: a model quoting
`Supplier: Acme Ltd (reg. 4482)` for the value `Acme Ltd` has still copied it.

A model that composed a value does not claim to have quoted it, so the coincidence never arises.
A claim that fails verification is refused **silently**: the value is left unstamped, which
already reads as `processed`, and the `sourceRef` is still attached if it resolved — the locator
may well be right even where the quote was mis-transcribed.

`outranks` is unchanged. Cross-scale precedence now means "a *verified* copy beats a
composition", because `verbatim` itself means verified.

The stored `FieldSourceRef.quote` is optional, matching the `provenance?` idiom above: rows
written before this amendment carry a reference with no quote, and a reference the model returns
now always has one. Still no migration — `fields` remains `jsonb`.

**The cost, stated plainly:** `Copied` stamps drop materially. Any value the model does not
explicitly quote is `Composed`, including values it genuinely copied but did not reference. That
is the correct direction for a governance signal — a label that over-claims is worse than one
that under-claims — but it is a visible change in what operators see.

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

**3. Aggregate confidence splits by scale; a single mixed-scale number is not produced.**

Today one function takes the minimum across a record's fields:

```typescript
export const aggregateConfidence = (record: ExtractionRecord): number =>
  record.fields.reduce((lowest, field) => Math.min(lowest, clampConfidence(field.confidence)), 1);
```

Once two kinds exist, that minimum spans two incomparable scales — "how sure am I this is
right" and "how sure am I I picked the right one" — and the smaller number wins regardless of
which question it answers. That is not a conservative aggregate, it is a meaningless one.

So the aggregate is computed **per kind**:

```typescript
export interface AggregateConfidence {
  selection: number | null;
  accuracy: number | null;
}
```

`null` means the record has no fields of that kind, which is different from — and must not be
rendered as — zero. `recordConfidenceBands` returns the matching `{ selection, accuracy }` band
pair. Each scale keeps the existing conservative minimum *within* its own kind, so the triage
behaviour operators already rely on is unchanged for every record that has one kind of field.

The single-number `aggregateConfidence` and single-band `recordConfidenceBand` are removed
rather than deprecated. Leaving them would leave a correct-looking call that silently answers
the wrong question, which is the exact failure this decision exists to prevent.

This does **not** reach storage. `app_extraction_records.aggregate_confidence` is a persisted
`real().notNull().default(0)` column, but the information-architecture investigation required
before any migration (phase doc §10.1) found it to be **write-only**: one writer
(`saveRecordFields`), no reader anywhere — `toRecord` never maps it, and every consumer
recomputes the aggregate from `fields` in memory. So the per-kind split adds no column. Both
aggregates are derived from `fields` in the domain, where the single aggregate already
effectively lived, and no `aggregate_selection_confidence` is created.

The existing column is left untouched and keeps its exact meaning — every historical field is
accuracy-kind, so it *is* the accuracy aggregate. The duplicate adapter implementation
(`aggregateConfidenceOf` in `drizzle-extraction-run-repository.ts`, which omits the domain's
clamp) is still deleted in favour of the domain function, so the two cannot drift again.

**4. Derivation and source reference are recorded structurally, not in prose.**

`FieldDerivation` carries the documented calculation method and the source field keys it read.
`FieldSourceRef` carries a document id and a locator, giving field-level provenance where
`ExtractionRecord.sourceDocumentIds` only reaches record level today. Both are optional and
absent for the ordinary case.

This ADR records a derivation; it does not evaluate one. There is no formula language here.

**5. `verbatimOnly` is a Wayfinder-side guardrail, and claims nothing about the source.**

It mirrors `communicatesExternally` exactly — an admin boolean, `notNull().default(false)`, so
every existing connection keeps its current behaviour. Enforcement sits at the point where a tool
result is folded into the turn, not in the UI.

**The guarantee is deliberately narrow, and stating its limit is part of the decision.** Enabling
it means: *Wayfinder will not transform this connection's tool results — it will select from them
or pass them through unchanged.* It does not mean the data is correct, current, or unmodified
upstream. A broken MCP server, or a wrong record in the system behind it, is outside what
Wayfinder can see or fix, and the toggle must not be presented as covering it. The scope is
Wayfinder's own handling, which is the only thing Wayfinder is in a position to guarantee.

Within that scope, verbatim means byte-identical selection from the tool result. Truncation,
whitespace normalisation, unit conversion and **harmless tidying** all make a value `processed`.
There is deliberately no "close enough" tier: the moment one exists, the guarantee stops being a
byte comparison and becomes an argument about how much change is acceptable. Byte-identical is
the only definition that can be checked rather than argued about, and checking it is entirely a
matter of comparing what Wayfinder received with what it used — no assumption about the source
is required.

## Consequences

- No migration for provenance itself, and no historical row changes meaning. After the §10
  investigation the only schema change in this phase is `verbatim_only`; the aggregate columns
  originally proposed here are not added, because nothing reads the one that already exists.
- Every current reader of `confidence` is, strictly, reading an accuracy metric that may now
  describe a selection. Migrating them to the accessor is mandatory work in this phase, not a
  follow-up — the risk is silent, so it will not surface as a test failure on its own.
- `verbatim` is only ever produced by a model claim this code verified (see the 0.32.3
  amendment to §1). Nothing infers it from the value alone, so a coincidence cannot reach the
  selection scale, the per-kind aggregate, or merge precedence. The cost is fewer `Copied`
  stamps, including on values genuinely copied but never quoted.
- Operator correction becomes machine-readable provenance. `applyFieldEdit` still stamps
  `confidence: 1`, but now alongside `human_corrected`, so the UI can stop presenting a person's
  decision as a model score.
- The four provenance values are a closed set, and exhaustive switches over them will fail to
  compile when a fifth is added. That is deliberate: a new provenance must be considered
  everywhere it is displayed, exported and audited.
- `verbatimOnly` constrains what a flow may do with a connection, so an author who selects a
  verbatim-only tool for a step that composes prose must be refused. That refusal is a real
  authoring-time consequence, not just a runtime one.
- The narrow scope has to survive contact with the UI. Copy that reads as "this data is
  guaranteed accurate" would overclaim; the setting describes Wayfinder's handling and must be
  worded that way wherever it appears.
- Removing the single-number aggregate is a breaking change for every current caller —
  `analytics.ts`, the extraction repository, `result-grid.tsx` and `run-report.tsx`. That breakage
  is the point: each call site has to decide which scale it means, and the compiler now forces
  the question.
