import type { Result } from "../result";
import type { SpreadsheetColumn } from "./spreadsheet-writer";

// A single CSV table: the columns to write, and the rows keyed by column key.
// `SpreadsheetColumn` is reused rather than duplicated — the key/label pair means
// the same thing in both formats. The sheet wrapper is deliberately not shared:
// CSV has no tabs, so a port taking a list of sheets would force every caller to
// pass a structure the format cannot honour (ADR-054).
export interface CsvTable {
  columns: SpreadsheetColumn[];
  rows: Array<Record<string, string>>;
}

export interface WriteCsvOutput {
  bytes: Buffer;
}

// Write one table as RFC 4180 CSV. The dialect is fixed — comma delimiter, CRLF
// line endings, UTF-8, a field quoted only when it contains a comma, a double
// quote or a line break, with an embedded quote doubled. Output is deterministic:
// the same table twice produces byte-identical bytes, which is what makes
// "consistent structure across export requests" checkable (ADR-054).
export interface ICsvWriter {
  write(input: CsvTable): Result<WriteCsvOutput>;
}
