import PizZip from "pizzip";
import { describe, expect, it } from "vitest";
import { XlsxWriter } from "./xlsx-writer";

const readSheet = (bytes: Buffer): string => {
  const zip = new PizZip(bytes);
  return zip.file("xl/worksheets/sheet1.xml")?.asText() ?? "";
};

describe("XlsxWriter", () => {
  const writer = new XlsxWriter();

  it("writes a valid workbook with the five OOXML parts", () => {
    const result = writer.write({
      sheetName: "Results",
      columns: [{ key: "name", label: "Name" }],
      rows: [{ name: "Acme" }],
    });
    expect(result.error).toBeUndefined();

    const files = Object.keys(new PizZip(result.data!.bytes).files);
    expect(files).toEqual(
      expect.arrayContaining([
        "[Content_Types].xml",
        "_rels/.rels",
        "xl/workbook.xml",
        "xl/_rels/workbook.xml.rels",
        "xl/worksheets/sheet1.xml",
      ]),
    );
  });

  it("writes the header row and one row per record as inline strings", () => {
    const result = writer.write({
      sheetName: "Results",
      columns: [
        { key: "supplier", label: "Supplier" },
        { key: "price", label: "Price" },
      ],
      rows: [
        { supplier: "Acme", price: "£10" },
        { supplier: "Globex", price: "£20" },
      ],
    });

    const sheet = readSheet(result.data!.bytes);
    expect(sheet).toContain("<t xml:space=\"preserve\">Supplier</t>");
    expect(sheet).toContain("<t xml:space=\"preserve\">Acme</t>");
    expect(sheet).toContain("<t xml:space=\"preserve\">Globex</t>");
    // Header + two data rows.
    expect(sheet.match(/<row /g)).toHaveLength(3);
  });

  it("escapes XML-special characters in values", () => {
    const result = writer.write({
      sheetName: "Results",
      columns: [{ key: "note", label: "Note" }],
      rows: [{ note: "A & B < C" }],
    });
    expect(readSheet(result.data!.bytes)).toContain("A &amp; B &lt; C");
  });

  it("writes a blank cell when a row is missing a column key", () => {
    const result = writer.write({
      sheetName: "Results",
      columns: [
        { key: "a", label: "A" },
        { key: "b", label: "B" },
      ],
      rows: [{ a: "only-a" }],
    });
    const sheet = readSheet(result.data!.bytes);
    expect(sheet).toContain("only-a");
    // The missing B cell is present but empty, keeping the grid rectangular.
    expect(sheet.match(/r="B2"/)).not.toBeNull();
  });

  it("still writes the header when there are no rows", () => {
    const result = writer.write({
      sheetName: "Results",
      columns: [{ key: "a", label: "A" }],
      rows: [],
    });
    const sheet = readSheet(result.data!.bytes);
    expect(sheet).toContain(">A<");
    expect(sheet.match(/<row /g)).toHaveLength(1);
  });

  it("sanitises an invalid sheet name (forbidden characters, length)", () => {
    const result = writer.write({
      sheetName: "Runs/2026: results [final]",
      columns: [{ key: "a", label: "A" }],
      rows: [],
    });
    const workbook = new PizZip(result.data!.bytes).file("xl/workbook.xml")?.asText() ?? "";
    expect(workbook).not.toMatch(/name="[^"]*[\\/:?*[\]][^"]*"/);
  });
});
