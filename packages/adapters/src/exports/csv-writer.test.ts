import { describe, expect, it } from "vitest";
import type { CsvTable } from "@rbrasier/domain";
import { CsvWriter } from "./csv-writer";

const NAME_COLUMN = [{ key: "name", label: "Name" }];

const table = (
  columns: CsvTable["columns"],
  rows: CsvTable["rows"],
): CsvTable => ({ columns, rows });

const written = (input: CsvTable): string => {
  const result = new CsvWriter().write(input);
  expect(result.error).toBeUndefined();
  return result.data!.bytes.toString("utf8");
};

describe("CsvWriter", () => {
  it("quotes a value containing a comma", () => {
    const csv = written(table(NAME_COLUMN, [{ name: "Acme, Ltd" }]));

    expect(csv).toBe('Name\r\n"Acme, Ltd"\r\n');
  });

  it("doubles an embedded double quote and quotes the field", () => {
    const csv = written(table(NAME_COLUMN, [{ name: 'He said "hello"' }]));

    expect(csv).toBe('Name\r\n"He said ""hello"""\r\n');
  });

  it("quotes a value containing CRLF and keeps the break intact", () => {
    const csv = written(table(NAME_COLUMN, [{ name: "line one\r\nline two" }]));

    expect(csv).toBe('Name\r\n"line one\r\nline two"\r\n');
  });

  it("quotes a value containing a bare LF and keeps the break intact", () => {
    const csv = written(table(NAME_COLUMN, [{ name: "line one\nline two" }]));

    expect(csv).toBe('Name\r\n"line one\nline two"\r\n');
  });

  it("writes a value needing no quoting bare", () => {
    const csv = written(table(NAME_COLUMN, [{ name: "Acme Ltd" }]));

    expect(csv).toBe("Name\r\nAcme Ltd\r\n");
  });

  it("writes an empty field for both an empty value and a missing key", () => {
    const columns = [
      { key: "name", label: "Name" },
      { key: "note", label: "Note" },
    ];
    const csv = written(table(columns, [{ name: "", note: "kept" }, { note: "kept" }]));

    expect(csv).toBe("Name,Note\r\n,kept\r\n,kept\r\n");
  });

  // ADR-054: a formula may be exactly what the author intended. The writer's
  // remit is a file that parses, never what the receiving application makes of a
  // value, so nothing is neutralised, prefixed or defensively quoted.
  it("writes a formula-like value unchanged and still parses", () => {
    const csv = written(
      table(NAME_COLUMN, [{ name: "=SUM(A1:A2)" }, { name: "+1" }, { name: "-1" }, { name: "@handle" }]),
    );

    expect(csv).toBe("Name\r\n=SUM(A1:A2)\r\n+1\r\n-1\r\n@handle\r\n");
  });

  it("writes labels in the header row and data in column order", () => {
    const columns = [
      { key: "supplier", label: "Supplier" },
      { key: "price", label: "Price" },
    ];
    const csv = written(table(columns, [{ price: "10", supplier: "Acme" }]));

    expect(csv).toBe("Supplier,Price\r\nAcme,10\r\n");
  });

  it("quotes a header label that needs it, on the same rules as a value", () => {
    const csv = written(table([{ key: "name", label: 'Name, "full"' }], []));

    expect(csv).toBe('"Name, ""full"""\r\n');
  });

  it("produces byte-identical output for the same input twice", () => {
    const input = table(
      [
        { key: "supplier", label: "Supplier" },
        { key: "note", label: "Note" },
      ],
      [
        { supplier: "Acme, Ltd", note: 'said "yes"' },
        { supplier: "Globex", note: "line one\nline two" },
      ],
    );
    const writer = new CsvWriter();

    const first = writer.write(input);
    const second = writer.write(input);

    expect(first.data!.bytes.equals(second.data!.bytes)).toBe(true);
  });

  it("writes UTF-8 bytes with no byte-order mark", () => {
    const bytes = new CsvWriter().write(table(NAME_COLUMN, [{ name: "café £10" }])).data!.bytes;

    expect(bytes.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf]))).toBe(false);
    expect(bytes.toString("utf8")).toBe("Name\r\ncafé £10\r\n");
  });

  it("writes a header row and nothing else when there are no rows", () => {
    const csv = written(table(NAME_COLUMN, []));

    expect(csv).toBe("Name\r\n");
  });

  it("refuses a table with no columns rather than writing an empty file", () => {
    const result = new CsvWriter().write(table([], [{ name: "Acme" }]));

    expect(result.data).toBeUndefined();
    expect(result.error?.code).toBe("VALIDATION_FAILED");
  });
});
