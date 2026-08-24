# PRD — Structured Data Export (CSV) and Egress Audit

- **Status**: Draft
- **Date**: 2026-08-24
- **Author**: rbrasier
- **Target version**: 0.32.0  (bump: MINOR — new export format and audit metadata; no schema change)

## 1. Problem

An extraction run exports to XLSX and JSON. `ExportRunResults` writes both to object storage
under `extraction-runs/{runId}/exports/results.{extension}`, then logs the egress:

```typescript
await this.auditLogger.log({
  actorId: input.userId,
  action: "extraction_run.exported",
  resourceType: "extraction_run",
  resourceId: input.runId,
  metadata: { recordCount: records.length, formats: ["xlsx", "json"] },
});
```

CSV is missing, and it is the format most downstream systems actually ingest. The gap is
narrow but the failure mode is not: CSV is trivial to generate and easy to generate *wrongly*.
Extraction values routinely contain commas (addresses), quotes (quoted clauses) and newlines
(multi-line rationale) — precisely the characters a naive join corrupts, silently, in a file
that still opens.

Wayfinder already emits CSV elsewhere — the audit log export offers `csv | json`
(`apps/web/src/server/routers/audit.ts:37`) — so the precedent exists but is not shared.

The egress audit is in good shape and needs extending rather than building: it records actor,
action, resource and `recordCount`, through the append-only tamper-evident `core_audit_log`. It
does not record byte volume, and its `formats` array will need to name CSV.

## 2. Users / Personas

- **Operator** — downloads run results to work with them in whatever tool their team uses.
- **Auditor / compliance reviewer** — needs a complete record of what data left the system, in
  what format and at what volume.

## 3. Goals

- CSV joins XLSX and JSON as a first-class export of a run's results.
- Every character class survives the round trip — commas, quotes, newlines.
- Repeated exports of unchanged data produce identical structure.
- CSV is governed exactly as the existing formats are: same permissions, same naming, same audit.
- The egress audit records the format and the volume of every export.

## 4. Non-goals

- A user-configurable CSV dialect (delimiter, quoting, encoding) — one correct dialect.
- Neutralising, escaping or prefixing formula-like values in any format. Formulas may be
  deliberate; only file-corrupting characters are the writer's concern.
- Replacing XLSX. The confidence tab is a two-dimensional artefact CSV cannot represent, and
  XLSX stays the on-screen download.
- Streaming very large exports — the existing buffer-and-store approach is retained.
- Changing the audit schema. `core_audit_log` is append-only (ADR-033) and gains no columns;
  volume goes in the existing `metadata` jsonb.

## 5. Key entities

| Entity | Lives in | New / existing | Notes |
| ------ | -------- | -------------- | ----- |
| `ICsvWriter` | `packages/domain/src/ports/csv-writer.ts` | new | Separate port — different escaping contract, no sheets |
| `CsvTable` | same file | new | `columns: SpreadsheetColumn[]` + `rows` — reuses the column type |
| `ISpreadsheetWriter` | `packages/domain/src/ports/spreadsheet-writer.ts` | existing | Unchanged; multi-sheet XLSX stays its own concern |
| `ExportRunResults` | `packages/application/src/use-cases/extraction/export-run-results.ts` | changed | Emits `results.csv`; audit metadata gains format and volume |

## 6. User stories

1. As an operator, I download run results as CSV and open them in my team's tooling without a
   conversion step.
2. As an operator, a value containing a comma, a quote or a line break survives the export intact.
3. As an operator, exporting the same run twice gives me the same structure both times.
4. As an auditor, I can see that a CSV export happened, who ran it, and how much data left.
5. As an administrator, I know CSV is subject to the same permission checks as XLSX and JSON —
   no format is a side door.

## 7. Pages / surfaces affected

- Extraction run results (`apps/web/src/app/(user)/synthesise/[id]/runs/[runId]/`) — CSV download
  alongside the existing options.
- `apps/web/src/server/routers/` — the export procedure returns the CSV key with the others.
- Admin audit view — CSV exports appear with format and volume, through the existing interface.

## 8. Database changes

**None.** CSV writes to object storage under the existing key pattern, and the audit entry uses
the existing `metadata` jsonb on the append-only `core_audit_log`. No table is created or altered,
so this phase generates no migration.

## 9. Architectural decisions

- **New:** ADR-054 — CSV is its own writer port, not a mode of the spreadsheet writer.
- **Assumes:** ADR-033 (extraction run exports, append-only audit log), and the existing
  `extraction-runs/{runId}/exports/results.{extension}` key pattern.

## 10. Acceptance criteria

**Requirement: CSV Export Functionality**

- [ ] Values containing commas, double quotes and newlines round-trip intact (RFC 4180 quoting,
      with `""` for an embedded quote).
- [ ] A value beginning `=`, `+`, `-` or `@` is written unchanged — not neutralised, prefixed or
      quoted defensively — and the file still parses.
- [ ] Exporting unchanged data twice produces byte-identical output — column order, row order and
      quoting are all deterministic.
- [ ] CSV is subject to the same permission checks as XLSX and JSON — it is the same use case,
      not a separate route.
- [ ] The file follows the established pattern: `extraction-runs/{runId}/exports/results.csv`.
- [ ] A CSV export writes a data-egress audit event naming the CSV format.

**Requirement: Data Egress Audit — largely met, extended here**

- [ ] Actor, timestamp and scope are captured — `actorId`, `createdAt` and
      `resourceType`/`resourceId` already do this.
- [ ] The export format is identified — the existing `formats` array, now including `"csv"`.
- [ ] Data volume is recorded — `recordCount` exists; **byte size per format is the gap and is
      added here**.
- [ ] Audit records are reachable through the standard audit interface — already true; CSV
      exports appear without interface work.
- [ ] Export events follow established retention — already true; they are ordinary
      `core_audit_log` rows under the existing retention policy.

## 11. Out of scope / future work

- Configurable CSV dialects, alternative encodings, or a BOM option for legacy Excel.
- A CSV rendering of the confidence tab as a second file.
- Streaming exports for very large runs.
- Extending CSV to other export surfaces (insights, flow archives).

## 12. Risks / open questions

- **Silent corruption is the whole risk.** A wrongly escaped CSV still opens; the damage shows up
  in someone else's system. Escaping is tested per character class, not by eyeballing a sample.
- **Formulas are emitted as held — decided, not open.** A value starting `=`, `+`, `-` or `@`
  is interpreted as a formula by spreadsheet applications, and that is often deliberate; an
  exported sheet may be *meant* to carry formulas, in CSV and more so in XLSX. Nothing is
  neutralised. The writer intervenes only where a value would corrupt the file itself — an
  unescaped delimiter, quote or newline — never over what a value means to the application that
  opens it.
- **Which sheet CSV represents.** XLSX carries a data tab and a confidence tab; CSV is a single
  table. Current position: CSV mirrors the data tab, with provenance columns from the provenance
  phase — the confidence detail stays in XLSX and JSON.
- **Byte volume across three formats.** Recording one number would be ambiguous; volume is
  recorded per format in the metadata.
