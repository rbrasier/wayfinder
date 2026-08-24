# Phase — Data Provenance and Verbatim Governance

- **Status**: Awaiting review
- **Target version**: 0.32.0  (bump: MINOR — additive `admin_mcp_servers.verbatim_only` column,
  aggregate-confidence columns on `app_extraction_records`, + new feature)
- **PRD**: `docs/development/prd/data-provenance-and-verbatim-governance.prd.md`
- **ADRs**: ADR-053 (field provenance and dual confidence)
- **Depends on**: ADR-024 (operator correction authoritative), ADR-032 (MCP tool-loop pre-pass),
  ADR-033 (extraction records, confidence and rationale)
- **Covers requirements**: Verbatim Processing Control; Provenance Differentiation;
  Derived Field Handling

## 1. Problem

`ExtractionFieldResult` carries one `confidence`, meaning accuracy, applied uniformly to values
reached in completely different ways. Copied and composed values are indistinguishable; human
corrections are stamped `confidence: 1` and so masquerade as model certainty; and an
administrator can classify an MCP connection's reach (`communicatesExternally`) but cannot
require that its results are used as-is. "Verbatim" exists nowhere in the codebase as a
governance concept. See the PRD.

## 2. Goals

- Per-connection verbatim-only enforcement of *Wayfinder's own handling*, confirmed before it
  changes, and worded so it claims nothing about the source's correctness.
- Selection confidence for verbatim fields, accuracy confidence for processed ones, never mixed —
  including in aggregates, which are reported per scale.
- Derived fields distinguishable, with their method and source keys recorded.
- Human corrections recorded as provenance rather than as maximum confidence.
- Provenance preserved through every export format.

## 3. Non-goals

- Back-filling provenance onto historical records — absent reads as `processed`.
- A formula language or calculation engine; a derivation is recorded, not evaluated.
- Verbatim enforcement for uploads, RAG chunks or lookup sources.
- Detecting or compensating for a broken MCP server or bad data in the system behind it. That is
  outside what Wayfinder can see, and the toggle must not imply otherwise.
- Provenance on `SessionStepOutput` — extraction records only.

## 4. Approach

Provenance becomes an optional member of `ExtractionFieldResult`, read through an accessor that
treats absent as `processed`. Because `app_extraction_records.fields` is already
`jsonb().$type<ExtractionFieldResult[]>()`, this needs no migration and changes no historical row.

Confidence kind is *derived* from provenance rather than stored, so a row cannot claim verbatim
provenance with an accuracy metric. A single accessor returns value and kind together; migrating
every existing `confidence` reader onto it is in-scope work, because the failure mode is silent
misinterpretation rather than a compile error.

`verbatimOnly` mirrors `communicatesExternally` — an admin boolean defaulted `false` on
`admin_mcp_servers` — and is enforced where tool results enter the turn, not in the UI. Its scope
is deliberately narrow: Wayfinder will not transform the result. It says nothing about whether
the source is correct, which Wayfinder cannot know (ADR-053 §5).

Aggregate confidence splits by scale. A single minimum across mixed kinds is not conservative,
it is meaningless, so `aggregateConfidence` and `recordConfidenceBand` are replaced by per-kind
equivalents returning `null` where a record has no fields of that kind. This reaches persisted
data: `aggregate_confidence` keeps its meaning as the accuracy aggregate and gains a nullable
`aggregate_selection_confidence`, and the adapter's duplicate reduction is deleted.

## 5. Key entities / files

| Path | New / changed | Notes |
| ---- | ------------- | ----- |
| `packages/domain/src/entities/field-provenance.ts` | new | `FieldProvenance`, `ConfidenceKind`, `FieldDerivation`, `FieldSourceRef`, accessors |
| `packages/domain/src/entities/extraction-record.ts` | changed | Optional `provenance`, `sourceRef`, `derivation`; `applyFieldEdit` stamps `human_corrected`; `AggregateConfidence`, `aggregateConfidenceByKind`, `recordConfidenceBands` replacing the single-number pair |
| `packages/domain/src/entities/analytics.ts` | changed | Report row carries per-scale aggregates |
| `packages/adapters/src/repositories/drizzle-extraction-run-repository.ts` | changed | Delete the duplicate `aggregateConfidenceOf`; persist both aggregates |
| `apps/web/src/components/extraction/result-grid.tsx`, `run-report.tsx` | changed | Per-scale aggregate display |
| `packages/domain/src/entities/mcp-server.ts` | changed | `verbatimOnly` on `McpServer`, `NewMcpServer`, `McpServerUpdate` |
| `packages/domain/src/entities/index.ts` | changed | Re-exports |
| `packages/application/src/use-cases/session/run-mcp-node.ts` | changed | Verbatim enforcement at tool-result ingestion |
| `packages/application/src/use-cases/extraction/` | changed | Provenance threaded through extraction paths |
| `packages/adapters/src/db/schema/admin.ts` | changed | `verbatim_only` column |
| `packages/adapters/src/db/migrations/` | new | One generated migration |
| `apps/web/src/components/admin/` | changed | Verbatim toggle + confirmation |
| `apps/web/src/components/extraction/`, `components/chat/confidence-bar.tsx` | changed | Provenance styling, kind-aware confidence label |

## 6. Implementation steps (test-first per CLAUDE.md)

1. **Domain — provenance types and accessors.** Write `field-provenance.test.ts` first:
   (a) `fieldProvenance()` returns `processed` when absent; (b) returns the stored value when
   present; (c) `confidenceKind()` maps `verbatim` → `selection` and the other three →
   `accuracy`; (d) the combined accessor returns value and kind together. Then implement. Pure,
   no dependencies.

2. **Domain — field result and correction.** Add the optional members to
   `ExtractionFieldResult`. Extend `extraction-record.test.ts`: (a) a historical result with no
   provenance reads as `processed`/`accuracy`; (b) `applyFieldEdit` stamps `human_corrected`
   while keeping `confidence: 1` and the existing rationale text; (c) `applyConfidenceFloor`
   leaves a `verbatim` result's provenance intact when it blanks a value; (d)
   `mergeFieldResults` does not merge across provenance in a way that loses a `human_corrected`
   value to a higher-confidence model one.

3. **Domain — MCP verbatim flag.** Add `verbatimOnly` to the three MCP interfaces. Test:
   an existing server object with no flag reads as `false`.

4. **Domain — per-scale aggregates.** Extend `extraction-record.test.ts` first: (a) a record of
   only accuracy-kind fields returns that minimum as `accuracy` and `null` as `selection` —
   byte-identical to today's number for every historical record; (b) a record of only verbatim
   fields returns `selection` and `null` accuracy; (c) a mixed record returns each kind's own
   minimum, and neither influences the other; (d) an empty record returns `null` for both, not
   zero; (e) `recordConfidenceBands` maps each non-null aggregate through `confidenceBand` and
   leaves `null` as `null`. Then implement `AggregateConfidence`,
   `aggregateConfidenceByKind` and `recordConfidenceBands`, and **delete**
   `aggregateConfidence`/`recordConfidenceBand` so no call site can keep asking the mixed-scale
   question.

5. **Application — verbatim enforcement.** Write `run-mcp-node.test.ts` cases first: (a) with
   `verbatimOnly` off, behaviour is byte-for-byte today's; (b) with it on, a tool result folded
   into the turn is marked `verbatim` and unmodified; (c) a step configured to transform a
   verbatim-only tool's result is refused with a `DomainError` at authoring/validation time;
   (d) whitespace-normalised or truncated output is `processed`, not `verbatim`. Then implement.

6. **Application — reader migration.** Move every existing `confidence` reader onto the accessor.
   This is the silent-risk step: enumerate readers by search, not by memory, and assert each in
   its own suite that a `verbatim` row is labelled selection, not accuracy.

7. **Adapters — columns, migration, mapping.** Add `verbatim_only` mirroring
   `communicates_externally`. Add nullable `aggregate_selection_confidence` and relax
   `aggregate_confidence` to nullable. **Delete `aggregateConfidenceOf`** — the adapter's private
   copy of the reduction, which also omits the domain's clamp — and call the domain function.
   Generate one migration (never `drizzle-kit push`) carrying:
   `-- data-impact: preserved — defaulted boolean, additive nullable column and a DROP NOT NULL; every existing row keeps its value`.
   Repository tests: the flag round-trips and an existing row reads `false`; an existing record's
   persisted accuracy aggregate is unchanged by the migration; a record with no accuracy-kind
   fields persists `null`, not `0`.

7b. **Analytics and report readers.** `ExtractionFieldReportRow.aggregateConfidence` becomes
   per-scale, and `result-grid.tsx` / `run-report.tsx` render each scale separately. Compiler
   breakage from step 4's deletion enumerates these call sites — do not hunt for them by memory.

8. **Web — admin toggle.** Component test first: the toggle requires an explicit confirmation
   before it changes, and the setting survives save and reload. Then implement alongside the
   existing external-communication classification.

9. **Web — provenance display.** Component tests first: styling differs per provenance; the
   confidence label reads "selection" or "accuracy" by kind; derivation method and source
   reference are reachable; derived fields are visually distinct from source fields. Then implement.

10. **Export preservation.** Ensure xlsx, JSON and CSV all carry provenance, derivation and
    source reference. Coordinated with the Structured Export phase, which owns the CSV writer.

11. **Validate.** Run `./validate.sh` after each sub-component; do not proceed on a non-zero exit.

## 7. Acceptance criteria

Mirrors PRD §10 across all three requirements:

- [ ] Verbatim-only toggle exists per connection, persists through save/reload, and requires
      explicit confirmation to change; its copy describes Wayfinder's handling, not source accuracy.
- [ ] Aggregate confidence is reported per scale, `null` where a kind is absent, with each scale
      keeping its own conservative minimum; the single-number aggregate no longer exists.
- [ ] An existing record's accuracy aggregate is byte-identical before and after the change.
- [ ] When enabled, raw tool results cannot be transformed — only selected from.
- [ ] Existing connections are unaffected (`verbatim_only` defaults `false`).
- [ ] Verbatim fields show selection confidence; processed fields show accuracy confidence.
- [ ] Provenance types are visually distinct; source references reachable for every element.
- [ ] Derived fields are distinct, carry their method and source keys, and stay distinguishable
      in every export.
- [ ] A historical record with no provenance reads as `processed`/`accuracy` and renders as it
      does today.

## 8. Playwright e2e

**Does not qualify.** No group in `e2e-test-policy.md` applies: provenance styling and the admin
toggle are ordinary rendering and form state, with no streaming, no upload or download, no auth
lifecycle, and no state surviving a document load. Export *download* is covered by the Structured
Export phase, which owns that surface.

Coverage sits where the logic lives — accessors and correction stamping in `packages/domain`
(steps 1–4), verbatim enforcement in `packages/application` (step 5), the defaulted column in a
`packages/adapters` repository test (step 7), and toggle and styling in `apps/web` component
tests (steps 8–9).

## 9. Risks / open questions

- **Silent breaking read.** Every existing `confidence` consumer assumes accuracy; nothing fails
  to compile when the meaning changes. Step 6 is the mitigation and must enumerate readers by
  search rather than recall.
- **Overclaiming.** `verbatimOnly` guarantees only that Wayfinder does not transform the result.
  A broken MCP server or bad upstream data is outside its reach, and UI copy that implies
  otherwise is the real risk here — the enforcement itself is a narrow, checkable comparison
  between what Wayfinder received and what it used.
- **The definition of "transform"** — narrowed by the scoping above, but still worth a look.
  Verbatim is byte-identical selection from what Wayfinder received, so any normalisation
  (whitespace, truncation, unit conversion) makes a value `processed`. Because the comparison is
  entirely between what Wayfinder received and what it used, this is checkable rather than a
  judgement call. The consequence to confirm: a value the model tidied is `processed` even when
  the tidying was harmless.
- **Aggregate split reaches persisted data and analytics.** Removing the single-number aggregate
  breaks `analytics.ts`, the extraction repository and two components by design, so each picks a
  scale deliberately. The migration must leave every existing record's accuracy aggregate
  untouched — asserted in step 7.
- **Merge semantics.** `mergeFieldResults` keeps the highest confidence per key; a
  `human_corrected` value must not lose to a confident model value. Covered by step 2(d).
