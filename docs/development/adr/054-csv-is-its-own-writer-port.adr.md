# ADR-054 — CSV Is Its Own Writer Port, Not a Mode of the Spreadsheet Writer

- **Status**: Proposed (scoped by `structured-data-export.prd.md`)
- **Date**: 2026-08-24
- **Builds on**: ADR-033 (extraction run exports and the append-only audit log)

## Context

Adding CSV to the run export invites an obvious shortcut: `ISpreadsheetWriter` already turns
columns and rows into a file, so give it a format argument. That port is shaped for something
else, though:

```typescript
export interface SpreadsheetSheet {
  name: string;
  columns: SpreadsheetColumn[];
  rows: Array<Record<string, string>>;
}

export interface WriteSpreadsheetInput {
  sheets: SpreadsheetSheet[];
}
```

— `packages/domain/src/ports/spreadsheet-writer.ts`

Its input is a *list of sheets*, each named, "written in the order given, which is the order
Excel shows the tabs in". The run export uses that plurality deliberately: a data tab an operator
can paste into a report, and a separate confidence tab in long form because rationale is a
sentence or two per cell.

CSV has no sheets, no tab names and no ordering between them. A format flag on this port would
mean every CSV call passes a structure it cannot honour, and every implementation answers "what
happens to sheets 2..n?" — silently drop them, concatenate them, or fail. All three are bad, and
the question only exists because the port was widened past what the format supports.

The escaping contracts differ just as much. An XLSX cell holds a string; commas, quotes and
newlines are structurally irrelevant. In CSV those three characters *are* the structure, and
getting them wrong produces a file that still opens and is silently wrong — the failure mode this
export exists to avoid.

There is precedent for CSV in the codebase, at the route layer:

```typescript
.input(filterInputSchema.extend({ format: z.enum(["csv", "json"]) }))
```

— `apps/web/src/server/routers/audit.ts:37`, which serialises audit rows inline. Convenient
there, but it puts escaping in a router, which is exactly where a domain concern should not live.

## Decision

**A separate `ICsvWriter` port, taking a single table.**

```typescript
export interface CsvTable {
  columns: SpreadsheetColumn[];
  rows: Array<Record<string, string>>;
}

export interface ICsvWriter {
  write(input: CsvTable): Result<{ bytes: Buffer }>;
}
```

`SpreadsheetColumn` is reused rather than duplicated — the key/label pair means the same thing in
both formats, and sharing it keeps a caller from having to translate between two identical types.
What is *not* shared is the sheet wrapper, because that is the part CSV cannot represent.

`ISpreadsheetWriter` is untouched. Multi-sheet XLSX remains its own concern, and the run export
calls both writers for their respective outputs.

**The dialect is fixed: RFC 4180.** Comma delimiter, `CRLF` line endings, UTF-8, and a field
quoted when it contains a comma, a double quote or a line break, with an embedded quote doubled
(`""`). No configuration. A configurable dialect multiplies the ways a consumer can receive
something it cannot parse, for a benefit no requirement asks for.

**Output is deterministic.** Column order follows the schema's field order and row order follows
the record order, so exporting unchanged data twice yields byte-identical files — which is what
makes "consistent structure across multiple export requests" checkable rather than a matter of
opinion.

**CSV mirrors the data tab only.** The confidence tab is long-form, one row per record × field —
a second, differently-shaped table. Emitting it as a second CSV would mean two files under one
export key pattern; it stays in XLSX and JSON.

**Formula-prefixed values are emitted faithfully.** A value beginning `=`, `+`, `-` or `@` is
treated as a formula by spreadsheet applications. Neutralising it would alter exported data to
defend against one consumer's behaviour, and this is a data export rather than a document. The
value goes out as it came in, and the risk is recorded rather than silently mitigated.

## Consequences

- Two writer ports exist where one *looked* sufficient. The duplication is one small interface;
  the alternative was a port whose input shape lies about what half its callers can do.
- Escaping lives in the adapter behind a domain port, testable per character class, and reusable —
  the audit router's inline CSV can move behind it later, though this ADR does not require it.
- CSV cannot gain tabs without a new decision, which is the intended constraint: a request for
  "the confidence data in CSV too" surfaces as a design question rather than as a silently
  dropped sheet.
- Fixing the dialect means a consumer needing semicolons or UTF-16 is unsupported until a
  requirement justifies it. Accepted deliberately.
- Faithful emission of formula-prefixed values is a known, documented risk rather than a hidden
  one, and can be revisited without changing the port.
