import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { roster } from "../directory/roster.mjs";
import {
  CSV_FILENAME,
  CSV_HEADERS,
  SUGGESTED_COLUMN_MAPPING,
  csvValue,
  employeeToCsvRecord,
  renderCsv,
} from "./dataset.mjs";

const parseCsvLine = (line) => {
  const values = [];
  let current = "";
  let quoted = false;
  for (let position = 0; position < line.length; position += 1) {
    const character = line[position];
    if (quoted && character === '"' && line[position + 1] === '"') {
      current += '"';
      position += 1;
      continue;
    }
    if (character === '"') {
      quoted = !quoted;
      continue;
    }
    if (character === "," && !quoted) {
      values.push(current);
      current = "";
      continue;
    }
    current += character;
  }
  values.push(current);
  return values;
};

const renderedLines = renderCsv().trimEnd().split("\n");

describe("csv shape", () => {
  it("uses the documented header row", () => {
    expect(parseCsvLine(renderedLines[0])).toEqual([
      "Employee ID",
      "Full Name",
      "Employee Email",
      "Manager Email",
      "Job Title",
      "Grade",
      "Business Unit",
      "Location",
      "Start Date",
    ]);
    expect(CSV_HEADERS).toEqual(parseCsvLine(renderedLines[0]));
  });

  it("writes one row per employee under the header", () => {
    expect(renderedLines.length).toBe(roster.length + 1);
  });

  it("ends with a trailing newline so the file is POSIX-clean", () => {
    expect(renderCsv().endsWith("\n")).toBe(true);
  });
});

describe("csv content", () => {
  it("round-trips every employee through the header order", () => {
    roster.forEach((employee, index) => {
      const record = employeeToCsvRecord(employee);
      expect(parseCsvLine(renderedLines[index + 1])).toEqual(
        CSV_HEADERS.map((header) => record[header]),
      );
    });
  });

  it("writes the chief executive with an empty manager cell", () => {
    const chiefExecutive = roster.find((employee) => employee.managerEmail === null);
    expect(employeeToCsvRecord(chiefExecutive)["Manager Email"]).toBe("");
  });

  it("quotes a value containing a comma, a quote or a newline", () => {
    expect(csvValue("Operations, Finance")).toBe('"Operations, Finance"');
    expect(csvValue('He said "no"')).toBe('"He said ""no"""');
    expect(csvValue("two\nlines")).toBe('"two\nlines"');
    expect(csvValue("plain")).toBe("plain");
    expect(csvValue(null)).toBe("");
  });
});

describe("column mapping", () => {
  it("suggests a canonical field for each of the six mappable headers", () => {
    expect(SUGGESTED_COLUMN_MAPPING).toEqual({
      "Employee Email": "email",
      "Full Name": "name",
      "Manager Email": "manager",
      "Job Title": "position",
      Grade: "band",
      "Business Unit": "unit",
    });
  });

  it("leaves the extra headers unmapped, so the import keeps columns it cannot place", () => {
    const unmapped = CSV_HEADERS.filter((header) => !(header in SUGGESTED_COLUMN_MAPPING));
    expect(unmapped).toEqual(["Employee ID", "Location", "Start Date"]);
  });
});

describe("the committed file", () => {
  it("is byte-identical to a fresh render, so it can never drift", () => {
    const committed = readFileSync(
      fileURLToPath(new URL(CSV_FILENAME, import.meta.url)),
      "utf8",
    );
    expect(committed).toBe(renderCsv());
  });
});
