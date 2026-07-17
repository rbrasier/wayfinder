import { describe, it, expect } from "vitest";
import { coalesceValue, typedCellValue, typedDisplayCell } from "./field-report-view";

describe("typedDisplayCell", () => {
  it("coerces a currency value to a numeric cell", () => {
    const cell = typedDisplayCell("currency", "$1,234.50");

    expect(cell).toEqual({ value: 1234.5, isNumeric: true });
  });

  it("coerces a number value to a numeric cell", () => {
    const cell = typedDisplayCell("number", "42");

    expect(cell).toEqual({ value: 42, isNumeric: true });
  });

  it("keeps a non-numeric value in a numeric column as text", () => {
    const cell = typedDisplayCell("currency", "TBD");

    expect(cell).toEqual({ value: "TBD", isNumeric: false });
  });

  it("treats an empty value as a blank text cell", () => {
    expect(typedDisplayCell("currency", "")).toEqual({ value: "", isNumeric: false });
    expect(typedDisplayCell("text", "")).toEqual({ value: "", isNumeric: false });
  });

  it("keeps text, yesno, and enum-style columns as text even when they look numeric", () => {
    expect(typedDisplayCell("text", "100")).toEqual({ value: "100", isNumeric: false });
    expect(typedDisplayCell("yesno", "Yes")).toEqual({ value: "Yes", isNumeric: false });
    expect(typedDisplayCell("section", "No")).toEqual({ value: "No", isNumeric: false });
  });
});

describe("typedCellValue", () => {
  it("returns the numeric value for a currency column", () => {
    expect(typedCellValue("number", "3.5")).toBe(3.5);
  });

  it("returns the raw string for a text column", () => {
    expect(typedCellValue("text", "Vendor A")).toBe("Vendor A");
  });

  it("returns the raw string for an unparseable numeric column", () => {
    expect(typedCellValue("currency", "N/A")).toBe("N/A");
  });
});

describe("coalesceValue", () => {
  it("returns the first non-empty member value", () => {
    const values = { "n1:cost": "", "n2:cost": "500" };

    expect(coalesceValue(values, ["n1:cost", "n2:cost"])).toBe("500");
  });

  it("returns an empty string when no member has a value", () => {
    expect(coalesceValue({ "n1:cost": "" }, ["n1:cost", "n2:cost"])).toBe("");
  });

  it("reads a single-member column directly", () => {
    expect(coalesceValue({ "n1:vendor": "Acme" }, ["n1:vendor"])).toBe("Acme");
  });
});
