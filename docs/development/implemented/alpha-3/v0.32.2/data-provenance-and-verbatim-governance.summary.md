# Implementation Summary — Data Provenance and Verbatim Governance

- **Version**: 0.32.0 — **no bump applied**. The Structured Export thread already
  moved 0.31.0 → 0.32.0 in this PR, and one PR ships one version.
- **Phase doc**: `data-provenance-and-verbatim-governance.phase.md` (this folder)
- **PRD**: `docs/development/prd/data-provenance-and-verbatim-governance.prd.md`
- **ADR**: ADR-053 — provenance belongs to the field result, and confidence has two meanings
- **Landed via**: PR #257 (the AI orchestration and Excel export line), which stays draft
- **Scope built**: the whole phase, §6 steps 1–11, including step 10's export
  columns — the provenance, derivation and source-reference columns the
  Structured Export thread deferred to this phase.

## What was built

### Provenance is a property of the value

`ExtractionFieldResult` gains three optional members — `provenance`, `sourceRef`
and `derivation` — and a new `field-provenance.ts` owns the vocabulary:
`FieldProvenance` (`verbatim | processed | derived | human_corrected`),
`ConfidenceKind` (`selection | accuracy`), `FieldDerivation` and `FieldSourceRef`.

Absent provenance reads as `processed` through `fieldProvenance()`. Every
historical row was produced by the composing path, so that is the value which
preserves their meaning: no back-fill, no migration, and no row changes what it
says. `app_extraction_records.fields` was already
`jsonb().$type<ExtractionFieldResult[]>()`, so the new members ride inside it.

### Confidence kind is derived, never stored

`confidenceKind()` maps `verbatim` → `selection` and the other three → `accuracy`,
and `fieldConfidence()` is the single accessor returning the clamped value, its
kind and its provenance together. Deriving rather than storing removes the
possibility of a row claiming verbatim provenance with an accuracy metric.

### Aggregates split by scale, and the mixed-scale question is gone

`aggregateConfidence` and `recordConfidenceBand` were **deleted**, not deprecated.
In their place `aggregateConfidenceByKind()` returns
`{ selection: number | null, accuracy: number | null }` and
`recordConfidenceBands()` the matching band pair. `null` means the record has no
fields of that kind — different from, and never rendered as, zero. Within a kind
each aggregate keeps the existing conservative minimum, so an all-accuracy record
(every historical record) reports exactly the number it always did.

The deletion was the point: the compiler enumerated the four call sites —
`analytics.ts`, the extraction repository, `result-grid.tsx` and `run-report.tsx` —
and each had to choose a scale deliberately.

### A human correction is recorded as provenance

`applyFieldEdit` still stamps `confidence: 1`, but now alongside
`human_corrected`, so a person's decision stops being indistinguishable from
maximum model confidence. `mergeFieldResults` gained the matching rule: a
`human_corrected` value is never displaced by a model value, which a bare
`confidence >` comparison would have allowed since both carry `1`.

### Verbatim-only handling, enforced twice

`verbatimOnly` mirrors `communicatesExternally` exactly — an admin boolean on
`admin_mcp_servers`, `notNull().default(false)`.

`verbatim-handling.ts` makes the guarantee checkable rather than arguable:

- `classifyToolValueProvenance(received, used)` calls a value `verbatim` only when
  it is byte-identical to the flattened tool result or to a scalar leaf inside it
  when that result is JSON. Selecting one value out of a structured result is
  therefore verbatim; truncation, whitespace normalisation and assembling two
  leaves into one string are all `processed`. There is no "close enough" tier.
- `verbatimTransformViolations(responseFields)` names the response fields that
  cannot return the received bytes — anything not `text`/`narrative`, and anything
  constrained to a fixed option list.

Enforcement sits in two places, mirroring how the classification beside it works:
`PublishFlowVersion` refuses to publish a flow whose MCP step would reshape a
verbatim-only connection's results, and `RunMcpNode` refuses the same config as a
runtime backstop *before* the tool is called, so a governed source is never even
queried by a step that would then rewrite its answer.

### Provenance survives every export

- **JSON** — records are serialised wholesale, so provenance, derivation and
  source reference ride along for free. Asserted rather than assumed.
- **XLSX** — the confidence tab gains `Confidence of` (the kind), `Provenance`,
  `Derivation` and `Source reference` columns. The data tab is untouched: it stays
  values-only so it can still be pasted into a report.
- **CSV** — opens with the data tab's value columns and row order, then appends
  one `<field>__provenance` column per field, plus `__derivation` and `__source`
  columns only for fields some record actually recorded one on. A run with no
  derived fields is not padded with empty columns, and the same data still
  exports byte-identically every time.

### On screen

Each value in the expanded record detail carries a provenance tag — Copied,
Composed, Calculated, Corrected — each with its own label and styling. The
rationale dialog names the metric by kind ("selection confidence" / "accuracy
confidence"), shows the derivation method and the fields it read, and resolves a
source reference to the filename plus locator. Record detail reports one line per
scale the record actually has; a scale it has no fields of is omitted rather than
shown as 0%. The field report's row dot bands on accuracy where the record has any
accuracy-kind field and falls back to selection for an entirely-verbatim record.

The MCP admin screen gains the verbatim toggle beside the external-communication
classification, with a staged two-step confirmation in **both** directions —
turning the guarantee off is the change most worth pausing over.

## Files created

**domain** — `entities/field-provenance.ts` (+ test),
`entities/verbatim-handling.ts` (+ test)
**adapters** — `drizzle/0047_verbatim_only.sql`, `drizzle/meta/0047_snapshot.json`,
`repositories/drizzle-mcp-server-repository.test.ts`
**apps/web** — `components/extraction/field-provenance-display.ts` (+ test),
`components/extraction/field-provenance-detail.tsx`,
`components/admin/verbatim-toggle-model.ts` (+ test)

## Files modified

**domain** — `entities/extraction-record.ts` (+ test), `entities/mcp-server.ts`,
`entities/analytics.ts` (+ test), `entities/index.ts`
**application** — `use-cases/session/run-mcp-node.ts` (+ test),
`use-cases/flow/publish-flow-version.ts`, `use-cases/flow/flow-version.test.ts`,
`use-cases/extraction/export-run-results.ts` (+ test), `use-cases/mcp/mcp.ts` (+ test),
`use-cases/analytics/get-extraction-run-report.test.ts`
**adapters** — `db/schema/admin.ts`, `repositories/drizzle-mcp-server-repository.ts`,
`repositories/drizzle-extraction-run-repository.ts` (+ test),
`drizzle/meta/_journal.json`
**apps/web** — `app/(admin)/admin/mcp-servers/_content.tsx`,
`server/routers/mcp-server.ts`, `lib/container.ts`,
`components/extraction/result-grid.tsx`, `components/extraction/result-grid-model.ts`,
`components/extraction/run-report.tsx`

## Migration

One migration, one defaulted boolean — exactly what the §10 information-architecture
finding left standing:

```sql
-- data-impact: preserved — defaulted boolean column; every existing connection keeps current behaviour
ALTER TABLE "admin_mcp_servers" ADD COLUMN "verbatim_only" boolean DEFAULT false NOT NULL;
```

Generated with `drizzle-kit generate`, never `push`. No column was added to or
altered on `app_extraction_records`: §10.1 found `aggregate_confidence` to be
write-only, so both per-kind aggregates are derived from `fields` in the domain.
The column is untouched and keeps its exact meaning — every historical field is
accuracy-kind, so it *is* the accuracy aggregate — and the adapter's private
`aggregateConfidenceOf` was deleted in favour of `persistedAggregateConfidence`,
which routes through the domain function and so gains the clamp the copy omitted.

## Tests

`./validate.sh` — **25 checks, 0 failures, 3,764 tests**, up from 3,693.

New coverage: 8 provenance-accessor cases and 12 verbatim-handling cases in the
domain, 12 more on `extraction-record` (per-scale aggregates, correction
stamping, the merge rule, floor-preserves-provenance), 2 on the analytics report
row, 3 verbatim cases on `RunMcpNode`, 3 on `PublishFlowVersion`, 2 on the MCP
use cases, 5 on the export use case, 3 on the MCP repository mapping, 5 on the
persisted aggregate, and 24 on the two web model modules.

## E2E

**None written — phase §8 stands.** No group in `e2e-test-policy.md` applies:
provenance styling and the admin toggle are ordinary rendering and form state,
with no streaming, no upload or download, no auth lifecycle, and no state
surviving a page load. Export *download* is already covered by the Structured
Export phase, which owns that surface. Coverage sits where the logic lives —
accessors and aggregates in `packages/domain`, enforcement in
`packages/application`, the defaulted column's mapping in `packages/adapters`,
and toggle copy and provenance display in `apps/web` model tests.

## Deviations from the approved summary

1. **No component test for the toggle or the provenance styling** (phase §6.8,
   §6.9). The repo has no `.test.tsx` files and neither jsdom nor
   testing-library is configured. Followed the established convention instead —
   and the one the Structured Export thread set in this same PR: the pure
   decisions were extracted to `verbatim-toggle-model.ts` and
   `field-provenance-display.ts` and unit-tested, with the markup kept thin.
2. **`confidence-bar.tsx` was left untouched** (listed in phase §5). It renders
   session message and document confidence, which are `SessionStepOutput`
   territory — explicitly a non-goal of this phase. Giving it a `kind` prop no
   caller could pass anything but `"accuracy"` would have been dead code.
   Extraction records are the only place selection confidence exists, and the
   result grid carries the kind-aware label there.
3. **Provenance was not stamped onto the extraction paths.** `extractDocumentFields`
   composes its values, so absent-reads-as-`processed` is already the correct
   answer; writing `provenance: "processed"` explicitly onto every extracted
   field would add a member to every stored row to say what its absence already
   says.
4. **`PublishFlowVersion` gained a required `IMcpServerRepository`** rather than
   an optional one, so the compiler forces the wiring. Container wiring was
   updated to pass `skillsAndMcp.repos.mcpServers`.
5. **The CSV stops mirroring the data tab exactly.** It opens with the same value
   columns and row order, then appends provenance — as the single-table format it
   has nowhere else to put what the workbook keeps on its second tab. Structured
   Export §6.5 anticipated this ("only the table the use case hands it").

## Known limitations

- **Nothing produces `verbatim`, `derived` or `sourceRef` data yet.** This phase
  builds the vocabulary, the enforcement and every reader; the extraction paths
  that would stamp them are a separate change. `RunMcpNode` classifies its own
  output, which is the one producer here.
- **`aggregate_confidence` remains a write-only column.** §10.1 proves it, and
  removing it is a `DROP COLUMN` needing its own `-- data-impact: destructive,
  approved` declaration and its own decision. Noted, deliberately not smuggled in.
- **Criterion "derived fields carry a confidence metric appropriate to their kind"**
  is met by treating `derived` as accuracy-kind (ADR-053 §2). A distinct
  derivation-confidence scale was not introduced.
