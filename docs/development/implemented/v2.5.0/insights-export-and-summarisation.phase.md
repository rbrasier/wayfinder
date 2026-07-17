# Phase — Insights Export & On-Screen Summarisation

- **Status**: Draft — awaiting `/doc-review`
- **Target version**: **MINOR** — 2.4.11 → **2.5.0** (two new read-only reporting
  features, no schema change)
- **PRD**: `docs/development/prd/insights-export-and-summarisation.prd.md`
- **ADR**: none (client-side read models over the existing `FieldReport`)
- **Base branch**: `main` (new features never target a `release/alpha-N` branch)
- **Depends on**: existing `analytics.flowDeepDive` + `computeFieldReport`
  (`packages/domain/src/entities/analytics.ts`), existing `IAuditLogger` /
  `LogAuditEvent`, recharts (already a dependency)

## 1. Goal

Let an operator (a) **export the flow-insights field report to `.xlsx` in the
browser**, mirroring their current filtered view with typed numeric cells, and
(b) **summarise it on screen** via a side-drawer pivot table + chart — without
adding any table, port, or server-side report computation.

## 2. Approach

Everything both features need is already in the browser. `FieldReportSection`
holds the whole `FieldReport` and derives `displayedColumns` and `filteredRows`
(after visibility, fork/version collapse, and date/status/value filters). Export
serialises that derived view; the pivot aggregates over the same `filteredRows`.

The one shared piece worth building once is a **typed display view**: a pure
helper that, given a `DisplayColumn` and a raw string cell, returns a typed value
using the column `type` (currency/number → `number` via `parseNumeric`,
everything else → `string`). Export writes typed cells from it; the pivot
measures over it.

The only server touch is emitting the export audit event — a thin tRPC mutation
calling the existing `LogAuditEvent`.

## 3. What is built

### Domain (`packages/domain`) — pure, test-first

| File | Change |
|------|--------|
| `src/entities/field-report-view.ts` (new) | `typedCellValue(type, raw): number \| string` and a `DisplayCell` shape. Pure; reuses `parseNumeric`. |
| `src/entities/field-report-pivot.ts` (new) | `computePivot(rows, { groupByKey, secondaryGroupByKey?, measure })` where `measure` is `{ kind: "count" } \| { kind: "sum" \| "avg"; columnKey }`. Returns pivot rows/cells + column totals. Coerces via `typedCellValue`. Pure. |
| `src/entities/index.ts` | Export the new symbols. |

Write `field-report-pivot.test.ts` and `field-report-view.test.ts` **first** —
they are the spec (count grouping, sum/avg over currency, empty/non-numeric
degradation, secondary group-by matrix).

### Application (`packages/application`)

No new use-case for export/pivot themselves (client-side). The audit emit reuses
the existing `LogAuditEvent`; no application change beyond wiring already present.

### Adapters (`packages/adapters`)

None. (xlsx generation is a browser concern; audit uses the existing
`DrizzleAuditLogger`.)

### Web (`apps/web`)

| File | Change |
|------|--------|
| `src/server/routers/analytics.ts` | Add `logInsightsExport` **mutation** (adminProcedure): input `{ flowId, rowCount, columnCount, filters }`; calls `ctx.container.useCases.logAuditEvent.execute({ actorId, action: "insights.exported", resourceType: "flow", resourceId: flowId, metadata })`. |
| `src/components/admin/field-report-section.tsx` | Add **Export** button (builds xlsx from `displayedColumns` + `filteredRows` via the typed-cell helper; lazy-loads the writer; fires `logInsightsExport`). Add **Summarise** button opening the drawer. |
| `src/components/admin/field-report-pivot-drawer.tsx` (new) | Side-drawer UI: group-by select, optional secondary group-by, measure select (count / sum / avg + column), pivot table, recharts chart (reuse the `ChartCard` pattern from `dashboards/flows/_content.tsx`). Consumes `computePivot` over the parent's `filteredRows`. |
| `src/components/ui/sheet.tsx` (new, only if absent) | Side-drawer primitive (a `Dialog` variant already exists for the Columns modal; add a right-anchored Sheet if one isn't present). |

## 4. Export semantics

- Export **the current view**: `displayedColumns` (respecting visibility +
  fork/version collapse) and `filteredRows` (respecting date/status/value
  filters), plus the always-shown Started and Status columns.
- Collapsed columns export as a single column using the existing
  `coalesceValue(row.values, col.memberKeys)`.
- Cell typing via `typedCellValue`: currency/number → numeric cell; everything
  else → text. Empty → blank cell.
- Filename: `${flowName}-insights-${YYYY-MM-DD}.xlsx`.
- Verify the chosen xlsx browser library's exact API in `node_modules` before
  use (repo rule); lazy-load it so it stays out of the initial insights bundle.

## 5. Audit event

Reuses `core_audit_log` via `IAuditLogger` — **no new table**:

```
action:        "insights.exported"
resourceType:  "flow"
resourceId:    <flowId>
actorId:       <current admin user id>
metadata:      { rowCount, columnCount, filters: { datePreset, statusFilter, filterColumnKey, ... } }
```

## 6. Database changes

**None.**

## 7. Implementation order (tests first)

1. `field-report-view.ts` + test — typed cell coercion.
2. `field-report-pivot.ts` + test — `computePivot` (count, sum, avg, secondary
   group-by, empty/non-numeric).
3. `analytics.logInsightsExport` mutation + test (emits the audit event).
4. Export button in `FieldReportSection` (xlsx from the typed view; fire the
   mutation).
5. `field-report-pivot-drawer.tsx` + Sheet primitive; wire Summarise button.
6. `./validate.sh`; bump `VERSION` + `package.json#version` to 2.5.0.

## 8. Risks / open questions

Carried from PRD §12: browser xlsx library choice + bundle size (lazy-load the
writer); export-the-view vs export-all (decision: **the view**; an "all
columns/rows" toggle is deferred); pivot placement (decision: **side drawer**,
not modal). Non-numeric values are omitted from sum/avg measures, matching the
existing filter-bar semantics.

## 9. Acceptance criteria

Mirror PRD §10:

- [ ] Export produces a valid `.xlsx` (Excel / LibreOffice / Google Sheets).
- [ ] Exported sheet mirrors the on-screen view (visible + collapsed columns,
      active filters, Started + Status).
- [ ] Currency/number columns are numeric cells; other types are text.
- [ ] Summarise drawer groups filtered rows and shows count/sum/avg as a pivot
      table + chart, with the source table still visible.
- [ ] Numeric measure with no numeric values degrades gracefully.
- [ ] Each export emits an `insights.exported` audit event with the metadata
      above.
- [ ] `computePivot` and the typed-cell helper have tests written before
      implementation; `./validate.sh` passes with `VERSION` /
      `package.json#version` matched at 2.5.0.
