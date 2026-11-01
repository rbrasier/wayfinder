# Phase — Structured Data Export (CSV) and Egress Audit

- **Status**: Awaiting review
- **Target version**: 0.32.1  (bump: PATCH on the 0.32 line — new export format; **no schema change, no migration**)
- **PRD**: `docs/development/prd/structured-data-export.prd.md`
- **ADRs**: ADR-054 (CSV is its own writer port)
- **Depends on**: ADR-033 (run exports, append-only audit log); the existing
  `extraction-runs/{runId}/exports/results.{extension}` key pattern
- **Covers requirements**: CSV Export Functionality; Data Egress Audit (largely met — see §7)

## 1. Problem

A run exports to XLSX and JSON but not CSV, the format most downstream systems ingest. The risk
is not the missing feature but the easy wrong implementation: extraction values contain commas,
quotes and newlines, and a naive join corrupts them silently in a file that still opens.

The egress audit is already in good shape — `extraction_run.exported` records actor, resource and
`recordCount` into the append-only `core_audit_log` — and needs extending, not building. See the PRD.

## 2. Goals

- CSV as a first-class run export, governed exactly as XLSX and JSON are.
- Every character class round-trips intact.
- Byte-identical output for unchanged data.
- The egress audit names the format and records volume per format.

## 3. Non-goals

- Configurable dialects, encodings or a BOM option.
- Neutralising formula-like values in CSV or XLSX — formulas may be deliberate.
- Replacing XLSX — the confidence tab is two-dimensional and stays there.
- Streaming large exports.
- Audit schema changes. `core_audit_log` is append-only (ADR-033) and gains no columns.

## 4. Approach

A new `ICsvWriter` port taking a single `CsvTable`, reusing `SpreadsheetColumn` but not the sheet
wrapper — CSV has no tabs, and a format flag on `ISpreadsheetWriter` would force every caller to
pass a structure the format cannot honour (ADR-054). The dialect is fixed to RFC 4180 and output
is deterministic, which is what makes "consistent structure across requests" testable.

`ExportRunResults` gains a third output under the existing key pattern. Because it is the same
use case, CSV inherits its permission checks unchanged — there is no second route to guard.

## 5. Key entities / files

| Path | New / changed | Notes |
| ---- | ------------- | ----- |
| `packages/domain/src/ports/csv-writer.ts` | new | `ICsvWriter`, `CsvTable` |
| `packages/domain/src/ports/index.ts` | changed | Re-export |
| `packages/adapters/src/export/csv-writer.ts` | new | RFC 4180 implementation |
| `packages/application/src/use-cases/extraction/export-run-results.ts` | changed | Emit `results.csv`; audit metadata gains formats + byte volume |
| `apps/web/src/server/routers/` | changed | Return the CSV key alongside the others |
| `apps/web/src/components/extraction/run-results.tsx` | changed | **Download CSV** item in the three-dot Run actions menu, beneath **Download JSON**; extends `ExportFormat` to `"csv"` |
| `apps/web/src/app/api/synthesise/runs/[runId]/artifacts/[artifact]/route.ts` | changed | Serve the `export-csv` artifact alongside `export-xlsx` and `export-json` |
| `apps/web/src/lib/container.ts` | changed | Wire `ICsvWriter` |

## 6. Implementation steps (test-first per CLAUDE.md)

1. **Domain — the port.** Add `ICsvWriter` and `CsvTable`. Type-only; no test file.

2. **Adapters — the writer, tested per character class.** Write `csv-writer.test.ts` first, one
   case per hazard: (a) a value containing a comma is quoted; (b) an embedded double quote is
   doubled and the field quoted; (c) a value containing `CRLF` and one containing bare `LF` are
   both quoted and survive intact; (d) a value needing no quoting is emitted bare; (e) an empty
   value and a missing key both produce an empty field; (f) a value beginning `=`, `+`, `-` or `@` is written
   unchanged — not neutralised, prefixed or defensively quoted — and the file still parses
   (ADR-054); (g) header row uses labels, data rows follow column order; (h) the same input
   twice produces byte-identical output. Then implement.

3. **Application — third export output.** Extend `export-run-results.test.ts` first: (a) a CSV is
   written to `extraction-runs/{runId}/exports/results.csv` with `text/csv`; (b) the CSV mirrors
   the data sheet's columns and rows, not the confidence sheet; (c) the audit entry's `formats`
   includes `"csv"`; (d) the audit entry records byte volume per format; (e) a writer failure
   returns a `DomainError` and no partial export is announced. Then implement.

4. **Web — download and wiring.** Wire `ICsvWriter` in the container and return the CSV key from
   the export procedure. Add `export-csv` to the artifact route. Component test: opening the
   three-dot Run actions menu shows **Download CSV** directly beneath **Download JSON**, and
   choosing it triggers the same export use case as XLSX and JSON — the shared `downloading`
   state disables the other formats while it prepares, exactly as they disable each other today.

5. **Provenance columns.** Once the provenance phase lands, the CSV data table carries provenance,
   derivation and source reference. Sequenced after that phase; the writer itself needs no change,
   only the table the use case hands it.

6. **E2E — repair the preamble, then extend.** In `enhance-synthesise-summary.spec.ts`, replace
   the four self-probed `test.skip()` guards and their `isVisible()` probes in `openRunScreen`
   with real fixtures: an authenticated session, the `extraction_flows` flag on, and a run with
   staged input documents. Only then append the CSV download case (§9). Write it; do not run it.

7. **Validate.** Run `./validate.sh` after each sub-component; do not proceed on a non-zero exit.

## 7. Data Egress Audit — largely met, extended here

| Criterion | Status |
| --------- | ------ |
| Actor, timestamp, scope captured | **Met** — `actorId`, `createdAt`, `resourceType`/`resourceId` on `core_audit_log` |
| Export format identified | **Met, extended** — the existing `formats` array, now including `"csv"` |
| Data volume recorded | **Gap** — `recordCount` exists; byte size per format is added here |
| Reachable through the standard audit interface | **Met** — ordinary audit rows; CSV appears with no interface work |
| Follows established retention | **Met** — ordinary `core_audit_log` rows under the existing policy |

Only the volume metric is build work. The rest is asserted in tests so it cannot regress.

## 8. Acceptance criteria

Mirrors PRD §10:

- [ ] Commas, double quotes and newlines round-trip intact under RFC 4180 quoting.
- [ ] Unchanged data exports byte-identically on repeat.
- [ ] CSV runs through the same use case and therefore the same permission checks.
- [ ] The file is `extraction-runs/{runId}/exports/results.csv`.
- [ ] The egress audit names CSV and records byte volume per format.
- [ ] A writer failure produces a `DomainError` with no partial export announced.

## 9. Playwright e2e

**Qualifies — group 3 (file upload and download).** "The download stream crosses the browser
boundary", and a CSV whose bytes are correct in storage but mis-served (wrong content type,
truncated response) is a real and browser-only failure.

- **Spec to extend: `apps/web/e2e/enhance-synthesise-summary.spec.ts`.** It already owns this
  surface — its header comment covers "the header bar, one-click Excel download, the overflow
  menu holding JSON and document generation". No new file, per the policy's preference for
  extending the spec that owns the capability.
- Happy path: open the Run actions menu, choose **Download CSV**, and assert the download
  completes with CSV content type.
- User-visible error path: an export failure surfaces an error rather than an empty file.
- Obeys the non-negotiables: no `test.skip()` on a self-probed condition, no `isVisible()` for
  control flow, no environment-variable gate.
- **Do not run the suite locally.** CI runs it — `.github/workflows/e2e.yml` fires on every pull
  request, sharded, against a full stack. Review the spec by reading it.

### Precondition — the spec being extended does not currently obey the non-negotiables

`enhance-synthesise-summary.spec.ts` carries **four `test.skip()` guards on conditions it probes
itself** (no authenticated session, `extraction_flows` flag off, sample run needs staged
documents, run produced no records) and reaches three of them through `isVisible().catch(() =>
false)` — both patterns the policy names as non-negotiable. It is the worst remaining case in the
suite: 18 skip guards survive across 37 specs, and this spec holds 4 of them.

They sit in the shared `openRunScreen` preamble, so a CSV test appended as-is inherits every one
of them and can report green having downloaded nothing. **Repairing that preamble is in scope for
this phase** — build the fixture the spec keeps opting out of, or the CSV coverage is illusory
and the audit that produced these rules (#241) gets re-run on work we added.

Renaming the spec to a capability name is *not* in scope. The `enhance-` prefix is ticket-shaped
and against the policy's naming rule, but a rename touches no behaviour and belongs in whatever
sweep addresses the other legacy `fix-`/`enhance-`/`phase-` names.

**Escaping is not e2e.** Character-class correctness is a pure function and belongs in the
adapter test (step 2) — the bug can be described without saying "browser".

## 10. Risks / open questions

- **Silent corruption is the whole risk.** Wrong escaping still opens; the damage appears
  downstream. Mitigated by per-character-class tests rather than sample inspection.
- **Formulas are emitted as held — decided.** An exported sheet may deliberately carry formulas,
  so nothing is neutralised. The writer's remit is a well-formed file: it intervenes only where a
  value would corrupt the record structure, never over how the receiving application interprets
  a value.
- **CSV represents the data tab only.** The confidence tab stays in XLSX and JSON; a request for
  it in CSV is a new design question by construction.
- **Sequencing.** Step 5 depends on the provenance phase. If that slips, CSV ships without
  provenance columns and gains them later — the writer is unaffected either way.

---

## 11. Approved build summary (2026-08-27)

Approved at the `/build` gate. Scope is **steps 1–4 and 6**; step 5 (provenance,
derivation and source-reference columns) is deferred to the provenance phase per
§6.5 — the writer is unaffected either way.

### Goal

CSV joins XLSX and JSON as a first-class export of an extraction run. A new
`ICsvWriter` port takes a single table — not the sheet list `ISpreadsheetWriter`
requires — and an RFC 4180 adapter behind it does the escaping, so commas, quotes
and newlines stop being a silent corruption risk. `ExportRunResults` gains a third
output under the existing key pattern and its egress audit names CSV and records
byte volume per format.

### Business rules changing

- A run export writes a third artifact to `extraction-runs/{runId}/exports/results.csv`
  alongside the XLSX and JSON — the same use case, so the same permission checks.
- The export audit event's `formats` includes `"csv"`, and new `bytes` metadata
  records the size of each format separately.
- A value containing a comma, double quote or line break is quoted per RFC 4180
  with embedded quotes doubled. A value beginning `=`, `+`, `-` or `@` is written
  unchanged — file integrity is the writer's remit, not what the receiving
  application makes of a value.
- A CSV writer failure returns a `DomainError` for the whole export; no partial
  export is announced.

### UI / visible behaviour

- **Download CSV** in the three-dot **Run actions** menu, directly beneath
  **Download JSON** and above the divider. **Download Excel** keeps the primary button.
- Choosing it shows **Preparing…** on that item and disables the other formats,
  through the shared `downloading` state XLSX and JSON already use.
- An export failure surfaces the existing error toast rather than an empty file.

### Data & types

- `CsvTable` — `{ columns: SpreadsheetColumn[]; rows: Array<Record<string, string>> }`.
  Reuses `SpreadsheetColumn`; deliberately no sheet wrapper.
- `ICsvWriter` — `write(input: CsvTable): Result<{ bytes: Buffer }>`.
- `ExportRunResultsOutput` gains `csvKey: string`.
- `ExportFormat` in `run-results.tsx` widens `"xlsx" | "json"` to include `"csv"`.
- `SeedResult` gains `extractionFlowId` and `extractionRunId`.

### Files & packages touched

- **domain** — `ports/csv-writer.ts` (new), `ports/index.ts`
- **application** — `use-cases/extraction/export-run-results.ts` and its test
- **adapters** — `exports/csv-writer.ts` (new) and its test, `exports/index.ts`
- **apps/web** — `lib/container-extraction.ts`, `server/routers/extraction.ts`,
  `api/synthesise/runs/[runId]/artifacts/[artifact]/route.ts`,
  `components/extraction/run-results.tsx`,
  `components/extraction/export-format.ts` (new) and its test,
  `lib/e2e-fixtures.ts`, `e2e/helpers/seed.ts`, `e2e/seed.setup.ts`,
  `e2e/enhance-synthesise-summary.spec.ts`

### Database & migration impact

**None.** CSV writes to object storage under the existing key pattern, and volume
goes in the existing `metadata` jsonb on the append-only `core_audit_log`. No table
is created or altered, so no migration is generated and no `-- data-impact:` line
is required.

### Tests

- `packages/adapters/src/exports/csv-writer.test.ts` — one case per hazard: comma,
  embedded quote, CRLF and bare LF, no-quote-needed, empty and missing key,
  formula-like value passed through, header labels and column order, and a
  byte-identical repeat.
- `packages/application/src/use-cases/extraction/export-run-results.test.ts` —
  extended: CSV key and `text/csv`, mirrors the data sheet not the confidence
  sheet, audit `formats` includes `"csv"`, byte volume per format, and a writer
  failure returning a `DomainError` with nothing stored.
- `apps/web/src/components/extraction/export-format.test.ts` — the
  format-to-artifact mapping and menu ordering as a pure model.
- **e2e — qualifies, group 3 (file upload and download).**
  `enhance-synthesise-summary.spec.ts` extended with the CSV download happy path
  and an export-failure path, after its preamble is repaired.

### Version, branch & PR target

- **PATCH — 0.31.0 → 0.32.1**, opening the 0.32 line. This phase was split out of
  PR #257 so it can merge on its own; 0.32.0 is skipped because that number was
  already published under the combined PR.
- Built on `claude/pr-257-scope-planning-vey5hv`, then merged into
  `claude/extended-workflow-continuity-docs` so PR #257 accumulates. No new PR;
  #257 stays draft.

### Risks

- Silent corruption is the whole risk — a mis-escaped CSV still opens and breaks
  downstream. Mitigated per character class rather than by sample inspection.
- The seed fixture is shared e2e infrastructure; a mistake there fails specs
  unrelated to this phase. Mitigated by adding fixtures rather than altering
  existing ones.

### Out of scope

- Step 5 — provenance, derivation and source-reference columns (deferred, §6.5).
- Renaming `enhance-synthesise-summary.spec.ts` to a capability name (§9).
- Configurable dialects, encodings or a BOM option; a CSV rendering of the
  confidence tab; streaming exports.

### Deviations from the plan above, declared at approval

1. **Adapter path.** §5 says `packages/adapters/src/export/csv-writer.ts`; the
   existing folder is `exports/` (plural), where `xlsx-writer.ts` already lives.
   The real path is used.
2. **"Component test" for the menu.** §6 step 4 calls for one, but the repo has no
   `.test.tsx` files and neither jsdom nor testing-library is configured. The
   established convention is followed instead — the pure decision is extracted to
   `export-format.ts` and unit-tested, with the rendered menu covered by the e2e
   case, which qualifies under group 3 regardless.
3. **Seed fixture scope.** §9 requires building "the fixture the spec keeps opting
   out of" without detailing it. There is no extraction fixture in the seed at all,
   so this adds a seeded extraction flow, a completed run with staged documents and
   records, and the `extraction_flows` flag.

### Build order

1. Domain port — `csv-writer.ts`, `ports/index.ts`
2. Adapter writer — `csv-writer.test.ts`, `csv-writer.ts`, `exports/index.ts`
3. Application third output — `export-run-results.test.ts`, `export-run-results.ts`
4. Web wiring — `container-extraction.ts`, router, artifact route
5. Web UI — `export-format.ts` and its test, `run-results.tsx`
6. E2E — seed fixture, then the repaired spec
