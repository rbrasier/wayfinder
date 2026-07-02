import { describe, it, expect } from "vitest";
import PizZip from "pizzip";
import { SpreadsheetParser } from "./spreadsheet-parser";

const encode = (text: string): Uint8Array => new TextEncoder().encode(text);

// Builds the minimal valid XLSX parts the parser reads: a shared-strings table
// and one worksheet whose cells reference it by index.
const buildXlsx = (headers: string[], rows: string[][]): Uint8Array => {
  const strings = [...headers, ...rows.flat()];
  const stringIndex = new Map<string, number>();
  strings.forEach((value) => {
    if (!stringIndex.has(value)) stringIndex.set(value, stringIndex.size);
  });
  const uniqueStrings = [...stringIndex.keys()];

  const sst = `<?xml version="1.0"?><sst xmlns="x">${uniqueStrings
    .map((value) => `<si><t>${value}</t></si>`)
    .join("")}</sst>`;

  const columnLetter = (index: number) => String.fromCharCode(65 + index);
  const toRowXml = (cells: string[], rowNumber: number) =>
    `<row r="${rowNumber}">${cells
      .map(
        (value, index) =>
          `<c r="${columnLetter(index)}${rowNumber}" t="s"><v>${stringIndex.get(value)}</v></c>`,
      )
      .join("")}</row>`;

  const sheetData = [headers, ...rows]
    .map((cells, index) => toRowXml(cells, index + 1))
    .join("");
  const sheet = `<?xml version="1.0"?><worksheet xmlns="x"><sheetData>${sheetData}</sheetData></worksheet>`;

  const zip = new PizZip();
  zip.file("xl/sharedStrings.xml", sst);
  zip.file("xl/worksheets/sheet1.xml", sheet);
  return zip.generate({ type: "uint8array" });
};

describe("SpreadsheetParser", () => {
  it("parses CSV into header-keyed rows", async () => {
    const csv = "Full Name,Email,Manager\nAda Lovelace,ada@corp.test,bob@corp.test\nBob Stone,bob@corp.test,\n";
    const result = await new SpreadsheetParser().parse({ content: encode(csv), format: "csv" });

    expect(result.error).toBeUndefined();
    expect(result.data?.columns).toEqual(["Full Name", "Email", "Manager"]);
    expect(result.data?.rows).toEqual([
      { "Full Name": "Ada Lovelace", Email: "ada@corp.test", Manager: "bob@corp.test" },
      { "Full Name": "Bob Stone", Email: "bob@corp.test", Manager: "" },
    ]);
  });

  it("honours quoted CSV fields containing commas and escaped quotes", async () => {
    const csv = 'Name,Note\n"Stone, Bob","He said ""hi"""\n';
    const result = await new SpreadsheetParser().parse({ content: encode(csv), format: "csv" });

    expect(result.data?.rows[0]).toEqual({ Name: "Stone, Bob", Note: 'He said "hi"' });
  });

  it("parses XLSX shared-string cells preserving headers", async () => {
    const content = buildXlsx(
      ["Full Name", "Email"],
      [
        ["Ada Lovelace", "ada@corp.test"],
        ["Bob Stone", "bob@corp.test"],
      ],
    );
    const result = await new SpreadsheetParser().parse({ content, format: "xlsx" });

    expect(result.error).toBeUndefined();
    expect(result.data?.columns).toEqual(["Full Name", "Email"]);
    expect(result.data?.rows).toEqual([
      { "Full Name": "Ada Lovelace", Email: "ada@corp.test" },
      { "Full Name": "Bob Stone", Email: "bob@corp.test" },
    ]);
  });

  it("reads the workbook's first tab even when it maps to a non-first part", async () => {
    // The first visible tab ("Data") maps to sheet2.xml; the lexicographically
    // first part (sheet1.xml) is a different tab ("Notes"). The old code sorted
    // part names and read the wrong sheet.
    const dataSheet =
      '<?xml version="1.0"?><worksheet xmlns="x"><sheetData>' +
      '<row r="1"><c r="A1" t="inlineStr"><is><t>Full Name</t></is></c></row>' +
      '<row r="2"><c r="A2" t="inlineStr"><is><t>Ada Lovelace</t></is></c></row>' +
      "</sheetData></worksheet>";
    const notesSheet =
      '<?xml version="1.0"?><worksheet xmlns="x"><sheetData>' +
      '<row r="1"><c r="A1" t="inlineStr"><is><t>Ignore Me</t></is></c></row>' +
      "</sheetData></worksheet>";
    const workbook =
      '<?xml version="1.0"?><workbook xmlns:r="r"><sheets>' +
      '<sheet name="Data" sheetId="1" r:id="rId1"/>' +
      '<sheet name="Notes" sheetId="2" r:id="rId2"/>' +
      "</sheets></workbook>";
    const rels =
      '<?xml version="1.0"?><Relationships>' +
      '<Relationship Id="rId1" Target="worksheets/sheet2.xml"/>' +
      '<Relationship Id="rId2" Target="worksheets/sheet1.xml"/>' +
      "</Relationships>";

    const zip = new PizZip();
    zip.file("xl/workbook.xml", workbook);
    zip.file("xl/_rels/workbook.xml.rels", rels);
    zip.file("xl/worksheets/sheet1.xml", notesSheet);
    zip.file("xl/worksheets/sheet2.xml", dataSheet);
    const content = zip.generate({ type: "uint8array" });

    const result = await new SpreadsheetParser().parse({ content, format: "xlsx" });

    expect(result.error).toBeUndefined();
    expect(result.data?.columns).toEqual(["Full Name"]);
    expect(result.data?.rows).toEqual([{ "Full Name": "Ada Lovelace" }]);
  });

  it("returns no columns for an empty CSV", async () => {
    const result = await new SpreadsheetParser().parse({ content: encode(""), format: "csv" });
    expect(result.data?.columns).toEqual([]);
    expect(result.data?.rows).toEqual([]);
  });
});
