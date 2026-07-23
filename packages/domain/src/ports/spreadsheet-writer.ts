import type { Result } from "../result";

// A column in a from-scratch export sheet: the value key it reads from each row,
// and the human heading written in the header row.
export interface SpreadsheetColumn {
  key: string;
  label: string;
}

// Build a fresh workbook (header row + one row per record) for the structured
// export (phase §2.2). Distinct from IDocumentGenerator, which fills an uploaded
// template in place — this writes a new .xlsx from nothing. A row is keyed by
// column key; a missing key writes a blank cell.
export interface WriteSpreadsheetInput {
  sheetName: string;
  columns: SpreadsheetColumn[];
  rows: Array<Record<string, string>>;
}

export interface WriteSpreadsheetOutput {
  bytes: Buffer;
}

export interface ISpreadsheetWriter {
  write(input: WriteSpreadsheetInput): Result<WriteSpreadsheetOutput>;
}
