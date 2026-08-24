# Phase — Data Provenance and Verbatim Governance

- **Status**: Awaiting review
- **Target version**: 0.32.0  (bump: MINOR — additive `admin_mcp_servers.verbatim_only` column
  + new feature)
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

- Per-connection verbatim-only enforcement, confirmed before it changes.
- Selection confidence for verbatim fields, accuracy confidence for processed ones, never mixed.
- Derived fields distinguishable, with their method and source keys recorded.
- Human corrections recorded as provenance rather than as maximum confidence.
- Provenance preserved through every export format.

## 3. Non-goals

- Back-filling provenance onto historical records — absent reads as `processed`.
- A formula language or calculation engine; a derivation is recorded, not evaluated.
- Verbatim enforcement for uploads, RAG chunks or lookup sources.
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
`admin_mcp_servers` — and is enforced where tool results enter the turn, not in the UI.

## 5. Key entities / files

| Path | New / changed | Notes |
| ---- | ------------- | ----- |
| `packages/domain/src/entities/field-provenance.ts` | new | `FieldProvenance`, `ConfidenceKind`, `FieldDerivation`, `FieldSourceRef`, accessors |
| `packages/domain/src/entities/extraction-record.ts` | changed | Optional `provenance`, `sourceRef`, `derivation`; `applyFieldEdit` stamps `human_corrected` |
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

4. **Domain — aggregate documentation.** Update `aggregateConfidence`'s contract to state it is a
   triage floor across mixed kinds. Test asserts existing minimum behaviour is unchanged.

5. **Application — verbatim enforcement.** Write `run-mcp-node.test.ts` cases first: (a) with
   `verbatimOnly` off, behaviour is byte-for-byte today's; (b) with it on, a tool result folded
   into the turn is marked `verbatim` and unmodified; (c) a step configured to transform a
   verbatim-only tool's result is refused with a `DomainError` at authoring/validation time;
   (d) whitespace-normalised or truncated output is `processed`, not `verbatim`. Then implement.

6. **Application — reader migration.** Move every existing `confidence` reader onto the accessor.
   This is the silent-risk step: enumerate readers by search, not by memory, and assert each in
   its own suite that a `verbatim` row is labelled selection, not accuracy.

7. **Adapters — column, migration, mapping.** Add `verbatim_only` mirroring
   `communicates_externally`; generate the migration (never `drizzle-kit push`) carrying:
   `-- data-impact: preserved — defaulted boolean column; every existing connection keeps current behaviour`.
   Repository test round-trips the flag and asserts an existing row reads `false`.

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
      explicit confirmation to change.
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
- **A governance claim that is not kept.** If enforcement is incomplete, `verbatimOnly` asserts a
  guarantee the runtime does not honour — worse than not offering the toggle. Enforcement belongs
  at tool-result ingestion.
- **The definition of "transform".** Current position: verbatim is byte-identical selection; any
  normalisation makes it `processed`. Open for review, since it makes unit conversion a
  processing step.
- **Mixed-kind aggregation.** `aggregateConfidence` spans two incomparable scales. Current
  position: keep the conservative minimum and document it as triage only, consistent with
  ADR-033's "not a gate".
- **Merge semantics.** `mergeFieldResults` keeps the highest confidence per key; a
  `human_corrected` value must not lose to a confident model value. Covered by step 2(d).
