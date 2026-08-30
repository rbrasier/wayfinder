# Phase — Data Provenance and Verbatim Governance

- **Status**: Implemented (2026-08-27, v0.32.2)
- **Target version**: 0.32.2  (bump: PATCH on the 0.32 line — additive `admin_mcp_servers.verbatim_only` column,
  + new feature. No column is added to or altered on `app_extraction_records`: the §10
  investigation found the existing aggregate column unread, so both per-kind aggregates are
  derived from `fields` in the domain.)
- **PRD**: `docs/development/prd/data-provenance-and-verbatim-governance.prd.md`
- **ADRs**: ADR-053 (field provenance and dual confidence)
- **Depends on**: ADR-024 (operator correction authoritative), ADR-032 (MCP tool-loop pre-pass),
  ADR-033 (extraction records, confidence and rationale)
- **Covers requirements**: Verbatim Processing Control; Provenance Differentiation
- **Does not cover**: Derived Field Handling — see §12. The `derived` vocabulary, the
  `FieldDerivation` type and every reader ship here, but nothing can author a calculated
  field, so the requirement is not delivered by this phase.

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
- Derived fields distinguishable *where one exists*, with their method and source keys
  recorded. No authoring path produces one — see §12.
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
equivalents returning `null` where a record has no fields of that kind. This does **not** reach
persisted data: the §10 investigation found `aggregate_confidence` to be a write-only column, so
both aggregates are derived from `fields` in the domain and no column is added. The adapter's
duplicate reduction is still deleted.

**The migration gate (step 6b) has been cleared — the finding is §10.** It reduced the plan
from three column changes to one: `admin_mcp_servers.verbatim_only` proceeds as proposed, and
both aggregate columns are dropped from the plan.

## 5. Key entities / files

| Path | New / changed | Notes |
| ---- | ------------- | ----- |
| `packages/domain/src/entities/field-provenance.ts` | new | `FieldProvenance`, `ConfidenceKind`, `FieldDerivation`, `FieldSourceRef`, accessors |
| `packages/domain/src/entities/extraction-record.ts` | changed | Optional `provenance`, `sourceRef`, `derivation`; `applyFieldEdit` stamps `human_corrected`; `AggregateConfidence`, `aggregateConfidenceByKind`, `recordConfidenceBands` replacing the single-number pair |
| `packages/domain/src/entities/analytics.ts` | changed | Report row carries per-scale aggregates |
| `packages/adapters/src/repositories/drizzle-extraction-run-repository.ts` | changed | Delete the duplicate `aggregateConfidenceOf` and write `aggregate_confidence` through the domain function; no new column (§10.1) |
| `apps/web/src/components/extraction/result-grid.tsx`, `run-report.tsx` | changed | Per-scale aggregate display |
| `packages/domain/src/entities/mcp-server.ts` | changed | `verbatimOnly` on `McpServer`, `NewMcpServer`, `McpServerUpdate` |
| `packages/domain/src/entities/index.ts` | changed | Re-exports |
| `packages/application/src/use-cases/session/run-mcp-node.ts` | changed | Verbatim enforcement at tool-result ingestion |
| `packages/application/src/use-cases/extraction/` | changed | Provenance threaded through extraction paths |
| `packages/adapters/src/db/schema/admin.ts` | changed | `verbatim_only` column — the phase's only schema change |
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

6b. **Information-architecture investigation — before any schema change is written. ✅ Complete
   (2026-08-25) — the finding is §10 below, and it removed both aggregate columns from the plan.**
   This phase adds columns to two tables, so the shape is settled by investigation first rather
   than by reaching for the nearest column. Produce a short written finding covering:
   - **Where confidence aggregates belong.** `aggregate_confidence` is currently a denormalised
     `real` on `app_extraction_records`, duplicating what `fields` already implies. Adding a
     second aggregate column doubles that duplication. Establish whether both belong as columns
     (read performance for the report grid), both belong derived from `fields`, or the split
     belongs inside the existing jsonb — and say which readers force the answer.
   - **Whether `verbatim_only` belongs on the server row at all**, or whether verbatim handling
     is a property of how a *flow step* uses a connection. A server-level flag is simpler; a
     step-level one is more precise. The existing `communicates_externally` precedent argues for
     server-level, but precedent is not by itself a reason.
   - **What the `admin_`/`app_` split means here**, so a governance flag does not end up
     straddling both groups.
   Bring the finding back before writing the migration. If it changes the shape, the schema steps
   below change with it — that is the point of doing this first, and this step may legitimately
   conclude that fewer columns are needed than currently planned.

7. **Adapters — one column, one migration, mapping.** Add `verbatim_only` mirroring
   `communicates_externally`. **No aggregate column is added and `aggregate_confidence` is not
   altered** (§10.1). **Delete `aggregateConfidenceOf`** — the adapter's private copy of the
   reduction, which also omits the domain's clamp — and have `saveRecordFields` write
   `aggregate_confidence` through the domain's accuracy-scale function, so the column keeps its
   exact meaning and gains the clamp it was missing. Generate one migration (never
   `drizzle-kit push`) carrying:
   `-- data-impact: preserved — defaulted boolean column; every existing connection keeps current behaviour`.
   Repository tests: the flag round-trips and an existing row reads `false`; an existing record's
   persisted accuracy aggregate is unchanged by the migration.

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
- [x] Verbatim fields are produced: an extracted value occurring byte-identically in a source
      text is stamped `verbatim`, which is what makes selection confidence reachable.
- [x] A field-level source reference is produced where the model can point at one, and stays
      absent — never an empty ref — where it cannot.
- [ ] ~~Derived fields are distinct, carry their method and source keys, and stay distinguishable
      in every export.~~ **Not delivered.** The readers, the export columns and the type are
      here and correct; no authoring path can declare a calculated field, so no `derived` value
      can exist to render. See §12, and the *Calculated Extraction Fields* phase doc
      under `docs/development/to-be-implemented/`.
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
- **"Transform" is settled, and deliberately strict.** Verbatim is byte-identical selection from
  what Wayfinder received. Whitespace normalisation, truncation, unit conversion **and harmless
  tidying** all make a value `processed`. There is no "close enough" tier, because the moment one
  exists the guarantee stops being checkable and becomes an argument.
- **Aggregate split reaches persisted data and analytics.** Removing the single-number aggregate
  breaks `analytics.ts`, the extraction repository and two components by design, so each picks a
  scale deliberately. The migration must leave every existing record's accuracy aggregate
  untouched — asserted in step 7.
- **Merge semantics.** `mergeFieldResults` keeps the highest confidence per key; a
  `human_corrected` value must not lose to a confident model value. Covered by step 2(d).

---

## 10. Information-architecture finding — step 6b (2026-08-25)

Produced before any migration was drafted, as step 6b requires. **Outcome: the planned migration
shrinks from three column changes to one.** Both aggregate columns are dropped from the plan —
not deferred, not renamed. The `verbatim_only` flag is confirmed where ADR-053 put it.

### 10.1 Where do confidence aggregates belong? — **In no column at all**

`app_extraction_records.aggregate_confidence` is **write-only**. Enumerated by search, not recall:

| Site | Direction |
| ---- | --------- |
| `drizzle-extraction-run-repository.ts:278` (`saveRecordFields`) | **write** — the only one |
| `schema/wayfinder.ts:625`, `drizzle/0038_careful_quentin_quire.sql:22` | declaration |
| everything else | *no read exists* |

`toRecord` (`drizzle-extraction-run-repository.ts:419-426`) maps `id`, `label`, `fields` and
`sourceDocumentIds` and nothing else — the column is never lifted into the entity, and
`ExtractionRecord` (`entities/extraction-record.ts:43-49`) has no member to receive it. No query
selects it, filters on it, orders by it or aggregates over it.

Every consumer recomputes the value from `fields` in memory instead:

- `result-grid.tsx:466` calls the domain `aggregateConfidence(record)`.
- `run-report.tsx:56` reads `row.aggregateConfidence`, which `analytics.ts:173` computed by
  calling the same domain function.

So the read-performance justification for a denormalised column — the one argument that would
carry it — **is not being taken by anybody**. The grid and the report already pay the reduction
at read time, over records they have fully loaded.

That settles the question the step asked. Adding `aggregate_selection_confidence` beside a column
nobody reads would double a duplication that has never paid for itself, and would create a second
value that can drift from `fields` in a second way. The per-kind split lives where the single
aggregate already effectively lives: derived from `fields`, in the domain, at read time.

**Conclusion.**

- **No new column.** `aggregate_selection_confidence` is not added.
- **No `DROP NOT NULL`.** `aggregate_confidence` is not touched, so no existing row is rewritten
  and no reader changes meaning.
- `aggregateConfidenceByKind` and `recordConfidenceBands` are pure domain functions over `fields`,
  exactly as ADR-053 defines them. The deletion of `aggregateConfidence`/`recordConfidenceBand`
  is unaffected — it is a code change, not a schema one.
- The adapter's private `aggregateConfidenceOf` is still deleted (step 7). `saveRecordFields`
  keeps writing `aggregate_confidence`, now via the domain's accuracy-scale function, so the
  column keeps its exact current meaning and its clamp is no longer missing.

**Left standing deliberately:** a write-only column is dead weight, and this finding is what
proves it. Removing it is a `DROP COLUMN` — destructive, needing its own
`-- data-impact: destructive, approved` declaration and its own decision. That belongs in a
follow-up, not smuggled into a provenance phase; noted here so the evidence is not lost.

### 10.2 Does `verbatim_only` belong on the server row? — **Yes, on `admin_mcp_servers`**

The alternative was a step-level flag in `McpNodeConfig`, which is genuinely cheaper: node config
is `jsonb` (`schema/wayfinder.ts:76`), so a step-level flag needs **no migration whatsoever**.
Cost is not the deciding factor here, and three findings point the other way.

**A step-level flag is not a governance control.** `verbatim_only` exists so an administrator can
state how a connection's results are handled. If it lives on the step, any flow author can
author around it — the guarantee then describes one step's intent rather than the organisation's
policy for that connection.

**The existing classification is enforced at import, and a step-level flag would travel.**
`flow-import-resolve.ts:79` refuses an imported flow that references an externally-communicating
server, and `inspect-flow-import.ts:38` surfaces the classification during resolution. Both work
because the classification belongs to the receiving organisation's own server row. A step-level
verbatim flag is carried inside the exported flow, so an imported flow would arrive asserting
verbatim handling for a connection the receiving organisation has never classified.

**The enforcement point already holds the server row.** `RunMcpNode` loads the server and checks
`communicatesExternally` on it before calling the tool (`run-mcp-node.ts:75-89`). A server-level
flag is read there for free; a step-level one would put the governance decision in a different
object from the classification beside it.

**Conclusion.** `admin_mcp_servers.verbatim_only boolean not null default false`, mirroring
`communicates_externally` (`schema/admin.ts:175-177`) exactly, enforced in `RunMcpNode` next to
the check that is already there. The plan is confirmed unchanged.

### 10.3 What does the `admin_`/`app_` split mean here? — **No straddle; they are different things**

The flag and the provenance data are not two halves of one concept.

- **`verbatim_only` is a classification of a connection** — admin-configured infrastructure,
  alongside `transport`, `url`, `credential_ref` and `communicates_externally`. `admin_`.
- **Provenance is a property of a value** — it rides inside
  `app_extraction_records.fields` (`$type<ExtractionFieldResult[]>`), the jsonb that already
  carries `confidence` and `rationale`. `app_`. No column, no migration, and a historical row
  with no provenance member reads as `processed` through the accessor.

A single governance concept spread across both groups was the risk this question was written to
catch. It does not arise: one is configuration an administrator sets, the other is data a run
produces, and neither needs to know the other's group.

### 10.4 Net effect on the planned migration

| Planned before | After this finding |
| --- | --- |
| `admin_mcp_servers.verbatim_only` (add) | **Unchanged — proceed** |
| `app_extraction_records.aggregate_selection_confidence` (add) | **Dropped** — no reader justifies it |
| `app_extraction_records.aggregate_confidence` (`DROP NOT NULL`) | **Dropped** — column untouched |

One migration, one defaulted boolean:

```sql
-- data-impact: preserved — defaulted boolean column; every existing connection keeps current behaviour
```

Step 7's repository assertions about the accuracy aggregate surviving the migration become
trivially true — nothing touches those rows — but stay in the suite as a regression guard.

---

## 11. Approved build summary (2026-08-27)

Approved at the `/build` gate. Scope is the whole phase (§6 steps 1–11), including
step 10's CSV columns — the provenance, derivation and source-reference columns
the Structured Export thread deferred to this phase.

**PATCH — 0.32.1 → 0.32.2.** This phase was split out of PR #257 so it can be
reviewed and merged on its own, so it now carries its own bump rather than
riding the Structured Export thread's. It builds on the export work at 0.32.1,
which must land first — the CSV provenance columns extend the table that phase
introduced.

### Goal

Provenance becomes an explicit property of every extracted field — `verbatim`,
`processed`, `derived` or `human_corrected` — with absent reading as `processed`,
so no historical row changes meaning. Confidence stops being one number: its
*kind* is derived from provenance, never stored, so a copied value reports
selection confidence and a composed one reports accuracy, and the two are never
averaged. An administrator can require verbatim-only handling per MCP connection,
enforced where tool results enter a turn and refused at publish time for a step
that would reshape them.

### Business rules changing

- A field with no `provenance` member reads as `processed`/`accuracy`; `verbatim`
  is the only provenance mapping to `selection` confidence.
- `applyFieldEdit` stamps `human_corrected` alongside `confidence: 1`;
  `mergeFieldResults` never lets a confident model value overwrite a
  `human_corrected` one.
- Aggregate confidence is reported per scale — `{ selection, accuracy }`, `null`
  where a kind is absent — and each scale keeps its own conservative minimum.
- When a connection is `verbatimOnly`, publishing a flow whose MCP step coerces
  that tool's result is refused; `RunMcpNode` refuses the same config at run time
  as a backstop.
- Verbatim means byte-identical: a trimmed, truncated or reshaped value is
  `processed`, with no "close enough" tier.

### UI / visible behaviour

- Result grid: each value carries a provenance marker; the rationale dialog names
  the confidence kind ("selection" / "accuracy") instead of assuming accuracy.
- Record detail shows per-scale overall confidence, with an absent scale rendered
  as absent rather than 0%.
- Derived fields are visually distinct and expose their method and source field
  keys **wherever one is recorded** — no authoring path records one, so this
  rendering is unreachable in the product today (§12).
- A field-level source reference is reachable where recorded, and extraction now
  records one whenever the model can point at a place in the source.
- MCP admin: a verbatim-only checkbox beside the external-communication
  classification, requiring an explicit confirm before it changes, worded as
  Wayfinder's handling.
- Field report rows band on the accuracy scale, falling back to selection where a
  record has no accuracy fields.

### Data & types

- New `field-provenance.ts`: `FieldProvenance`, `ConfidenceKind`,
  `FieldDerivation`, `FieldSourceRef`, `fieldProvenance()`, `confidenceKind()`,
  `fieldConfidence()`.
- `ExtractionFieldResult` gains optional `provenance`, `sourceRef`, `derivation`.
- `AggregateConfidence` / `ConfidenceBands` with `aggregateConfidenceByKind()` and
  `recordConfidenceBands()`; `aggregateConfidence` and `recordConfidenceBand` deleted.
- `McpServer`, `NewMcpServer`, `McpServerUpdate` gain `verbatimOnly`.
- `ExtractionFieldReportRow.aggregateConfidence` becomes `AggregateConfidence`.

### Database & migration impact

- `admin_mcp_servers` — add `verbatim_only boolean not null default false`. One
  generated migration carrying
  `-- data-impact: preserved — defaulted boolean column; every existing connection keeps current behaviour`.
- `app_extraction_records` — no change (§10.1).

### Tests

Test file before each implementation file, at the layer that owns the logic. **No
e2e** — §8 stands: no group in `e2e-test-policy.md` applies, and coverage sits at
domain, application, adapter and web-model layers.

### Build order

1. Domain — provenance types and accessors
2. Domain — field result, correction, merge
3. Domain — per-scale aggregates (delete the single-number pair)
4. Domain — MCP `verbatimOnly` + verbatim handling rules
5. Application — verbatim enforcement (publish gate + run backstop)
6. Application — reader migration: analytics, exports (CSV step 10)
7. Adapters — column, migration, mappings
8. Web — admin toggle, provenance display, container wiring

## 12. Derived Field Handling — not delivered by this phase (2026-08-28)

The requirement was listed on the *Covers requirements* line when this phase was planned. It
should not have been, and the line has been corrected. What the phase actually shipped for
`derived` is everything except the one thing that would make it visible.

**What is here and correct:** `FieldProvenance` includes `derived`; `FieldDerivation`
(`{ method, sourceKeys }`) is defined and carried on `ExtractionFieldResult`; `confidenceKind`
routes `derived` to the accuracy scale; the result grid tags such a value "Calculated";
`derivationSummary` renders its method and inputs; `applyFieldEdit` clears a derivation a person
has overwritten; JSON, XLSX and the CSV `__derivation` column all export it.

**What is missing:** an author cannot declare that a field is calculated. `ExtractionField` is
`{ field, instruction, doneWhen }` — a label, an annotation and a plain-English instruction.
There is no member on which an author could say "this field is computed from those fields", and
the extraction prompt has nothing to tell the model about one. So no `derived` value can be
produced, and every reader above is waiting on a producer that does not exist.

Unlike `verbatim`, this **cannot** be closed by classifying model output. Verbatim is decidable
from the returned bytes — the value is either in the source text or it is not. Whether a value
was *calculated from other fields* is an authoring intent, not a property of the result; a
classifier guessing at it would be inventing the audit trail the requirement exists to provide.

The type and the export columns are **deliberately kept**. They are correct and unused, not
wrong, and deleting them would mean rebuilding identical readers when the authoring path lands.
That path is specified by the *Calculated Extraction Fields* phase doc under
`docs/development/to-be-implemented/`.
