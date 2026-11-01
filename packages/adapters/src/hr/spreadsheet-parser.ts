import PizZip from "pizzip";
import {
  domainError,
  err,
  ok,
  type ISpreadsheetParser,
  type ParsedSpreadsheet,
  type ParseSpreadsheetInput,
  type Result,
} from "@wayfinder/domain";
import { normaliseSheetPath, readSharedStrings, readSheet } from "../spreadsheets/xlsx-workbook";

// CSV/XLSX parser for HR uploads. Rows are returned in the structure they arrived
// in — original headers preserved, values as strings — so the dataset can be
// stored as-uploaded (ADR-018). XLSX is read with PizZip (already a dependency);
// no SheetJS-style library is pulled in.
export class SpreadsheetParser implements ISpreadsheetParser {
  async parse(input: ParseSpreadsheetInput): Promise<Result<ParsedSpreadsheet>> {
    try {
      const grid =
        input.format === "csv"
          ? parseCsv(new TextDecoder().decode(input.content))
          : parseXlsx(input.content);
      return ok(toSpreadsheet(grid));
    } catch (cause) {
      return err(domainError("VALIDATION_FAILED", "Could not parse the uploaded spreadsheet.", cause));
    }
  }
}

// Assembles header-keyed rows from a raw grid whose first row is the header.
const toSpreadsheet = (grid: string[][]): ParsedSpreadsheet => {
  if (grid.length === 0) return { columns: [], rows: [] };
  const headers = (grid[0] ?? []).map((header) => header.trim());
  const rows = grid.slice(1).map((cells) => {
    const row: Record<string, string> = {};
    headers.forEach((header, index) => {
      if (!header) return;
      row[header] = cells[index] ?? "";
    });
    return row;
  });
  return { columns: headers.filter((header) => header.length > 0), rows };
};

// ── CSV ──────────────────────────────────────────────────────────────────────

const parseCsv = (text: string): string[][] => {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;
  let index = 0;

  const pushCell = () => {
    row.push(cell);
    cell = "";
  };
  const pushRow = () => {
    pushCell();
    rows.push(row);
    row = [];
  };

  while (index < text.length) {
    const char = text[index]!;
    if (inQuotes) {
      if (char === '"') {
        if (text[index + 1] === '"') {
          cell += '"';
          index += 2;
          continue;
        }
        inQuotes = false;
        index += 1;
        continue;
      }
      cell += char;
      index += 1;
      continue;
    }
    if (char === '"') {
      inQuotes = true;
      index += 1;
      continue;
    }
    if (char === ",") {
      pushCell();
      index += 1;
      continue;
    }
    if (char === "\n") {
      pushRow();
      index += 1;
      continue;
    }
    if (char === "\r") {
      index += 1;
      continue;
    }
    cell += char;
    index += 1;
  }
  // Flush the trailing cell/row unless the file ended on a clean newline.
  if (cell.length > 0 || row.length > 0) pushRow();
  return rows.filter((cells) => cells.some((value) => value.length > 0));
};

// ── XLSX ─────────────────────────────────────────────────────────────────────

const parseXlsx = (content: Uint8Array): string[][] => {
  const zip = new PizZip(content);
  const sharedStrings = readSharedStrings(zip);
  const preferred = firstSheetPart(zip);
  const sheetName = preferred && zip.file(preferred) ? preferred : fallbackSheetPart(zip);
  if (!sheetName) return [];
  const sheetXml = zip.file(sheetName)?.asText() ?? "";
  return readSheet(sheetXml, sharedStrings);
};

// The worksheet *part* name (sheet1.xml, sheet2.xml…) does not track tab order:
// after a tab is reordered or deleted, the first visible tab can map to any
// part. The authoritative order is the first <sheet> in xl/workbook.xml,
// resolved through the workbook relationships to its part. Returns null when the
// workbook/rels are absent so the caller can fall back to the old part-sort.
const firstSheetPart = (zip: PizZip): string | null => {
  const workbookXml = zip.file("xl/workbook.xml")?.asText();
  if (!workbookXml) return null;
  const firstSheet = /<sheet\b[^>]*>/.exec(workbookXml)?.[0];
  if (!firstSheet) return null;
  const relationshipId = /r:id="([^"]+)"/.exec(firstSheet)?.[1];
  if (!relationshipId) return null;

  const relsXml = zip.file("xl/_rels/workbook.xml.rels")?.asText();
  if (!relsXml) return null;
  for (const relationship of relsXml.matchAll(/<Relationship\b([^>]*)>/g)) {
    const attributes = relationship[1] ?? "";
    if (/Id="([^"]+)"/.exec(attributes)?.[1] !== relationshipId) continue;
    const target = /Target="([^"]+)"/.exec(attributes)?.[1];
    return target ? normaliseSheetPath(target) : null;
  }
  return null;
};

const fallbackSheetPart = (zip: PizZip): string | undefined =>
  Object.keys(zip.files)
    .filter((name) => /^xl\/worksheets\/sheet\d+\.xml$/.test(name))
    .sort()[0];
