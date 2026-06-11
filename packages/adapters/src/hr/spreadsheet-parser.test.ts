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

  it("returns no columns for an empty CSV", async () => {
    const result = await new SpreadsheetParser().parse({ content: encode(""), format: "csv" });
    expect(result.data?.columns).toEqual([]);
    expect(result.data?.rows).toEqual([]);
  });
});
