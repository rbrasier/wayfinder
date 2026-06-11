import type { HrSourceFormat } from "../entities/hr-dataset";
import type { Result } from "../result";

export interface ParsedSpreadsheet {
  // Original headers in column order.
  columns: string[];
  // Each row keyed by original header; values coerced to strings, as-uploaded.
  rows: Record<string, string>[];
}

export interface ParseSpreadsheetInput {
  content: Uint8Array;
  format: HrSourceFormat;
}

export interface ISpreadsheetParser {
  parse(input: ParseSpreadsheetInput): Promise<Result<ParsedSpreadsheet>>;
}
