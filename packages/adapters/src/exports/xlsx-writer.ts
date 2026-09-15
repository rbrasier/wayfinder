import PizZip from "pizzip";
import { domainError, err, ok } from "@wayfinder/domain";
import type {
  ISpreadsheetWriter,
  Result,
  SpreadsheetSheet,
  WriteSpreadsheetInput,
  WriteSpreadsheetOutput,
} from "@wayfinder/domain";

// Builds a fresh .xlsx workbook from one or more tabs for the structured export
// (phase §2.2, ADR-039 risk: "the writer is new work"). This is the multi-row
// export counterpart to the single-record template-fill XlsxGenerator — it
// authors a workbook from nothing rather than filling an uploaded one, so it
// lives here rather than reusing that generator. All cells are inline strings, so
// no shared-strings table is needed and every value round-trips verbatim.
export class XlsxWriter implements ISpreadsheetWriter {
  write(input: WriteSpreadsheetInput): Result<WriteSpreadsheetOutput> {
    // Excel refuses a package with no worksheet, so fail here rather than emit a
    // file the operator cannot open.
    if (input.sheets.length === 0) {
      return err(domainError("VALIDATION_FAILED", "A workbook needs at least one sheet."));
    }

    try {
      const zip = new PizZip();
      zip.file("[Content_Types].xml", contentTypesXml(input.sheets.length));
      zip.file("_rels/.rels", ROOT_RELS);
      zip.file("xl/workbook.xml", workbookXml(input.sheets));
      zip.file("xl/_rels/workbook.xml.rels", workbookRelsXml(input.sheets.length));
      input.sheets.forEach((sheet, index) => {
        zip.file(`xl/worksheets/${sheetPart(index)}`, sheetXml(sheet));
      });
      const bytes = zip.generate({ type: "nodebuffer", compression: "DEFLATE" }) as Buffer;
      return ok({ bytes });
    } catch (cause) {
      return err(domainError("INFRA_FAILURE", "Failed to write the spreadsheet export.", cause));
    }
  }
}

// Part name, relationship id and sheet id all key off the same index, so a sheet
// declared in workbook.xml always resolves to the worksheet written beside it.
const sheetPart = (index: number): string => `sheet${index + 1}.xml`;
const relationshipId = (index: number): string => `rId${index + 1}`;

const contentTypesXml = (sheetCount: number): string => {
  const overrides = Array.from(
    { length: sheetCount },
    (_unused, index) =>
      `<Override PartName="/xl/worksheets/${sheetPart(index)}" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
  ).join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
${overrides}
</Types>`;
};

const ROOT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`;

const workbookRelsXml = (sheetCount: number): string => {
  const relationships = Array.from(
    { length: sheetCount },
    (_unused, index) =>
      `<Relationship Id="${relationshipId(index)}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/${sheetPart(index)}"/>`,
  ).join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
${relationships}
</Relationships>`;
};

const workbookXml = (sheets: SpreadsheetSheet[]): string => {
  const declarations = sheets
    .map(
      (sheet, index) =>
        `<sheet name="${escapeXml(sanitiseSheetName(sheet.name))}" sheetId="${index + 1}" r:id="${relationshipId(index)}"/>`,
    )
    .join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets>${declarations}</sheets>
</workbook>`;
};

const sheetXml = (sheet: SpreadsheetSheet): string => {
  const headerCells = sheet.columns.map((column, index) => cell(index, 1, column.label));
  const rows = [`<row r="1">${headerCells.join("")}</row>`];

  sheet.rows.forEach((rowValues, rowIndex) => {
    const rowNumber = rowIndex + 2;
    const cells = sheet.columns.map((column, columnIndex) =>
      cell(columnIndex, rowNumber, rowValues[column.key] ?? ""),
    );
    rows.push(`<row r="${rowNumber}">${cells.join("")}</row>`);
  });

  const lastColumn = columnLetter(Math.max(0, sheet.columns.length - 1));
  const lastRow = sheet.rows.length + 1;
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<dimension ref="A1:${lastColumn}${lastRow}"/>
<sheetData>${rows.join("")}</sheetData>
</worksheet>`;
};

const cell = (columnIndex: number, rowNumber: number, value: string): string =>
  `<c r="${columnLetter(columnIndex)}${rowNumber}" t="inlineStr"><is><t xml:space="preserve">${escapeXml(value)}</t></is></c>`;

// Excel rejects : \ / ? * [ ] in a sheet name and caps it at 31 characters.
const sanitiseSheetName = (name: string): string => {
  const cleaned = name.replace(/[\\/:?*[\]]/g, " ").trim();
  const bounded = cleaned.slice(0, 31).trim();
  return bounded.length > 0 ? bounded : "Results";
};

const columnLetter = (index: number): string => {
  let result = "";
  let n = index;
  do {
    result = String.fromCharCode(65 + (n % 26)) + result;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return result;
};

const escapeXml = (value: string): string =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
