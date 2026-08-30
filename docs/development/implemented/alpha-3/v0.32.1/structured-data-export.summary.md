# Implementation Summary — Structured Data Export (CSV) and Egress Audit

- **Version**: 0.32.1 (bump: **PATCH** on the 0.32 line — new export format and audit metadata; no schema change)
- **Phase doc**: `structured-data-export.phase.md` (this folder)
- **PRD**: `docs/development/prd/structured-data-export.prd.md`
- **ADR**: ADR-054 — CSV is its own writer port, not a mode of the spreadsheet writer
- **Landed via**: PR #257 (the AI orchestration and Excel export line), which stays draft
- **Scope built**: phase §6 steps 1–4 and 6. **Step 5 deferred** — see *Known limitations*.

## What was built

CSV joins XLSX and JSON as a first-class export of an extraction run.

A new `ICsvWriter` port takes a single `CsvTable` rather than the sheet list
`ISpreadsheetWriter` requires, so no caller ever passes a structure CSV cannot
honour (ADR-054). The RFC 4180 adapter behind it quotes a field only when leaving
it bare would corrupt the record — a comma, a double quote, or either line-break
character — doubling an embedded quote. A value beginning `=`, `+`, `-` or `@` is
written unchanged: file integrity is the writer's remit, not what the receiving
application makes of a value. Output is deterministic, so the same table twice
produces byte-identical bytes.

`ExportRunResults` writes a third artifact to
`extraction-runs/{runId}/exports/results.csv` with a `text/csv` content type. It
is the same use case, so CSV inherits the existing permission checks — there is no
second route to guard. The CSV is written *before* anything is stored, so a writer
failure leaves the run's previous export untouched rather than half-replaced.

The egress audit now names CSV in its `formats` array and records byte volume
**per format** in the existing `metadata` jsonb — one combined number could not
answer "how much data left as CSV".

On the run screen, **Download CSV** sits in the three-dot **Run actions** menu
directly beneath **Download JSON**. **Download Excel** keeps the primary button;
CSV joins JSON as a secondary format rather than taking a third button.

## Files created

| Path | Notes |
| ---- | ----- |
| `packages/domain/src/ports/csv-writer.ts` | `ICsvWriter`, `CsvTable`, `WriteCsvOutput` |
| `packages/adapters/src/exports/csv-writer.ts` | RFC 4180 implementation |
| `packages/adapters/src/exports/csv-writer.test.ts` | 13 cases, one per hazard |
| `apps/web/src/components/extraction/export-format.ts` | Format → artifact mapping, menu order, busy label |
| `apps/web/src/components/extraction/export-format.test.ts` | 6 cases |
| `apps/web/src/lib/e2e-fixtures-extraction.ts` | Seeded extraction flow and completed run |

## Files modified

| Path | Change |
| ---- | ------ |
| `packages/domain/src/ports/index.ts` | Re-export the new port |
| `packages/adapters/src/exports/index.ts` | Re-export `CsvWriter` |
| `packages/application/src/use-cases/extraction/export-run-results.ts` | Third output, `csvKey`, per-format byte volume in the audit |
| `packages/application/src/use-cases/extraction/export-run-results.test.ts` | 7 new cases; existing ones extended for the third artifact |
| `apps/web/src/lib/container-extraction.ts` | Wire `CsvWriter` into `ExportRunResults` |
| `apps/web/src/app/api/synthesise/runs/[runId]/artifacts/[artifact]/route.ts` | Serve the `export-csv` artifact |
| `apps/web/src/components/extraction/run-results.tsx` | Menu driven by `EXPORT_MENU_FORMATS`; `ExportFormat` moved out |
| `apps/web/src/lib/e2e-fixtures.ts` | `extraction_flows` flag on; two new `SeedResult` ids |
| `apps/web/e2e/helpers/seed.ts` | Two new fixture keys |
| `apps/web/e2e/enhance-synthesise-summary.spec.ts` | Preamble repaired; two CSV tests added |
| `VERSION`, `package.json` | 0.31.0 → 0.32.1 |

The `export` tRPC procedure returns `result.data` wholesale, so `csvKey` reaches
the client with no router change — one file fewer than the phase doc anticipated.

## Migrations

**None.** CSV writes to object storage under the existing key pattern, and volume
goes in the existing `metadata` jsonb on the append-only `core_audit_log`
(ADR-033). No table was created or altered, so no migration was generated and no
`-- data-impact:` line was required. `validate.sh` §22 confirms the schema still
matches its migrations.

## Tests

`./validate.sh` passes — 25 checks, 0 failures, 3,693 tests.

- **Adapter (13 cases)** — comma quoted; embedded quote doubled and field quoted;
  CRLF and bare LF each quoted and intact; a value needing no quoting written
  bare; empty value and missing key both empty fields; formula-like values
  (`=`, `+`, `-`, `@`) passed through unchanged; header labels quoted on the same
  rules as values; column order honoured; byte-identical repeat; UTF-8 with no
  BOM; header-only output when there are no rows; a table with no columns refused.
- **Application (7 new)** — CSV key and `text/csv`; the writer receives the data
  sheet's columns and rows, not the confidence sheet's; confidence and rationale
  stay out; `formats` includes `"csv"`; byte volume recorded per format; a writer
  failure and a storage failure each return a `DomainError` with nothing stored
  and no audit event.
- **Component model (6)** — format-to-artifact mapping, menu order (JSON then
  CSV), Excel absent from the menu, and "Preparing…" appearing only on the format
  the operator pressed.

### E2E — qualifies, group 3 (file upload and download)

`enhance-synthesise-summary.spec.ts` extended, not replaced, per the policy's
preference for the spec that owns the capability.

**Its preamble was repaired first, as §9 required.** The spec carried four
`test.skip()` guards on conditions it probed itself — no session, flag off, no
staged documents, no records — three reached through
`isVisible().catch(() => false)`. Both patterns are non-negotiable under
`docs/guides/e2e-test-policy.md`, and a CSV case appended to them could have
reported green having downloaded nothing. The seed now builds the fixture the
spec kept opting out of: a completed extraction run with two settled documents
and two records, plus the `extraction_flows` flag. All four guards are gone; a
missing fixture now fails loudly via `requireSeedFixtures()`.

Two CSV tests were added: the happy path reads the download **stream** rather
than trusting the filename, asserting the header row and that the seeded comma,
embedded quote and line break came back RFC 4180-quoted and intact; and a
user-visible error path where a failed export surfaces an error and the menu
recovers rather than sticking on "Preparing…".

**The suite was not run locally** — CI runs it via `.github/workflows/e2e.yml`,
sharded against a full stack. The specs were reviewed by reading.

## Known limitations

- **Step 5 — provenance, derivation and source-reference columns — is not built.**
  Deferred to the Provenance and Verbatim Governance phase per §6.5, which owns
  those columns. The writer needs no change when they arrive; only the table
  `ExportRunResults` hands it. CSV ships without them until then.
- **CSV represents the data tab only.** The confidence tab is one row per record ×
  field — a differently-shaped table — and stays in XLSX and JSON. A request for
  it in CSV is a new design question by construction (ADR-054).
- **The dialect is fixed.** A consumer needing semicolons, UTF-16 or a BOM is
  unsupported until a requirement justifies it.
- **Formula-like values are emitted as held**, so a value beginning `=` will be
  evaluated by whatever opens the file. Decided, not open (ADR-054, PRD §12).
- **`apps/web/src/lib/e2e-fixtures.ts` is at 789 lines**, inside the ≥700 warn
  band that `validate.sh` §16 reports. The extraction fixture was put in its own
  file to avoid adding to it further; the existing file is due a split when next
  touched.

## Deviations from the approved build summary

1. **Adapter path.** Phase doc §5 says `packages/adapters/src/export/csv-writer.ts`;
   the real folder is `exports/` (plural), where `xlsx-writer.ts` lives. Used the
   real one.
2. **No component test for the menu.** §6 step 4 calls for one, but the repo has
   zero `.test.tsx` files and neither jsdom nor testing-library is configured.
   Followed the established convention instead — the pure decision extracted to
   `export-format.ts` and unit-tested — with the rendered menu covered by the e2e
   case, which qualifies under group 3 regardless.
3. **Seed fixture scope.** §9 required building "the fixture the spec keeps opting
   out of" without detailing it. There was no extraction fixture in the seed at
   all, so this added a seeded extraction flow, a completed run with staged
   documents and records, and the `extraction_flows` flag.
4. **No router change.** The phase doc listed `apps/web/src/server/routers/` as
   changed; the `export` procedure already returns the use case's output wholesale.
5. **`isExportBusy` dropped during the build.** It ignored its second argument,
   which is dead weight under the code-writing rules; `exportLabel` replaced it
   with the decision the menu actually makes.
