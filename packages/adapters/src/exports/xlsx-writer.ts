import PizZip from "pizzip";
import { domainError, err, ok } from "@rbrasier/domain";
import type {
  ISpreadsheetWriter,
  Result,
  WriteSpreadsheetInput,
  WriteSpreadsheetOutput,
} from "@rbrasier/domain";

// Builds a fresh .xlsx workbook from a header + rows for the structured export
// (phase §2.2, ADR-039 risk: "the writer is new work"). This is the multi-row
// export counterpart to the single-record template-fill XlsxGenerator — it
// authors a workbook from nothing rather than filling an uploaded one, so it
// lives here rather than reusing that generator. All cells are inline strings, so
// no shared-strings table is needed and every value round-trips verbatim.
export class XlsxWriter implements ISpreadsheetWriter {
  write(input: WriteSpreadsheetInput): Result<WriteSpreadsheetOutput> {
    try {
      const zip = new PizZip();
      zip.file("[Content_Types].xml", CONTENT_TYPES);
      zip.file("_rels/.rels", ROOT_RELS);
      zip.file("xl/workbook.xml", workbookXml(input.sheetName));
      zip.file("xl/_rels/workbook.xml.rels", WORKBOOK_RELS);
      zip.file("xl/worksheets/sheet1.xml", sheetXml(input));
      const bytes = zip.generate({ type: "nodebuffer", compression: "DEFLATE" }) as Buffer;
      return ok({ bytes });
    } catch (cause) {
      return err(domainError("INFRA_FAILURE", "Failed to write the spreadsheet export.", cause));
    }
  }
}

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
</Types>`;

const ROOT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`;

const WORKBOOK_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
</Relationships>`;

const workbookXml = (sheetName: string): string =>
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets><sheet name="${escapeXml(sanitiseSheetName(sheetName))}" sheetId="1" r:id="rId1"/></sheets>
</workbook>`;

const sheetXml = (input: WriteSpreadsheetInput): string => {
  const headerCells = input.columns.map((column, index) => cell(index, 1, column.label));
  const rows = [`<row r="1">${headerCells.join("")}</row>`];

  input.rows.forEach((rowValues, rowIndex) => {
    const rowNumber = rowIndex + 2;
    const cells = input.columns.map((column, columnIndex) =>
      cell(columnIndex, rowNumber, rowValues[column.key] ?? ""),
    );
    rows.push(`<row r="${rowNumber}">${cells.join("")}</row>`);
  });

  const lastColumn = columnLetter(Math.max(0, input.columns.length - 1));
  const lastRow = input.rows.length + 1;
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
