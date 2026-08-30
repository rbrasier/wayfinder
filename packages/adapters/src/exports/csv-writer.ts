import { domainError, err, ok } from "@rbrasier/domain";
import type { CsvTable, ICsvWriter, Result, WriteCsvOutput } from "@rbrasier/domain";

// RFC 4180 line ending. Fixed rather than configurable: a dialect option
// multiplies the ways a consumer can receive something it cannot parse, for a
// benefit no requirement asks for (ADR-054).
const RECORD_SEPARATOR = "\r\n";

// Writes one table as RFC 4180 CSV for the structured export (ADR-054). The
// counterpart to XlsxWriter, kept separate because the escaping contract is the
// whole point: in XLSX commas, quotes and newlines are structurally irrelevant,
// while in CSV those three characters *are* the structure, and getting them
// wrong yields a file that still opens and is silently wrong.
export class CsvWriter implements ICsvWriter {
  write(input: CsvTable): Result<WriteCsvOutput> {
    // A file with no header and no columns to key rows by is not a table anyone
    // can read back, so fail rather than emit zero bytes that look like success.
    if (input.columns.length === 0) {
      return err(domainError("VALIDATION_FAILED", "A CSV table needs at least one column."));
    }

    const header = input.columns.map((column) => escapeField(column.label));
    const lines = [header.join(",")];
    for (const row of input.rows) {
      lines.push(input.columns.map((column) => escapeField(row[column.key] ?? "")).join(","));
    }

    // Every record ends with the separator, the header included, so a file with
    // no rows is a valid one-line CSV rather than a bare unterminated header.
    const text = lines.map((line) => `${line}${RECORD_SEPARATOR}`).join("");
    return ok({ bytes: Buffer.from(text, "utf8") });
  }
}

// A field is quoted only when leaving it bare would corrupt the record structure
// — a delimiter, a quote, or either line-break character. A bare LF is quoted as
// well as CRLF: it breaks the record just the same, and extraction values carry
// LF far more often than CRLF.
const needsQuoting = (value: string): boolean =>
  value.includes(",") || value.includes('"') || value.includes("\n") || value.includes("\r");

const escapeField = (value: string): string =>
  needsQuoting(value) ? `"${value.replaceAll('"', '""')}"` : value;
